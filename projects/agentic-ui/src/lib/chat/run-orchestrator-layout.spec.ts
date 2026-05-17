import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import type { AgenticMessage } from '../types';
import type { LayoutRenderState } from '../layout/types';
import { runUntilSettled } from './run-orchestrator';
import { FakeAgenticBackend } from '../testing/fake-agentic-backend';
import { InMemoryTelemetrySink } from '../testing/in-memory-telemetry-sink';

/**
 * ADR-043 D3 — the orchestrator pipes `layout-render` events from the
 * backend into the supplied `layoutStream` signal after validating the
 * payload against `layoutRenderStateSchema`. These specs lock down the
 * contract — payload routing, validation drops, back-compat when no
 * stream is supplied.
 */

function runWithLayoutStream(events: Parameters<FakeAgenticBackend['enqueueScript']>[0]) {
  const backend = new FakeAgenticBackend();
  backend.enqueueScript(events);
  const messages = signal<readonly AgenticMessage[]>([]);
  const layout = signal<LayoutRenderState | null>(null);
  const ac = new AbortController();
  const telemetry = new InMemoryTelemetrySink();

  return {
    layout,
    finished: runUntilSettled({
      backend,
      threadId: 't',
      runId: 'r',
      initialMessages: [],
      tools: [],
      widgets: [],
      messageStream: messages,
      layoutStream: layout,
      maxLocalTurns: 5,
      signal: ac.signal,
      telemetry,
    }),
  };
}

describe('runUntilSettled — layout-render handling (ADR-043 D3)', () => {
  it('writes a registered-name layout-render event to layoutStream', async () => {
    const { layout, finished } = runWithLayoutStream([
      {
        type: 'layout-render',
        layoutName: 'review-workbench',
        slots: {
          primary: { component: 'documentPreview', props: { docId: 'd-1' } },
          sidebar: { component: 'tagPanel' },
        },
      },
    ]);
    await finished;

    const state = layout();
    expect(state).not.toBeNull();
    expect(state?.layoutName).toBe('review-workbench');
    expect(Object.keys(state!.slots)).toEqual(['primary', 'sidebar']);
  });

  it('writes an ad-hoc layout-render event (no layoutName) to layoutStream', async () => {
    const { layout, finished } = runWithLayoutStream([
      {
        type: 'layout-render',
        slots: { main: { component: 'flightCard' } },
        responsive: [{ belowPx: 768, collapse: ['sidebar'], drawer: [] }],
      },
    ]);
    await finished;

    const state = layout();
    expect(state?.layoutName).toBeUndefined();
    expect(state?.responsive?.[0]?.belowPx).toBe(768);
  });

  it('overwrites prior layout state when the agent emits a new layout-render', async () => {
    const { layout, finished } = runWithLayoutStream([
      {
        type: 'layout-render',
        layoutName: 'a',
        slots: { x: { component: 'docA' } },
      },
      {
        type: 'layout-render',
        layoutName: 'b',
        slots: { y: { component: 'docB' } },
      },
    ]);
    await finished;

    const state = layout();
    expect(state?.layoutName).toBe('b');
    expect(Object.keys(state!.slots)).toEqual(['y']);
  });

  it('drops malformed layout-render events with a console.warn (fail-soft)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { layout, finished } = runWithLayoutStream([
      // empty component name — schema rejects (slotDefSchema requires min(1))
      {
        type: 'layout-render',
        slots: { broken: { component: '' } },
      } as unknown as Parameters<FakeAgenticBackend['enqueueScript']>[0][number],
    ]);
    await finished;

    expect(layout()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('parses optional shared `data` payload into the state', async () => {
    const { layout, finished } = runWithLayoutStream([
      {
        type: 'layout-render',
        layoutName: 'workspace',
        slots: { main: { component: 'documentPreview', props: { docId: 'd' } } },
        data: { custodianId: 'c-7', matterId: 'm-1' },
      },
    ]);
    await finished;
    expect(layout()?.data?.['custodianId']).toBe('c-7');
    expect(layout()?.data?.['matterId']).toBe('m-1');
  });
});

describe('runUntilSettled — back-compat when layoutStream omitted', () => {
  it('drops layout-render events silently when no stream is supplied', async () => {
    const backend = new FakeAgenticBackend();
    backend.enqueueScript([
      {
        type: 'layout-render',
        layoutName: 'wf',
        slots: { main: { component: 'docA' } },
      },
      { type: 'text-delta', messageId: 'm1', delta: 'ok' },
      { type: 'text-end', messageId: 'm1' },
    ]);
    const messages = signal<readonly AgenticMessage[]>([]);
    const ac = new AbortController();
    const telemetry = new InMemoryTelemetrySink();

    // No layoutStream — back-compat path used by existing apps.
    await runUntilSettled({
      backend,
      threadId: 't',
      runId: 'r',
      initialMessages: [],
      tools: [],
      widgets: [],
      messageStream: messages,
      maxLocalTurns: 5,
      signal: ac.signal,
      telemetry,
    });

    // Text path still works; no exception thrown for the layout event.
    expect(messages()[0]?.content).toBe('ok');
  });
});
