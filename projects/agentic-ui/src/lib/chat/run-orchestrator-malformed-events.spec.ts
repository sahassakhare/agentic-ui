import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  AGENTIC_TELEMETRY_SINK,
  BackendRegistry,
  injectAgenticChat,
  type AgenticBackend,
  type AgenticEvent,
  type BackendDef,
} from '../internal';
import { InMemoryTelemetrySink } from '../testing/in-memory-telemetry-sink';

/**
 * Slice L3 — verify that backends yielding malformed events do not
 * crash the run. The orchestrator `safeParse`s every event against
 * `agenticEventSchema` at the for-await boundary; on failure it emits
 * `agentic.run.malformed_event` and continues.
 *
 * Tests exercise the three failure modes a hand-rolled backend can
 * realistically hit:
 *   1. Missing required field (text-delta without messageId).
 *   2. Wrong field type (tool-call-start with a number for `name`).
 *   3. Unknown event type entirely.
 */

function backendYielding(...events: unknown[]): BackendDef {
  const backend: AgenticBackend = {
    id: 'fake-malformed',
    capabilities: {
      streaming: true,
      clientTools: false,
      generativeUi: false,
      uiActions: false,
    },
    async *run(input) {
      yield { type: 'run-started', threadId: input.threadId, runId: input.runId } as AgenticEvent;
      for (const ev of events) {
        yield ev as AgenticEvent;
      }
      yield { type: 'run-finished', runId: input.runId } as AgenticEvent;
    },
  };
  return {
    name: backend.id,
    id: backend.id,
    label: 'Fake (malformed events)',
    factory: () => backend,
    capabilities: backend.capabilities,
  };
}

function setup(...badEvents: unknown[]): {
  ref: ReturnType<typeof injectAgenticChat>;
  sink: InMemoryTelemetrySink;
} {
  const sink = new InMemoryTelemetrySink();
  TestBed.configureTestingModule({
    providers: [{ provide: AGENTIC_TELEMETRY_SINK, useValue: sink }],
  });
  TestBed.runInInjectionContext(() => {
    TestBed.inject(BackendRegistry).register(backendYielding(...badEvents));
    TestBed.inject(BackendRegistry).setActive('fake-malformed');
  });
  let ref!: ReturnType<typeof injectAgenticChat>;
  TestBed.runInInjectionContext(() => {
    ref = injectAgenticChat({});
  });
  return { ref, sink };
}

async function waitForRunEnd(sink: InMemoryTelemetrySink): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (sink.eventsByName('agentic.run.end').length > 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('runOrchestrator — L3 malformed-event resilience', () => {
  beforeEach(() => {
    /* TestBed reset per setup() */
  });

  it('drops + telemetry-reports an event missing a required field', async () => {
    // text-delta requires `messageId` — omitted on the wire.
    const { ref, sink } = setup({ type: 'text-delta', delta: 'orphan' });
    ref.sendMessage('hello');
    await waitForRunEnd(sink);

    const malformed = sink.eventsByName('agentic.run.malformed_event');
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.attributes?.['agentic.event.type']).toBe('text-delta');
    // Run still completes cleanly.
    expect(sink.eventsByName('agentic.run.end')[0]?.attributes?.['agentic.run.outcome']).toBe('ok');
  });

  it('drops + telemetry-reports an event with a wrong field type', async () => {
    // tool-call-start expects name:string; backend sends a number.
    const { ref, sink } = setup({ type: 'tool-call-start', toolCallId: 'tc-1', name: 42 });
    ref.sendMessage('hello');
    await waitForRunEnd(sink);

    const malformed = sink.eventsByName('agentic.run.malformed_event');
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.attributes?.['agentic.event.type']).toBe('tool-call-start');
    expect(String(malformed[0]?.attributes?.['agentic.event.parse_errors'])).toContain('name');
  });

  it('drops + telemetry-reports an unknown event type', async () => {
    const { ref, sink } = setup({ type: 'invented-event', payload: { foo: 'bar' } });
    ref.sendMessage('hello');
    await waitForRunEnd(sink);

    const malformed = sink.eventsByName('agentic.run.malformed_event');
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.attributes?.['agentic.event.type']).toBe('invented-event');
  });

  it('survives multiple malformed events interleaved with valid ones', async () => {
    const { ref, sink } = setup(
      { type: 'text-delta', delta: 'no-id-1' },        // malformed
      { type: 'text-delta', messageId: 'm', delta: 'a' }, // valid
      { type: 'gibberish' },                           // malformed
      { type: 'text-delta', messageId: 'm', delta: 'b' }, // valid
    );
    ref.sendMessage('hello');
    await waitForRunEnd(sink);

    expect(sink.eventsByName('agentic.run.malformed_event')).toHaveLength(2);
    // Run still finishes — the valid events flow through to the
    // transcript and the run.end emits with outcome=ok.
    expect(sink.eventsByName('agentic.run.end')[0]?.attributes?.['agentic.run.outcome']).toBe('ok');
  });
});
