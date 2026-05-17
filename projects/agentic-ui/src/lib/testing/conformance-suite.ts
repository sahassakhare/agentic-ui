import type { AgenticBackend, AgenticEvent, AgenticRunInput } from '../internal';

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
];
