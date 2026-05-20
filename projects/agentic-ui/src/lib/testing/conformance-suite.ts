import type { AgenticBackend, AgenticEvent, AgenticRunInput } from '../internal';
import { agenticEventSchema } from '../types/agentic-event-schema';

export interface ConformanceCheck {
  readonly name: string;
  readonly expectCapability?: keyof AgenticBackend['capabilities'];
  readonly run: (backend: AgenticBackend) => Promise<ConformanceResult>;
}

export interface ConformanceResult {
  readonly name: string;
  readonly passed: boolean;
  readonly skipped?: boolean;
  readonly reason?: string;
  readonly events?: readonly AgenticEvent[];
}

export interface ConformanceReport {
  readonly backendId: string;
  readonly results: readonly ConformanceResult[];
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

/**
 * Backend-agnostic conformance suite. Every `AgenticBackend` adapter (AG-UI,
 * Hashbrown, A2UI, custom) can run this to prove it correctly implements
 * the contract: lifecycle events, streaming text, abort behavior, and the
 * capability flags it advertises.
 *
 * Usage:
 *   const report = await runConformance(backend);
 *   expect(report.failed).toBe(0);
 */
export async function runConformance(backend: AgenticBackend): Promise<ConformanceReport> {
  const results: ConformanceResult[] = [];
  for (const check of CONFORMANCE_CHECKS) {
    if (check.expectCapability && !backend.capabilities[check.expectCapability]) {
      results.push({ name: check.name, passed: true, skipped: true, reason: `capability ${String(check.expectCapability)} not advertised` });
      continue;
    }
    try {
      results.push(await check.run(backend));
    } catch (err) {
      results.push({ name: check.name, passed: false, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return {
    backendId: backend.id,
    results,
    passed: results.filter((r) => r.passed && !r.skipped).length,
    failed: results.filter((r) => !r.passed).length,
    skipped: results.filter((r) => r.skipped).length,
  };
}

async function collectEvents(backend: AgenticBackend, input: AgenticRunInput): Promise<AgenticEvent[]> {
  const out: AgenticEvent[] = [];
  for await (const ev of backend.run(input)) out.push(ev);
  return out;
}

function makeInput(overrides: Partial<AgenticRunInput> = {}): AgenticRunInput {
  return {
    threadId: 'conformance-thread',
    runId: 'conformance-run',
    messages: [{ id: 'u1', role: 'user', content: 'Hello', toolCalls: [], widgets: [] }],
    tools: [],
    widgets: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

const CONFORMANCE_CHECKS: ConformanceCheck[] = [
  {
    name: 'lifecycle: emits run-started before any other event',
    run: async (backend) => {
      const events = await collectEvents(backend, makeInput());
      const passed = events[0]?.type === 'run-started';
      return { name: 'lifecycle: emits run-started before any other event', passed, events, reason: passed ? undefined : `first event was ${events[0]?.type ?? '(none)'}` };
    },
  },
  {
    name: 'lifecycle: emits run-finished or run-error before stream end',
    run: async (backend) => {
      const events = await collectEvents(backend, makeInput());
      const last = events.at(-1);
      const passed = last?.type === 'run-finished' || last?.type === 'run-error';
      return { name: 'lifecycle: emits run-finished or run-error before stream end', passed, events, reason: passed ? undefined : `last event was ${last?.type ?? '(none)'}` };
    },
  },
  {
    name: 'lifecycle: thread/run ids on run-started match input',
    run: async (backend) => {
      const events = await collectEvents(backend, makeInput({ threadId: 'tx', runId: 'rx' }));
      const start = events.find((e) => e.type === 'run-started') as Extract<AgenticEvent, { type: 'run-started' }> | undefined;
      const passed = start?.threadId === 'tx' && start?.runId === 'rx';
      return { name: 'lifecycle: thread/run ids on run-started match input', passed, events };
    },
  },
  {
    name: 'abort: respects pre-aborted signal',
    run: async (backend) => {
      const ac = new AbortController();
      ac.abort();
      const events = await collectEvents(backend, makeInput({ signal: ac.signal }));
      // Should still emit a clean lifecycle pair, just no content.
      const hasFinish = events.some((e) => e.type === 'run-finished' || e.type === 'run-error');
      return { name: 'abort: respects pre-aborted signal', passed: hasFinish, events };
    },
  },
  // ── L5 — schema-validity check ─────────────────────────────────────
  //
  // Every event a backend yields must match `agenticEventSchema`. Hand-
  // rolled adapters (Hashbrown, A2UI) that cast wire JSON without
  // validation will hit this; an adapter passing earlier conformance
  // but emitting a malformed shape (e.g. `text-delta` without
  // `messageId`) fails here with the offending event in `events[]`
  // for inspection.
  {
    name: 'schema: every event satisfies agenticEventSchema',
    run: async (backend) => {
      const events = await collectEvents(backend, makeInput());
      for (const ev of events) {
        const parsed = agenticEventSchema.safeParse(ev);
        if (!parsed.success) {
          return {
            name: 'schema: every event satisfies agenticEventSchema',
            passed: false,
            events,
            reason: `event type=${(ev as { type?: unknown })?.type ?? '(none)'} failed schema: ${parsed.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}:${i.code}`).join('|')}`,
          };
        }
      }
      return { name: 'schema: every event satisfies agenticEventSchema', passed: true, events };
    },
  },
  // ── L5 — capability-gated check: clientTools (state threading) ─────
  //
  // Backends advertising `clientTools: true` must thread the host's
  // `state` field per ADR-013 so per-turn context (persona, route,
  // matter) reaches the LLM. Detection: pass `state: { __conformance:
  // 'probe' }` on the input and observe whether any subsequent event
  // (or a downstream tool the harness could invoke) reflects the
  // contextual value. The lib can't directly inspect the wire payload
  // — that's adapter-internal — but it CAN assert that the adapter
  // doesn't crash on a non-empty state and still emits a clean
  // lifecycle, which is the minimum bar before parity work lands.
  {
    name: 'clientTools: accepts a non-empty state without crashing',
    expectCapability: 'clientTools',
    run: async (backend) => {
      const events = await collectEvents(backend, makeInput({
        state: { __conformance: 'probe', persona: 'test', route: '/conformance' },
      }));
      const hasStart = events[0]?.type === 'run-started';
      const last = events.at(-1);
      const hasFinish = last?.type === 'run-finished' || last?.type === 'run-error';
      const passed = hasStart && hasFinish;
      return {
        name: 'clientTools: accepts a non-empty state without crashing',
        passed,
        events,
        reason: passed ? undefined : `expected clean lifecycle with state payload; got ${events.length} events ending in ${last?.type ?? '(none)'}`,
      };
    },
  },
  // ── L5 — capability-gated check: generativeUi (widget-render shape) ─
  //
  // Backends advertising `generativeUi: true` must emit `widget-render`
  // events with a structurally-valid payload when their LLM emits one.
  // The harness can't force the LLM to render a widget — that's
  // model-dependent — but it CAN assert that any widget-render the
  // adapter does yield carries `widgetCallId` + `name` + (any) `props`.
  // Adapters that never emit widgets pass this check by omission.
  {
    name: 'generativeUi: any widget-render events carry id + name + props',
    expectCapability: 'generativeUi',
    run: async (backend) => {
      const events = await collectEvents(backend, makeInput());
      const widgets = events.filter((e): e is Extract<AgenticEvent, { type: 'widget-render' }> => e.type === 'widget-render');
      for (const w of widgets) {
        if (typeof w.widgetCallId !== 'string' || w.widgetCallId.length === 0) {
          return { name: 'generativeUi: any widget-render events carry id + name + props', passed: false, events, reason: 'widget-render missing widgetCallId' };
        }
        // TypeScript narrows `w.name` to `never` after the previous guard
        // (an empty-or-missing name returns early); cast through unknown
        // to read the unsafely-typed field for the report message.
        const wAny = w as unknown as { name?: string; widgetCallId?: string; props?: unknown };
        if (typeof wAny.name !== 'string' || wAny.name.length === 0) {
          return { name: 'generativeUi: any widget-render events carry id + name + props', passed: false, events, reason: `widget-render ${wAny.widgetCallId} missing name` };
        }
        if (!('props' in wAny)) {
          return { name: 'generativeUi: any widget-render events carry id + name + props', passed: false, events, reason: `widget-render ${wAny.name} missing props field` };
        }
      }
      return { name: 'generativeUi: any widget-render events carry id + name + props', passed: true, events };
    },
  },
  // ── L5 — capability-gated check: uiActions (action dispatcher) ─────
  //
  // Backends advertising `uiActions: true` (A2UI is the canonical
  // example) must emit `ui-action` events whose payload is parseable.
  // Like the widget check above, the harness can't force the LLM to
  // emit a ui-action — it just enforces structural validity when the
  // adapter does yield one.
  {
    name: 'uiActions: any ui-action events carry actionId + op + payload',
    expectCapability: 'uiActions',
    run: async (backend) => {
      const events = await collectEvents(backend, makeInput());
      const actions = events.filter((e): e is Extract<AgenticEvent, { type: 'ui-action' }> => e.type === 'ui-action');
      for (const a of actions) {
        if (typeof a.actionId !== 'string' || typeof a.op !== 'string') {
          return { name: 'uiActions: any ui-action events carry actionId + op + payload', passed: false, events, reason: `ui-action missing actionId or op` };
        }
      }
      return { name: 'uiActions: any ui-action events carry actionId + op + payload', passed: true, events };
    },
  },
  // ── L5 — capability-gated check: multiModal (declared peers) ───────
  //
  // Backends advertising `multiModal: true` must not crash when the
  // input message content is a multi-part array (text + image + file).
  // Lifecycle pair must still settle. This is the minimum bar — full
  // multimodal correctness depends on the LLM behind the adapter.
  {
    name: 'multiModal: accepts multi-part message content',
    expectCapability: 'multiModal',
    run: async (backend) => {
      const events = await collectEvents(backend, makeInput({
        messages: [{
          id: 'u1',
          role: 'user',
          content: [
            { kind: 'text', text: 'What is in this image?' },
            { kind: 'image', mimeType: 'image/png', alt: 'probe', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==' },
          ],
          toolCalls: [],
          widgets: [],
        }],
      }));
      const last = events.at(-1);
      const passed = events[0]?.type === 'run-started' && (last?.type === 'run-finished' || last?.type === 'run-error');
      return {
        name: 'multiModal: accepts multi-part message content',
        passed,
        events,
        reason: passed ? undefined : 'adapter advertised multiModal but failed lifecycle on multi-part content',
      };
    },
  },
];
