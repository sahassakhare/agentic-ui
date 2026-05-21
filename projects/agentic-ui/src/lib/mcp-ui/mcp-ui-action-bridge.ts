import { inject, Injectable } from '@angular/core';
import { ToolRegistry } from '../registries/tool-registry';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import { randomId } from '../chat/message-utils';
import { MCP_UI_CONFIG } from './config';
import { mcpUiMessageSchema, type McpUiAction } from './types';

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
    | 'no-router';
}

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
    const tool = this.tools.get(toolName);
    if (!tool) {
      this.telemetry.emit('agentic.mcp_ui.action_blocked', {
        'agentic.tool.name': toolName,
        'agentic.mcp_ui.block_reason': 'tool-not-found-or-scoped',
      });
      return { handled: false, reason: 'tool-not-found' };
    }

    // Invoke through a synthetic tool context. The handler runs the
    // same way it would from the chat shell. Approval policies that the
    // ApprovalRegistry installed are enforced inside the orchestrator;
    // here we run the handler directly, so adopters who require HITL on
    // a tool should ALSO gate it server-side (the standard
    // defense-in-depth note from ADR-008).
    const runId = randomId('mcpui-run');
    const toolCallId = randomId('mcpui-tc');
    this.telemetry.emit('agentic.tool_call.start', {
      'agentic.mcp_ui.origin': 'ui-resource',
      'agentic.tool.name': toolName,
      'agentic.run.id': runId,
    });
    void Promise.resolve(
      tool.handler(args, {
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
      }),
    ).then(() => {
      this.telemetry.emit('agentic.tool_call.end', {
        'agentic.mcp_ui.origin': 'ui-resource',
        'agentic.tool.name': toolName,
        'agentic.run.id': runId,
        'agentic.tool.success': true,
      });
    }).catch((err) => {
      this.telemetry.emit('agentic.tool_call.end', {
        'agentic.mcp_ui.origin': 'ui-resource',
        'agentic.tool.name': toolName,
        'agentic.run.id': runId,
        'agentic.tool.success': false,
        'agentic.error.message': err instanceof Error ? err.message : String(err),
      });
    });

    return { handled: true, reason: 'dispatched' };
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
