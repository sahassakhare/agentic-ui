import type { AgenticEvent, AgenticTelemetrySink } from '../../internal';
import { agenticEventSchema } from '../../types/agentic-event-schema';

/**
 * Best-effort JSON parse. Returns the parsed value on success, or
 * the input value verbatim on failure (string passthrough). Used by
 * event mappers that consume `tool-call-result` content which may
 * be either a structured payload or a plain string.
 */
export function parseMaybeJson(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

/**
 * Detects the `showComponents`-style generative-UI convention: a tool
 * result whose content (or parsed JSON) carries a `components: [{name,
 * props}]` array. Yields one `widget-render` event per component.
 *
 * This is the canonical generative-UI extraction — adapters that
 * receive tool-call-result events from their wire format call this to
 * surface widget events alongside the result.
 */
export function extractWidgetRenders(
  toolCallId: string,
  resultContent: unknown,
): AgenticEvent[] {
  const parsed = parseMaybeJson(resultContent);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { components?: unknown }).components)) {
    return [];
  }
  const components = (parsed as { components: Array<{ name?: unknown; props?: unknown }> }).components;
  return components
    .filter((c): c is { name: string; props: unknown } => typeof c?.name === 'string')
    .map((c, i) => ({
      type: 'widget-render' as const,
      widgetCallId: `${toolCallId}-${i}`,
      name: c.name,
      props: c.props ?? {},
    }));
}

/**
 * Parse a single line of NDJSON into an `AgenticEvent`, validating
 * against `agenticEventSchema`. On malformed input, emit
 * `agentic.run.malformed_event` telemetry and return `null` so the
 * caller can drop the line without crashing.
 *
 * Adapters (Hashbrown, A2UI) call this per NDJSON line. AG-UI's
 * event mapper runs translator logic before validation and so
 * doesn't use this helper directly, but its output passes through
 * the orchestrator-side gate (L3) for the same protection.
 *
 * Slice L1.2 of `docs/plans/library-hardening-plan.md`.
 */
export function parseAgenticEventStrict(
  line: string,
  ctx: {
    readonly telemetry: AgenticTelemetrySink;
    readonly threadId: string;
    readonly runId: string;
    readonly backendId: string;
  },
): AgenticEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    ctx.telemetry.emit('agentic.run.malformed_event', {
      'agentic.backend.id': ctx.backendId,
      'agentic.thread.id': ctx.threadId,
      'agentic.run.id': ctx.runId,
      'agentic.event.type': '(invalid-json)',
      'agentic.event.parse_errors': 'json-parse',
    });
    return null;
  }
  const result = agenticEventSchema.safeParse(raw);
  if (!result.success) {
    ctx.telemetry.emit('agentic.run.malformed_event', {
      'agentic.backend.id': ctx.backendId,
      'agentic.thread.id': ctx.threadId,
      'agentic.run.id': ctx.runId,
      'agentic.event.type':
        typeof (raw as { type?: unknown })?.type === 'string'
          ? (raw as { type: string }).type
          : '(missing)',
      'agentic.event.parse_errors': result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}:${i.code}`)
        .join('|'),
    });
    return null;
  }
  return result.data as AgenticEvent;
}
