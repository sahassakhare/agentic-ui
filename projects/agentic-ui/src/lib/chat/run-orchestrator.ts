import type { WritableSignal } from '@angular/core';
import type { AgenticBackend, AgenticRunInput } from '../types/agentic-backend';
import type { AgenticEvent } from '../types/agentic-event';
import { agenticEventSchema } from '../types/agentic-event-schema';
import type { AgenticMessage, AgenticToolCall, AgenticWidgetInstance } from '../types/agentic-message';
import type {
  Approval,
  ComponentDef,
  OperationError,
  OperationProgress,
  OperationStartMeta,
  ToolContext,
  ToolDef,
} from '../types/registry-defs';
import type { AgenticTelemetrySink } from '../telemetry/telemetry-sink';
import type { ApprovalRegistry } from '../registries/approval-registry';
import type { OperationRegistry } from '../registries/operation-registry';
import type { LayoutRenderState } from '../layout/types';
import { layoutRenderStateSchema } from '../layout/types';
import { appendDelta, appendErrorMessage, attachToolCall, attachWidget, randomId } from './message-utils';

export interface RunOrchestratorOptions {
  readonly backend: AgenticBackend;
  readonly threadId: string;
  readonly runId: string;
  readonly initialMessages: readonly AgenticMessage[];
  readonly tools: readonly ToolDef[];
  readonly widgets: readonly ComponentDef[];
  readonly messageStream: WritableSignal<readonly AgenticMessage[]>;
  /**
   * Optional sink for agent-emitted `layout-render` events (ADR-043 D3).
   * When set, every `layout-render` event from the backend is written
   * here as the active workspace layout. Hosts subscribe via
   * `AgenticChatRef.activeLayout` and mount `<mvk-workspace-layout>`
   * wherever (typically the route's main pane). When omitted, the
   * events are dropped silently — back-compat with backends and apps
   * that don't use the layout primitive.
   */
  readonly layoutStream?: WritableSignal<LayoutRenderState | null>;
  readonly maxLocalTurns: number;
  readonly signal: AbortSignal;
  readonly telemetry: AgenticTelemetrySink;
  /**
   * Optional approval registry (Capability F4). When set, the
   * tool-execution loop consults the registry per call: if a policy
   * exists and `required(args, ctx)` returns true, the tool is **not
   * executed** and a synthetic queued-result is returned instead.
   */
  readonly approvalRegistry?: ApprovalRegistry;
  /**
   * Reads the active persona (Capability F4). Threaded into the
   * approval policy's `required(args, ctx)` so policies can short-
   * circuit on role. Defaults to `''` when omitted.
   */
  readonly activePersona?: () => string;
  /**
   * Optional operation registry (Capability F5 — r3 plan §9.5). When
   * set, every `ToolContext` created by `executeClientTools` carries
   * `startOperation` / `reportProgress` / `completeOperation` /
   * `failOperation` that route through this registry. Tools without
   * LRO needs ignore the methods.
   */
  readonly operationRegistry?: OperationRegistry;
  /**
   * Optional reasoning-context provider (Capability M1 R4 — ADR-013).
   * When set, called once per call to `runUntilSettled`; the result
   * is forwarded as `AgenticRunInput.state` so the active backend
   * can thread it to the LLM. Defaults to undefined (no state on
   * the wire), preserving v1.2 behaviour.
   */
  readonly stateProvider?: () => Readonly<Record<string, unknown>>;
  /**
   * ADR-046 D5 / PR1b — system-context block (XML or plain text)
   * inserted as a `role: 'system'` message ahead of `initialMessages`
   * in the `AgenticRunInput.messages` sent to the backend. **Never**
   * pushed into `messageStream` so the rendered transcript stays
   * clean. Built by `AgentContextProvider.compose()` in
   * `injectAgenticChat`; backends see it on the wire, the user does
   * not. Empty string is treated as absent (no system message added).
   */
  readonly systemContext?: string;
}

interface PendingToolCall {
  readonly toolCallId: string;
  readonly name: string;
  argsBuffer: string;
}

/**
 * Drives one or more agent turns until the run reaches a terminal state.
 * Mirrors flights42's `runUntilSettled` but is backend-agnostic — it consumes
 * `AgenticEvent`s from any `AgenticBackend` and dispatches client tools through
 * the supplied tool list.
 */
export async function runUntilSettled(opts: RunOrchestratorOptions): Promise<void> {
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]));
  const componentMap = new Map(opts.widgets.map((w) => [w.name, w]));
  const runSpan = opts.telemetry.startSpan('agentic.run.start', {
    'agentic.thread_id': opts.threadId,
    'agentic.run_id': opts.runId,
    'agentic.backend.id': opts.backend.id,
    'agentic.tools.count': opts.tools.length,
    'agentic.widgets.count': opts.widgets.length,
  });

  let messages = opts.initialMessages;
  let turnsRemaining = opts.maxLocalTurns;

  // ADR-046 D5 / PR1b — build a per-run synthetic system-context
  // message from `opts.systemContext`. This message lives ONLY in
  // the `AgenticRunInput.messages` sent to the backend; it never
  // touches `messages` (the orchestrator's tracking var) and
  // therefore never reaches `messageStream`. Result: the agent
  // sees the context block, the rendered transcript does not.
  const systemContextMessage: AgenticMessage | null =
    opts.systemContext && opts.systemContext.length > 0
      ? {
          id: randomId('sys'),
          role: 'system',
          content: opts.systemContext,
          toolCalls: [],
          widgets: [],
        }
      : null;
  const wireMessages = (): readonly AgenticMessage[] =>
    systemContextMessage ? [systemContextMessage, ...messages] : messages;

  try {
    // Resolve the optional reasoning-state provider once per run. The
    // host's provider may close over signals (persona, matter,
    // router URL) that change between runs but are stable within
    // one run — calling it here freezes the snapshot for the loop.
    const reasoningState = opts.stateProvider?.();

    let runInput: AgenticRunInput = {
      threadId: opts.threadId,
      runId: opts.runId,
      messages: wireMessages(),
      tools: opts.tools,
      widgets: opts.widgets,
      signal: opts.signal,
      ...(reasoningState !== undefined ? { state: reasoningState } : {}),
    };

    while (turnsRemaining-- > 0) {
      opts.signal.throwIfAborted();
      const pendingCalls = new Map<string, PendingToolCall>();
      const completedCalls: AgenticToolCall[] = [];

      let activeMessageId: string | undefined;
      let runFinished = false;
      let runError: { code: string; message: string } | undefined;

      for await (const rawEv of opts.backend.run(runInput)) {
        opts.signal.throwIfAborted();
        // L3 — validate every event against `agenticEventSchema` so a
        // malformed wire payload (Hashbrown / A2UI cast their JSON
        // without a guard until L1 lands) is telemetry'd + dropped
        // instead of corrupting run state. AG-UI events flow through
        // the same gate for symmetry.
        const parseResult = agenticEventSchema.safeParse(rawEv);
        if (!parseResult.success) {
          opts.telemetry.emit('agentic.run.malformed_event', {
            'agentic.thread.id': opts.threadId,
            'agentic.run.id': opts.runId,
            'agentic.event.type':
              typeof (rawEv as { type?: unknown })?.type === 'string'
                ? (rawEv as { type: string }).type
                : '(missing)',
            'agentic.event.parse_errors': parseResult.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join('.')}:${i.code}`)
              .join('|'),
          });
          // eslint-disable-next-line no-console
          console.warn('[agentic-ui] Dropped malformed backend event:', parseResult.error.issues);
          continue;
        }
        const ev = parseResult.data as AgenticEvent;
        if (ev.type === 'layout-render' && opts.layoutStream) {
          const candidate = {
            layoutName: ev.layoutName,
            slots: ev.slots,
            responsive: ev.responsive,
            data: ev.data,
          };
          const parsed = layoutRenderStateSchema.safeParse(candidate);
          if (parsed.success) {
            opts.layoutStream.set(parsed.data as LayoutRenderState);
          } else {
            // eslint-disable-next-line no-console
            console.warn(
              '[agentic-ui] Discarded malformed layout-render event:',
              parsed.error.issues,
            );
          }
        }
        const next = handleEvent(ev, messages, pendingCalls, activeMessageId);
        messages = next.messages;
        activeMessageId = next.activeMessageId;
        opts.messageStream.set(messages);

        if (ev.type === 'tool-call-end') {
          const pending = pendingCalls.get(ev.toolCallId);
          if (pending) {
            const parsedArgs = safeJson(pending.argsBuffer);
            completedCalls.push({
              toolCallId: ev.toolCallId,
              name: pending.name,
              args: parsedArgs,
            });
          }
        } else if (ev.type === 'run-finished') {
          runFinished = true;
        } else if (ev.type === 'run-error') {
          runError = ev.error;
          break;
        }
      }

      if (runError) {
        messages = appendErrorMessage(messages, runError.message);
        opts.messageStream.set(messages);
        break;
      }
      if (!runFinished) {
        // Stream ended without explicit run-finished — still proceed with whatever calls accumulated.
      }

      const clientResults = await executeClientTools({
        completedCalls,
        toolMap,
        threadId: opts.threadId,
        runId: opts.runId,
        signal: opts.signal,
        telemetry: opts.telemetry,
        approvalRegistry: opts.approvalRegistry,
        activePersona: opts.activePersona,
        operationRegistry: opts.operationRegistry,
      });

      if (clientResults.length === 0) {
        // No client tools to dispatch — the run is settled.
        break;
      }

      // Attach results back to messages and prepare next-turn input.
      const targetMessageId = activeMessageId ?? randomId('msg');
      for (const r of clientResults) {
        messages = attachToolCall(messages, targetMessageId, r);
        // Generative-UI convention: if the tool result carries a `components`
        // array of `{name, props}` items, attach each as a widget on the active
        // message — the chat shell renders them via <mvk-widget-container> →
        // ComponentRegistry → *ngComponentOutlet.
        const widgetEvents = extractWidgetEventsFromResult(r);
        for (const w of widgetEvents) {
          messages = attachWidget(messages, targetMessageId, w);
        }
      }
      opts.messageStream.set(messages);

      runInput = {
        threadId: opts.threadId,
        runId: opts.runId,
        messages: wireMessages(),
        tools: opts.tools,
        widgets: opts.widgets,
        signal: opts.signal,
      };
    }

    runSpan.end({ 'agentic.run.outcome': 'finished' });
  } catch (err) {
    runSpan.recordError(err);
    runSpan.end({ 'agentic.run.outcome': 'error' });
    throw err;
  }
}

interface HandleResult {
  messages: readonly AgenticMessage[];
  activeMessageId: string | undefined;
}

function handleEvent(
  ev: AgenticEvent,
  messages: readonly AgenticMessage[],
  pendingCalls: Map<string, PendingToolCall>,
  activeMessageId: string | undefined,
): HandleResult {
  switch (ev.type) {
    case 'text-delta': {
      const next = appendDelta(messages, ev.messageId, ev.delta);
      return { messages: next, activeMessageId: ev.messageId };
    }
    case 'tool-call-start': {
      pendingCalls.set(ev.toolCallId, { toolCallId: ev.toolCallId, name: ev.name, argsBuffer: '' });
      const tc: AgenticToolCall = { toolCallId: ev.toolCallId, name: ev.name, args: undefined };
      return { messages: attachToolCall(messages, activeMessageId ?? ev.toolCallId, tc), activeMessageId };
    }
    case 'tool-call-args': {
      const pending = pendingCalls.get(ev.toolCallId);
      if (pending) pending.argsBuffer += ev.delta;
      return { messages, activeMessageId };
    }
    case 'tool-call-result': {
      const target = messages
        .map((m) => m.toolCalls.find((tc) => tc.toolCallId === ev.toolCallId))
        .find((tc): tc is AgenticToolCall => Boolean(tc));
      if (target) {
        const updated: AgenticToolCall = { ...target, result: ev.result };
        const containingMessageId = messages.find((m) => m.toolCalls.some((tc) => tc.toolCallId === ev.toolCallId))?.id;
        if (containingMessageId) {
          return { messages: attachToolCall(messages, containingMessageId, updated), activeMessageId };
        }
      }
      return { messages, activeMessageId };
    }
    case 'widget-render': {
      const widget: AgenticWidgetInstance = { widgetCallId: ev.widgetCallId, name: ev.name, props: ev.props };
      return { messages: attachWidget(messages, activeMessageId ?? ev.widgetCallId, widget), activeMessageId };
    }
    default:
      return { messages, activeMessageId };
  }
}

interface ExecuteClientToolsOptions {
  readonly completedCalls: readonly AgenticToolCall[];
  readonly toolMap: ReadonlyMap<string, ToolDef>;
  readonly threadId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly telemetry: AgenticTelemetrySink;
  readonly approvalRegistry?: ApprovalRegistry;
  readonly activePersona?: () => string;
  readonly operationRegistry?: OperationRegistry;
}

async function executeClientTools(opts: ExecuteClientToolsOptions): Promise<AgenticToolCall[]> {
  const out: AgenticToolCall[] = [];
  for (const call of opts.completedCalls) {
    const tool = opts.toolMap.get(call.name);
    if (!tool) continue; // server-only tool, skip
    opts.signal.throwIfAborted();

    const span = opts.telemetry.startSpan('agentic.tool_call.start', {
      'agentic.tool.name': call.name,
      'agentic.tool.source': tool.source ?? 'host',
    });
    try {
      const ctx: ToolContext = buildToolContext(call, opts, tool);
      const parsed = tool.schema.parse(call.args);

      // Capability F4 — HITL intercept.
      const intercept = maybeQueueForApproval(call, parsed, ctx, opts);
      if (intercept) {
        out.push({ ...call, result: intercept });
        opts.telemetry.histogram('approval.intercept', 1, {
          'agentic.tool.name': call.name,
          decision: 'queued',
        });
        span.end({ 'agentic.tool.success': true, 'agentic.tool.queued_for_approval': true });
        continue;
      }

      const result = await tool.handler(parsed, ctx);
      out.push({ ...call, result });
      span.end({ 'agentic.tool.success': true });
    } catch (err) {
      const error = { code: 'tool_error', message: err instanceof Error ? err.message : String(err) };
      out.push({ ...call, error });
      span.recordError(err);
      span.end({ 'agentic.tool.success': false });
    }
  }
  return out;
}

/**
 * Capability F4 intercept (r3 plan §9.4). When an approval policy is
 * registered for the tool name AND `required(args, ctx)` returns true,
 * persist a pending `Approval` record and return the synthetic queued
 * result the LLM and the chat shell consume.
 *
 * Returns `undefined` when no intercept applies — the caller proceeds
 * with normal tool execution.
 */
function maybeQueueForApproval(
  call: AgenticToolCall,
  parsedArgs: unknown,
  ctx: ToolContext,
  opts: ExecuteClientToolsOptions,
): { queued: true; approvalId: string; status: 'pending-approval'; message: string; components: ReadonlyArray<{ name: string; props: Record<string, unknown> }> } | undefined {
  const registry = opts.approvalRegistry;
  if (!registry) return undefined;
  const policy = registry.get(call.name);
  if (!policy) return undefined;

  const persona = opts.activePersona?.() ?? '';
  const decisionCtx = {
    persona,
    threadId: ctx.threadId,
    runId: ctx.runId,
    toolCallId: ctx.toolCallId,
  };

  let needs: boolean;
  try {
    needs = policy.required(parsedArgs, decisionCtx);
  } catch (err) {
    // A throwing predicate is an authoring bug; fail closed (require approval)
    // and let the audit chain capture the error in a follow-up commit.
    opts.telemetry.emit('agentic.tool_call.start', {
      'agentic.approval.predicate_failed': true,
      'agentic.tool.name': call.name,
      'agentic.error.message': err instanceof Error ? err.message : String(err),
    });
    needs = true;
  }
  if (!needs) return undefined;

  const approvalId = randomId('appr');
  const message = policy.signoffMessage(parsedArgs);
  const approval: Approval = {
    id: approvalId,
    toolName: call.name,
    args: parsedArgs,
    requesterPersona: persona,
    status: 'pending',
    createdAt: new Date().toISOString(),
    signoffMessage: message,
    continuationHandle: {
      threadId: ctx.threadId,
      runId: ctx.runId,
      toolCallId: ctx.toolCallId,
    },
  };
  registry.enqueue(approval);

  return {
    queued: true,
    approvalId,
    status: 'pending-approval',
    message,
    components: [
      // The chat shell renders this widget inline; clicking Approve / Reject
      // walks the same ApprovalRegistry transitions the queue page does.
      { name: 'mvk-approval-card', props: { approvalId } },
    ],
  };
}

/**
 * Build the per-call `ToolContext`, including the Capability F5 LRO
 * surface. Hosts that wired an `OperationRegistry` get fully-functional
 * `startOperation` / `reportProgress` / `completeOperation` /
 * `failOperation`; hosts without LRO get safe no-op stubs that still
 * fulfil the type contract so tools that opportunistically call the
 * methods don't crash.
 */
function buildToolContext(
  call: AgenticToolCall,
  opts: ExecuteClientToolsOptions,
  tool: ToolDef,
): ToolContext {
  const reg = opts.operationRegistry;
  const baseCtx = {
    threadId: opts.threadId,
    runId: opts.runId,
    toolCallId: call.toolCallId,
    signal: opts.signal,
  };
  if (!reg) {
    return {
      ...baseCtx,
      startOperation: (meta: OperationStartMeta) => {
        // Without a registry, mint a stable id but otherwise no-op.
        // Tools that depend on observable progress should require a
        // wired OperationRegistry at boot.
        opts.telemetry.emit('agentic.tool_call.start', {
          'agentic.lro.no_registry': true,
          'agentic.tool.name': tool.name,
          'agentic.lro.description': meta.description,
        });
        return `op-stub-${Date.now()}`;
      },
      reportProgress: () => undefined,
      completeOperation: () => undefined,
      failOperation: () => undefined,
    };
  }
  return {
    ...baseCtx,
    startOperation: (meta: OperationStartMeta) =>
      reg.start({
        ...meta,
        toolName: meta.toolName ?? tool.name,
        threadId: opts.threadId,
        runId: opts.runId,
        toolCallId: call.toolCallId,
      }),
    reportProgress: (opId: string, progress: OperationProgress) =>
      reg.reportProgress(opId, progress),
    completeOperation: (opId: string, result: unknown) => reg.complete(opId, result),
    failOperation: (opId: string, error: OperationError) => reg.fail(opId, error),
  };
}

function safeJson(text: string): unknown {
  if (!text || text.trim() === '') return {};
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Generative-UI extraction. Recognizes two conventions on a tool result:
 *
 *   1. The `showComponents`-style top-level shape: `{ components: [{name, props}] }`
 *   2. An inline hint on any tool result: `{ ..., components: [{name, props}] }`
 *
 * Each matched entry becomes an {@link AgenticWidgetInstance} keyed by the
 * tool-call id + index. The chat shell renders them via the ComponentRegistry.
 *
 * Tool authors opt in by including a `components` array in their handler's
 * return value. The agent's text output (if any) is unaffected.
 */
function extractWidgetEventsFromResult(call: AgenticToolCall): AgenticWidgetInstance[] {
  const result = call.result;
  if (!result || typeof result !== 'object') return [];
  const components = (result as { components?: unknown }).components;
  if (!Array.isArray(components)) return [];
  return components
    .filter((c): c is { name: string; props?: unknown } =>
      Boolean(c) && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string')
    .map((c, i) => ({
      widgetCallId: `${call.toolCallId}-w${i}`,
      name: c.name,
      props: (c.props as object | undefined) ?? {},
    }));
}
