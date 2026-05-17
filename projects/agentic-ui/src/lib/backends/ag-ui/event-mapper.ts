import { EventType, type BaseEvent } from '@ag-ui/client';
import type { AgenticEvent } from '../../internal';

interface AgUiTextStartEvent extends BaseEvent { messageId: string }
interface AgUiTextContentEvent extends BaseEvent { messageId: string; delta: string }
interface AgUiToolStartEvent extends BaseEvent { toolCallId: string; toolCallName: string }
interface AgUiToolArgsEvent extends BaseEvent { toolCallId: string; delta: string }
interface AgUiToolEndEvent extends BaseEvent { toolCallId: string }
interface AgUiToolResultEvent extends BaseEvent { toolCallId: string; content: string }
interface AgUiErrorEvent extends BaseEvent { message?: string; code?: string }

/**
 * Maps an AG-UI `BaseEvent` to a library `AgenticEvent`. Returns `null` for
 * events the library does not surface (state snapshots, reasoning chunks, etc.).
 *
 * Generative-UI tool results (`showComponents`-style) are also surfaced as
 * `widget-render` events; see `extractWidgetRenders`.
 */
export function mapAgUiEvent(ev: BaseEvent, runId: string): AgenticEvent | null {
  switch (ev.type) {
    case EventType.RUN_STARTED:
      return { type: 'run-started', threadId: (ev as BaseEvent & { threadId: string }).threadId, runId };
    case EventType.RUN_FINISHED:
      return { type: 'run-finished', runId };
    case EventType.RUN_ERROR: {
      const err = ev as AgUiErrorEvent;
      return { type: 'run-error', runId, error: { code: err.code ?? 'ag_ui_error', message: err.message ?? 'AG-UI run error' } };
    }
    case EventType.TEXT_MESSAGE_CONTENT: {
      const tev = ev as AgUiTextContentEvent;
      return { type: 'text-delta', messageId: tev.messageId, delta: tev.delta };
    }
    case EventType.TEXT_MESSAGE_END: {
      const tev = ev as AgUiTextStartEvent;
      return { type: 'text-end', messageId: tev.messageId };
    }
    case EventType.TOOL_CALL_START: {
      const tcev = ev as AgUiToolStartEvent;
      return { type: 'tool-call-start', toolCallId: tcev.toolCallId, name: tcev.toolCallName };
    }
    case EventType.TOOL_CALL_ARGS: {
      const tcev = ev as AgUiToolArgsEvent;
      return { type: 'tool-call-args', toolCallId: tcev.toolCallId, delta: tcev.delta };
    }
    case EventType.TOOL_CALL_END: {
      const tcev = ev as AgUiToolEndEvent;
      return { type: 'tool-call-end', toolCallId: tcev.toolCallId };
    }
    case EventType.TOOL_CALL_RESULT: {
      const tcev = ev as AgUiToolResultEvent;
      return { type: 'tool-call-result', toolCallId: tcev.toolCallId, result: parseMaybeJson(tcev.content) };
    }
    default:
      return null;
  }
}

/**
 * Detects the `showComponents`-style generative-UI convention from flights42:
 * a tool result whose content JSON-parses to `{ components: [{ name, props }] }`
 * yields one `widget-render` event per component. Apps that don't use this
 * convention simply see no widget events.
 */
export function extractWidgetRenders(ev: BaseEvent): AgenticEvent[] {
  if (ev.type !== EventType.TOOL_CALL_RESULT) return [];
  const tcev = ev as AgUiToolResultEvent;
  const parsed = parseMaybeJson(tcev.content);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { components?: unknown }).components)) {
    return [];
  }
  const components = (parsed as { components: Array<{ name?: unknown; props?: unknown }> }).components;
  return components
    .filter((c): c is { name: string; props: unknown } => typeof c?.name === 'string')
    .map((c, i) => ({
      type: 'widget-render' as const,
      widgetCallId: `${tcev.toolCallId}-${i}`,
      name: c.name,
      props: c.props ?? {},
    }));
}

function parseMaybeJson(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}
