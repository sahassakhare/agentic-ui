import { inject, Injectable } from '@angular/core';
import { ToolRegistry } from '../registries/tool-registry';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import { randomId } from '../chat/message-utils';
import { LIB_VERSION } from '../version';
import { MCP_UI_CONFIG } from './config';
import {
  mcpAppRpcRequestSchema,
  mcpUiMessageSchema,
  type McpAppRpcResponse,
  type McpUiAction,
} from './types';
import type { ToolDef } from '../types/registry-defs';

/**
 * Result of handling a single inbound MCP-UI postMessage.
 */
export interface McpUiActionResult {
  readonly handled: boolean;
  readonly reason?:
    | 'bad-origin'
    | 'malformed-message'
    | 'tool-not-found'
    | 'tool-scope-denied'
    | 'dispatched'
    | 'delegated-to-host'
    | 'no-router'
    | 'initialized'
    | 'method-not-found';
}

/** JSON-RPC error codes used on the SEP channel. */
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;

/**
 * Dispatches validated MCP-UI actions into the host's registries.
 *
 * Security boundary (ADR-049): every inbound message is
 *   1. origin-checked against the configured allowlist (when an
 *      expected origin is supplied),
 *   2. shape-validated with `mcpUiMessageSchema` (Zod),
 *   3. for `tool` actions, gated through the ToolRegistry's *current
 *      scope policy* — a sandboxed resource cannot invoke a tool the
 *      active persona can't see.
 *
 * Phase 1 dispatches `tool` (scope-gated) and `link` (router/external).
 * `intent` / `notify` / `prompt` are validated then handed to the
 * host's optional `onUnhandledAction` so adopters can wire them today;
 * first-class dispatch lands as the registries are threaded in.
 */
@Injectable({ providedIn: 'root' })
export class McpUiActionBridge {
  private readonly tools = inject(ToolRegistry);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);
  private readonly config = inject(MCP_UI_CONFIG);

  /**
   * Optional router hook. The lib core can't depend on @angular/router
   * (keeps the dep surface minimal), so `provideMcpUi` wires a navigate
   * callback when the app has a Router. Without it, `link` actions with
   * `target: 'router'` no-op with reason `no-router`.
   */
  private navigate: ((url: string) => void) | null = null;

  /** Wired by `provideMcpUi` when the host app has an Angular Router. */
  setNavigator(fn: (url: string) => void): void {
    this.navigate = fn;
  }

  /**
   * Handle a raw `MessageEvent` from a UIResource iframe. Validates
   * origin + shape, then dispatches. Returns a structured result so the
   * renderer can surface failures (and tests can assert them).
   *
   * @param event the raw postMessage event from the iframe
   * @param expectedOrigin the origin the resource was loaded from
   *   (for `text/uri-list` resources). Pass `null` for inline `srcdoc`
   *   resources, whose `event.origin` is `'null'` (sandboxed frame).
   */
  handleMessage(event: { data: unknown; origin: string }, expectedOrigin: string | null): McpUiActionResult {
    // Origin check. Inline srcdoc frames post from origin 'null'; we
    // accept those (they ran our own HTML). External-URL frames must
    // match the origin they were loaded from AND be on the allowlist.
    if (expectedOrigin !== null) {
      if (event.origin !== expectedOrigin) {
        this.emitBlocked('bad-origin', event.origin);
        return { handled: false, reason: 'bad-origin' };
      }
      if (!this.originAllowed(expectedOrigin)) {
        this.emitBlocked('bad-origin', event.origin);
        return { handled: false, reason: 'bad-origin' };
      }
    }

    const parsed = mcpUiMessageSchema.safeParse(event.data);
    if (!parsed.success) {
      // Not every postMessage is an MCP-UI action (the frame may chat
      // with itself); only telemetry-log when it claims to be one.
      if ((event.data as { source?: unknown })?.source === 'mcp-ui') {
        this.emitBlocked('malformed-message', event.origin);
      }
      return { handled: false, reason: 'malformed-message' };
    }

    return this.dispatch(parsed.data.action);
  }

  /** Dispatch a pre-validated action. Public so tests + custom frames can call directly. */
  dispatch(action: McpUiAction): McpUiActionResult {
    switch (action.type) {
      case 'tool':
        return this.dispatchTool(action.payload.toolName, action.payload.args);
      case 'link':
        return this.dispatchLink(action.payload.url, action.payload.target ?? 'router');
      case 'intent':
      case 'notify':
      case 'prompt':
        // Validated but not first-class yet — hand to the host.
        this.config.onUnhandledAction?.(action);
        return { handled: true, reason: 'delegated-to-host' };
    }
  }

  private dispatchTool(toolName: string, args: unknown): McpUiActionResult {
    // Read through the registry's scope policy — `get` applies the active
    // scope policy on read, so a tool hidden from the active persona
    // resolves to undefined here exactly as it would for the LLM. We
    // deliberately do NOT distinguish "doesn't exist" from "hidden by
    // scope" — reporting a single reason avoids leaking which tools
    // exist to an untrusted UIResource.
    const tool = this.resolveScopedTool(toolName);
    if (!tool) return { handled: false, reason: 'tool-not-found' };

    // Fire-and-forget — the legacy `{source:'mcp-ui'}` `tool` action has
    // no reply channel, so we don't await the result here.
    void this.runScopedTool(tool, args);
    return { handled: true, reason: 'dispatched' };
  }

  /**
   * Resolve a tool through the active scope policy, emitting the blocked
   * telemetry on miss. Returns `undefined` for both "doesn't exist" and
   * "hidden by scope" — a single outcome avoids leaking which tools exist
   * to an untrusted resource.
   */
  private resolveScopedTool(toolName: string): ToolDef | undefined {
    const tool = this.tools.get(toolName);
    if (!tool) {
      this.telemetry.emit('agentic.mcp_ui.action_blocked', {
        'agentic.tool.name': toolName,
        'agentic.mcp_ui.block_reason': 'tool-not-found-or-scoped',
      });
      return undefined;
    }
    return tool;
  }

  /**
   * Invoke a resolved tool's handler through a synthetic tool context and
   * return its result. The handler runs the same way it would from the
   * chat shell. Approval policies installed on the ApprovalRegistry are
   * enforced by the orchestrator, not here — adopters who require HITL on
   * a tool should ALSO gate it server-side (ADR-008 defense-in-depth).
   */
  private async runScopedTool(tool: ToolDef, args: unknown): Promise<unknown> {
    const runId = randomId('mcpui-run');
    const toolCallId = randomId('mcpui-tc');
    this.telemetry.emit('agentic.tool_call.start', {
      'agentic.mcp_ui.origin': 'ui-resource',
      'agentic.tool.name': tool.name,
      'agentic.run.id': runId,
    });
    try {
      const result = await tool.handler(args, {
        threadId: `mcp-ui:${runId}`,
        runId,
        toolCallId,
        signal: new AbortController().signal,
        // LRO stubs — a UIResource-triggered tool can't show inline
        // progress in the chat; these are no-ops.
        startOperation: () => `op-mcpui-${Date.now()}`,
        reportProgress: () => undefined,
        completeOperation: () => undefined,
        failOperation: () => undefined,
      });
      this.telemetry.emit('agentic.tool_call.end', {
        'agentic.mcp_ui.origin': 'ui-resource',
        'agentic.tool.name': tool.name,
        'agentic.run.id': runId,
        'agentic.tool.success': true,
      });
      return result;
    } catch (err) {
      this.telemetry.emit('agentic.tool_call.end', {
        'agentic.mcp_ui.origin': 'ui-resource',
        'agentic.tool.name': tool.name,
        'agentic.run.id': runId,
        'agentic.tool.success': false,
        'agentic.error.message': err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Handle one JSON-RPC message from an MCP App (SEP-1865) iframe and reply
   * via `respond`. This is the SEP equivalent of {@link handleMessage} for
   * `text/html;profile=mcp-app` resources, which speak JSON-RPC 2.0 over
   * postMessage instead of the legacy `{source:'mcp-ui', action}` envelope.
   *
   * Supported methods (all scope-gated through the same ToolRegistry policy
   * as the legacy channel):
   *  - `ui/initialize` — handshake; replies with host capabilities.
   *  - `tools/list` — scoped tool names + descriptions the app may call back.
   *  - `tools/call` — invoke a tool; replies with its `structuredContent`.
   *  - `ui/open-link` — router/external navigation (reuses link dispatch).
   *  - `ui/update-model-context` — delegated to the host's optional handler.
   *
   * Notifications (no `id`) get no reply. Unknown methods return JSON-RPC
   * `-32601 Method not found`. Origin validation is the caller's job (the
   * renderer only wires this for inline srcdoc frames it served).
   */
  async handleAppRpc(
    message: unknown,
    respond: (response: McpAppRpcResponse) => void,
  ): Promise<McpUiActionResult> {
    const parsed = mcpAppRpcRequestSchema.safeParse(message);
    if (!parsed.success) return { handled: false, reason: 'malformed-message' };

    const { id, method, params } = parsed.data;
    const isRequest = id !== undefined;
    const reply = (body: Omit<McpAppRpcResponse, 'jsonrpc' | 'id'>): void => {
      if (isRequest) respond({ jsonrpc: '2.0', id, ...body });
    };

    switch (method) {
      case 'ui/initialize': {
        reply({
          result: {
            // What the host can do for the app, per SEP capability shape.
            capabilities: { tools: { call: true, list: true }, ui: { openLink: true } },
            hostInfo: { name: '@infra-tools/agentic-ui', version: LIB_VERSION },
          },
        });
        return { handled: true, reason: 'initialized' };
      }

      case 'tools/list': {
        reply({
          result: {
            tools: this.tools.list().map((t) => ({
              name: t.name,
              description: t.description,
            })),
          },
        });
        return { handled: true, reason: 'dispatched' };
      }

      case 'tools/call': {
        const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof p.name !== 'string') {
          reply({ error: { code: RPC_INVALID_PARAMS, message: 'tools/call requires a string `name`.' } });
          return { handled: false, reason: 'malformed-message' };
        }
        const tool = this.resolveScopedTool(p.name);
        if (!tool) {
          // Mirror MCP's convention: unknown/forbidden tool is an error
          // result, not a transport error, and never reveals existence.
          reply({ result: { isError: true, content: [{ type: 'text', text: `Unknown tool: "${p.name}"` }] } });
          return { handled: false, reason: 'tool-not-found' };
        }
        try {
          const out = await this.runScopedTool(tool, p.arguments);
          reply({
            result: {
              content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }],
              // SEP presentation/data separation — the app re-renders from this.
              ...(out !== null && typeof out === 'object' ? { structuredContent: out } : {}),
            },
          });
          return { handled: true, reason: 'dispatched' };
        } catch (err) {
          reply({
            result: {
              isError: true,
              content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
            },
          });
          return { handled: true, reason: 'dispatched' };
        }
      }

      case 'ui/open-link': {
        const p = (params ?? {}) as { url?: unknown; target?: unknown };
        if (typeof p.url !== 'string') {
          reply({ error: { code: RPC_INVALID_PARAMS, message: 'ui/open-link requires a string `url`.' } });
          return { handled: false, reason: 'malformed-message' };
        }
        const target = p.target === 'router' ? 'router' : 'external';
        const linkResult = this.dispatchLink(p.url, target);
        if (linkResult.handled) reply({ result: {} });
        else reply({ error: { code: RPC_INTERNAL_ERROR, message: `Link not handled (${linkResult.reason}).` } });
        return linkResult;
      }

      case 'ui/update-model-context': {
        // Not first-class yet — surface the app's intent to the host as a
        // `prompt` so adopters can fold it into the next turn, then ack.
        this.config.onUnhandledAction?.({
          type: 'prompt',
          payload: { text: jsonText(params) },
        });
        reply({ result: {} });
        return { handled: true, reason: 'delegated-to-host' };
      }

      default: {
        reply({ error: { code: RPC_METHOD_NOT_FOUND, message: `Method not found: ${method}` } });
        return { handled: false, reason: 'method-not-found' };
      }
    }
  }

  private dispatchLink(url: string, target: 'router' | 'external'): McpUiActionResult {
    if (target === 'external') {
      // Only navigate to absolute http(s) URLs from a UIResource.
      if (/^https?:\/\//i.test(url) && typeof globalThis.open === 'function') {
        globalThis.open(url, '_blank', 'noopener,noreferrer');
        return { handled: true, reason: 'dispatched' };
      }
      return { handled: false, reason: 'bad-origin' };
    }
    if (!this.navigate) return { handled: false, reason: 'no-router' };
    this.navigate(url);
    return { handled: true, reason: 'dispatched' };
  }

  private originAllowed(origin: string): boolean {
    const list = this.config.allowedOrigins;
    if (list.includes('*')) return true;
    return list.includes(origin);
  }

  private emitBlocked(reason: string, origin: string): void {
    this.telemetry.emit('agentic.mcp_ui.action_blocked', {
      'agentic.mcp_ui.block_reason': reason,
      'agentic.mcp_ui.origin': origin,
    });
  }
}

/** Stringify arbitrary JSON-RPC params for the delegate-to-host prompt path. */
function jsonText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return String(value);
  }
}
