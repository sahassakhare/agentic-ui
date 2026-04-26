import type {
  AgenticBackend,
  AgenticEvent,
  AgenticRunInput,
  BackendCapabilities,
} from '../internal';

const DEFAULT_CAPS: BackendCapabilities = {
  streaming: true,
  clientTools: true,
  generativeUi: true,
  uiActions: true,
};

/**
 * Test double for `AgenticBackend`. Two modes:
 *   1. Script mode — `enqueueScript([events])` queues a sequence to emit on each `run()`.
 *      A `run-started` and `run-finished` are auto-prepended/appended.
 *   2. Function mode — `useResponder(fn)` lets the test compute events from the input.
 * If no script and no responder, a minimal lifecycle-only run is yielded.
 */
export class FakeAgenticBackend implements AgenticBackend {
  readonly id = 'fake';
  readonly capabilities: BackendCapabilities;

  private readonly scripts: AgenticEvent[][] = [];
  private responder?: (input: AgenticRunInput) => Iterable<AgenticEvent> | AsyncIterable<AgenticEvent>;
  readonly runs: AgenticRunInput[] = [];

  constructor(capabilities: Partial<BackendCapabilities> = {}) {
    this.capabilities = { ...DEFAULT_CAPS, ...capabilities };
  }

  enqueueScript(events: readonly AgenticEvent[]): void {
    this.scripts.push([...events]);
  }

  useResponder(fn: (input: AgenticRunInput) => Iterable<AgenticEvent> | AsyncIterable<AgenticEvent>): void {
    this.responder = fn;
  }

  /** Clear scripts, recorded runs, and any responder. */
  resetFake(): void {
    this.scripts.length = 0;
    this.runs.length = 0;
    this.responder = undefined;
  }

  /** AgenticBackend.reset — clears thread state (no-op for the fake). */
  async reset(_threadId: string): Promise<void> {
    void _threadId;
  }

  async *run(input: AgenticRunInput): AsyncIterable<AgenticEvent> {
    this.runs.push(input);
    yield { type: 'run-started', threadId: input.threadId, runId: input.runId };

    if (this.responder) {
      for await (const ev of this.responder(input)) {
        if (input.signal.aborted) break;
        yield ev;
      }
    } else {
      const script = this.scripts.shift() ?? [];
      for (const ev of script) {
        if (input.signal.aborted) break;
        yield ev;
      }
    }

    yield { type: 'run-finished', runId: input.runId };
  }
}
