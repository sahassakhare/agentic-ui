import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  AGENTIC_TELEMETRY_SINK,
  BackendRegistry,
  injectAgenticChat,
  type AgenticBackend,
  type BackendDef,
} from '../internal';
import { InMemoryTelemetrySink } from '../testing/in-memory-telemetry-sink';

/**
 * Slice L2 — verify the run-lifecycle emits the lib advertises. The README
 * claims `AgenticTelemetrySink` emit points are "baked in from M1"; this
 * spec turns that claim into a verifiable property by mounting an
 * `InMemoryTelemetrySink` and walking the turn boundaries.
 *
 * What we assert:
 *   - `agentic.run.start` fires on every run (was previously only emitted
 *     in the multimodal-fallback branch).
 *   - `agentic.run.end` fires with `outcome: 'ok'` on a clean turn.
 *   - `agentic.run.end` fires with `outcome: 'aborted'` when stop() is
 *     called while the orchestrator is awaiting the backend.
 *   - `agentic.run.end` fires with `outcome: 'error'` when the backend
 *     throws mid-run.
 *   - Each `run.end` carries `duration_ms` so dashboards can compute SLOs.
 *
 * Tool-call spans are exercised by `run-orchestrator.spec.ts`; this file
 * stays focused on the run-level boundaries.
 */

function makeBackend(opts: {
  id: string;
  scenario: 'ok' | 'abort' | 'error';
}): BackendDef {
  const backend: AgenticBackend = {
    id: opts.id,
    capabilities: {
      streaming: true,
      clientTools: false,
      generativeUi: false,
      uiActions: false,
    },
    async *run(input) {
      yield { type: 'run-started', threadId: input.threadId, runId: input.runId };
      if (opts.scenario === 'error') {
        throw new Error('backend exploded');
      }
      if (opts.scenario === 'abort') {
        // Surface enough event surface for the orchestrator to begin
        // processing, then await an abort.
        yield { type: 'text-delta', messageId: 'm-abort', delta: 'partial ' };
        // Wait for the host's signal — this microtask gives the spec a
        // chance to call ref.stop().
        await new Promise<void>((resolve) => {
          if (input.signal.aborted) { resolve(); return; }
          input.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new DOMException('aborted', 'AbortError');
      }
      yield { type: 'text-delta', messageId: 'm-ok', delta: 'hi ' };
      yield { type: 'text-delta', messageId: 'm-ok', delta: 'there' };
      yield { type: 'run-finished', runId: input.runId };
    },
  };
  return {
    name: backend.id,
    id: backend.id,
    label: backend.id,
    factory: () => backend,
    capabilities: backend.capabilities,
  };
}

function setup(scenario: 'ok' | 'abort' | 'error'): {
  ref: ReturnType<typeof injectAgenticChat>;
  sink: InMemoryTelemetrySink;
} {
  const sink = new InMemoryTelemetrySink();
  TestBed.configureTestingModule({
    providers: [{ provide: AGENTIC_TELEMETRY_SINK, useValue: sink }],
  });
  TestBed.runInInjectionContext(() => {
    TestBed.inject(BackendRegistry).register(makeBackend({ id: `fake-${scenario}`, scenario }));
    TestBed.inject(BackendRegistry).setActive(`fake-${scenario}`);
  });
  let ref!: ReturnType<typeof injectAgenticChat>;
  TestBed.runInInjectionContext(() => {
    ref = injectAgenticChat({});
  });
  return { ref, sink };
}

async function settle(ref: ReturnType<typeof injectAgenticChat>): Promise<void> {
  // The orchestrator runs in a microtask. Poll until `isLoading` flips
  // back to false or we exceed a generous bound.
  for (let i = 0; i < 100; i++) {
    if (!ref.isLoading()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Wait for a `run.end` event in the sink. We can't rely on `isLoading`
 * for the abort scenario — `ref.stop()` flips it eagerly so the chat
 * UI feels responsive, but the orchestrator's promise resolves a few
 * microtasks later. The emit happens inside `.then()` / `.catch()`,
 * so this helper polls the sink directly.
 */
async function waitForRunEnd(sink: InMemoryTelemetrySink): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (sink.eventsByName('agentic.run.end').length > 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('injectAgenticChat — L2 telemetry lifecycle', () => {
  beforeEach(() => {
    // TestBed is reset by setup() per scenario.
  });

  it('emits run.start + run.end (outcome=ok) for a clean turn', async () => {
    const { ref, sink } = setup('ok');
    ref.sendMessage('hello');
    await settle(ref);

    const starts = sink.eventsByName('agentic.run.start');
    const ends = sink.eventsByName('agentic.run.end');

    expect(starts).toHaveLength(1);
    expect(starts[0]?.attributes?.['agentic.backend.id']).toBe('fake-ok');
    expect(starts[0]?.attributes?.['agentic.run.id']).toMatch(/^run-/);
    expect(starts[0]?.attributes?.['agentic.thread.id']).toMatch(/^thread-/);

    expect(ends).toHaveLength(1);
    expect(ends[0]?.attributes?.['agentic.run.outcome']).toBe('ok');
    expect(typeof ends[0]?.attributes?.['agentic.run.duration_ms']).toBe('number');
    expect(starts[0]?.attributes?.['agentic.run.id']).toBe(
      ends[0]?.attributes?.['agentic.run.id'],
    );
  });

  it('emits run.end with outcome=aborted when stop() fires mid-run', async () => {
    const { ref, sink } = setup('abort');
    ref.sendMessage('hello');
    // Give the backend a chance to start yielding before aborting.
    await new Promise((r) => setTimeout(r, 10));
    ref.stop();
    await waitForRunEnd(sink);

    const ends = sink.eventsByName('agentic.run.end');
    expect(ends).toHaveLength(1);
    expect(ends[0]?.attributes?.['agentic.run.outcome']).toBe('aborted');
    // Aborted runs must NOT carry an error.message attribute — dashboards
    // distinguish them by outcome alone.
    expect(ends[0]?.attributes?.['agentic.error.message']).toBeUndefined();
  });

  it('emits run.end with outcome=error when the backend throws', async () => {
    const { ref, sink } = setup('error');
    ref.sendMessage('hello');
    await settle(ref);

    const ends = sink.eventsByName('agentic.run.end');
    expect(ends).toHaveLength(1);
    expect(ends[0]?.attributes?.['agentic.run.outcome']).toBe('error');
    expect(ends[0]?.attributes?.['agentic.error.message']).toBe('backend exploded');
    expect(ref.error()).toBeInstanceOf(Error);
  });

  it('start and end carry matching thread+run ids so dashboards can join', async () => {
    const { ref, sink } = setup('ok');
    ref.sendMessage('ping');
    await settle(ref);

    const start = sink.eventsByName('agentic.run.start')[0]?.attributes;
    const end = sink.eventsByName('agentic.run.end')[0]?.attributes;
    expect(start?.['agentic.thread.id']).toBe(end?.['agentic.thread.id']);
    expect(start?.['agentic.run.id']).toBe(end?.['agentic.run.id']);
  });
});
