import type { WritableSignal } from '@angular/core';
import type { AgenticBackend, AgenticRunInput } from '../types/agentic-backend';
import type { AgenticEvent } from '../types/agentic-event';
import type { AgenticMessage, AgenticToolCall, AgenticWidgetInstance } from '../types/agentic-message';
import type { ToolDef, ComponentDef, ToolContext } from '../types/registry-defs';
import type { AgenticTelemetrySink } from '../telemetry/telemetry-sink';
import { appendDelta, appendErrorMessage, attachToolCall, attachWidget, randomId } from './message-utils';

export interface RunOrchestratorOptions {
  readonly backend: AgenticBackend;
  readonly threadId: string;
  readonly runId: string;
  readonly initialMessages: readonly AgenticMessage[];
  readonly tools: readonly ToolDef[];
  readonly widgets: readonly ComponentDef[];
  readonly messageStream: WritableSignal<readonly AgenticMessage[]>;
  readonly maxLocalTurns: number;
  readonly signal: AbortSignal;
  readonly telemetry: AgenticTelemetrySink;
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

  try {
    let runInput: AgenticRunInput = {
      threadId: opts.threadId,
      runId: opts.runId,
      messages,
      tools: opts.tools,
      widgets: opts.widgets,
      signal: opts.signal,
    };

    while (turnsRemaining-- > 0) {
      opts.signal.throwIfAborted();
      const pendingCalls = new Map<string, PendingToolCall>();
      const completedCalls: AgenticToolCall[] = [];

      let activeMessageId: string | undefined;
      let runFinished = false;
      let runError: { code: string; message: string } | undefined;

      for await (const ev of opts.backend.run(runInput)) {
        opts.signal.throwIfAborted();
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
        messages,
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
      const ctx: ToolContext = {
        threadId: opts.threadId,
        runId: opts.runId,
        toolCallId: call.toolCallId,
        signal: opts.signal,
      };
      const parsed = tool.schema.parse(call.args);
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
