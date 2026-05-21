import {
  effect,
  inject,
  Injectable,
  Injector,
  InjectionToken,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import {
  AGENTIC_TELEMETRY_SINK,
  ApprovalRegistry,
  ToolRegistry,
} from '@infra-tools/agentic-ui';
import { invokeWebMcpTool, syncRegistrations, type WebMcpInvokeDeps } from './web-mcp-invoke';
import {
  getModelContext,
  type NavigatorModelContext,
  type WebMcpToolHandle,
  type WebMcpToolResult,
} from './types';

/**
 * Options for {@link provideWebMcp}.
 */
export interface WebMcpOptions {
  /**
   * Active persona id supplied to approval policies' `required(args, ctx)`
   * check. Defaults to `'webmcp'`. Pass a getter that reads your
   * `AGENTIC_ACTIVE_PERSONA` signal for accurate persona-gated approvals.
   */
  readonly persona?: () => string;
  /**
   * Source tag stamped on telemetry for WebMCP-originated calls.
   * Default `'webmcp'`.
   */
  readonly source?: string;
  /**
   * Override the `navigator.modelContext` lookup (tests inject a mock).
   * Defaults to feature-detecting the real `navigator.modelContext`.
   */
  readonly modelContext?: NavigatorModelContext | null;
}

const WEBMCP_OPTIONS = new InjectionToken<WebMcpOptions>('WEBMCP_OPTIONS');

/**
 * Reactively mirrors the host's `ToolRegistry` into `navigator.modelContext`
 * so an in-browser agent can call the app's tools. Re-syncs whenever the
 * (scope-filtered) tool list changes; reaps registrations on teardown.
 *
 * Security (ADR-050):
 *   - Only tools VISIBLE through the current scope policy are exposed —
 *     `ToolRegistry.list()` already applies the policy on read, so a tool
 *     hidden from the active persona is never registered with WebMCP.
 *   - Every inbound call re-checks visibility (the scope policy may have
 *     changed between registration and invocation).
 *   - Tools with an approval policy whose `required(args, ctx)` returns
 *     true are NOT auto-executed — the call queues an `Approval` and
 *     returns a pending result, mirroring the chat-shell HITL intercept.
 */
@Injectable({ providedIn: 'root' })
export class WebMcpService {
  private readonly tools = inject(ToolRegistry);
  private readonly approvals = inject(ApprovalRegistry, { optional: true });
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);
  private readonly injector = inject(Injector);
  private readonly opts = inject(WEBMCP_OPTIONS, { optional: true }) ?? {};

  private mc: NavigatorModelContext | null = null;
  private readonly handles = new Map<string, WebMcpToolHandle>();
  private started = false;

  /** Begin mirroring. Idempotent. Returns a disposer. */
  start(): () => void {
    if (this.started) return () => this.dispose();
    this.mc = this.opts.modelContext ?? getModelContext();
    if (!this.mc) {
      // No WebMCP in this environment — degrade to a no-op with a
      // single telemetry signal so adopters can see why nothing
      // registered.
      this.telemetry.emit('agentic.webmcp.unavailable', { 'agentic.webmcp.source': this.source });
      this.started = true;
      return () => this.dispose();
    }
    this.started = true;

    // Reactive sync: re-register on every (scope-filtered) tool-list change.
    // Explicit injector — `start()` is invoked from an environment
    // initializer, so we can't rely on an ambient injection context here.
    const stop = effect(() => {
      const visible = this.tools.list();
      if (!this.mc) return;
      syncRegistrations(this.mc, visible, this.handles, (toolName) => (args) => this.invoke(toolName, args));
    }, { injector: this.injector });

    return () => {
      stop.destroy();
      this.dispose();
    };
  }

  private get source(): string {
    return this.opts.source ?? 'webmcp';
  }

  /** Narrow dependency surface handed to the pure invoke core. */
  private invokeDeps(): WebMcpInvokeDeps {
    return {
      getTool: (name) => this.tools.get(name),
      getApproval: (toolName) => this.approvals?.get(toolName),
      enqueueApproval: ({ toolName, args, persona, signoffMessage }) => {
        const approvalId = `appr-webmcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const runId = `webmcp-${Date.now()}`;
        this.approvals?.enqueue({
          id: approvalId,
          toolName,
          args,
          requesterPersona: persona,
          status: 'pending',
          createdAt: new Date().toISOString(),
          signoffMessage,
          continuationHandle: { threadId: `webmcp:${toolName}`, runId, toolCallId: `webmcp-tc-${runId}` },
        });
        return approvalId;
      },
      persona: () => this.opts.persona?.() ?? 'webmcp',
      telemetry: this.telemetry,
    };
  }

  /** Handle one inbound WebMCP tool call (delegates to the pure core). */
  private invoke(toolName: string, args: unknown): Promise<WebMcpToolResult> {
    return invokeWebMcpTool(this.invokeDeps(), toolName, args);
  }

  private dispose(): void {
    for (const handle of this.handles.values()) handle.unregister();
    this.handles.clear();
    this.mc = null;
    this.started = false;
  }
}

/**
 * Wire WebMCP tool exposure. Optional — apps that don't expose tools to
 * an in-browser agent never call this. Feature-detects
 * `navigator.modelContext`; degrades to a no-op (with one telemetry
 * signal) when the browser doesn't implement the proposal.
 *
 * @example
 * ```ts
 * import { provideWebMcp } from '@infra-tools/agentic-ui-webmcp';
 * import { inject } from '@angular/core';
 * import { AGENTIC_ACTIVE_PERSONA } from '@infra-tools/agentic-ui';
 *
 * providers: [
 *   provideWebMcp({
 *     persona: () => inject(AGENTIC_ACTIVE_PERSONA)(),
 *   }),
 * ],
 * ```
 */
export function provideWebMcp(options: WebMcpOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: WEBMCP_OPTIONS, useValue: options },
    provideEnvironmentInitializer(() => {
      inject(WebMcpService).start();
    }),
  ]);
}
