import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  AGENTIC_TELEMETRY_SINK,
  type AgenticTelemetrySink,
} from '../telemetry/telemetry-sink';
import { agenticDataSource } from '../factories/agentic-data-source';
import { DataSourceRegistry } from './data-source-registry';

/**
 * Telemetry contract for `DataSourceRegistry.getTyped(...)` (per r3 plan §11.5).
 *
 * Every adapter call routed through the typed view records a
 * `data_source.query_ms` histogram tagged with `name`, `kind`, and an
 * `ok` flag. Async adapters await before recording so the histogram
 * captures end-to-end latency.
 */

interface SpySink extends AgenticTelemetrySink {
  readonly histograms: Array<{
    name: string;
    value: number;
    attributes?: Readonly<Record<string, unknown>>;
  }>;
}

function spyTelemetrySink(): SpySink {
  const histograms: SpySink['histograms'] = [];
  return {
    histograms,
    histogram: vi.fn((name: string, value: number, attributes?: Readonly<Record<string, unknown>>) => {
      histograms.push({ name, value, attributes });
    }),
    counter: vi.fn(),
    emit: vi.fn(),
    startSpan: vi.fn(() => ({
      end: vi.fn(),
      recordError: vi.fn(),
      setAttribute: vi.fn(),
    })),
  };
}

describe('DataSourceRegistry — telemetry on getTyped (Capability F2)', () => {
  let registry: DataSourceRegistry;
  let sink: SpySink;

  beforeEach(() => {
    sink = spyTelemetrySink();
    TestBed.configureTestingModule({
      providers: [{ provide: AGENTIC_TELEMETRY_SINK, useValue: sink }],
    });
    registry = TestBed.inject(DataSourceRegistry);
  });

  it('records data_source.query_ms with ok=true on a sync resolved adapter', () => {
    registry.register(
      agenticDataSource({ name: 'syncSource', kind: 'rest', adapter: () => ['a', 'b'] }),
    );
    const typed = registry.getTyped<unknown, readonly string[]>('syncSource');
    expect(typed.adapter(undefined)).toEqual(['a', 'b']);

    const dsHist = sink.histograms.filter((h) => h.name === 'data_source.query_ms');
    expect(dsHist).toHaveLength(1);
    expect(dsHist[0]?.attributes).toMatchObject({
      name: 'syncSource',
      kind: 'rest',
      ok: 'true',
    });
    expect(dsHist[0]?.value).toBeGreaterThanOrEqual(0);
  });

  it('records ok=false when a sync adapter throws', () => {
    registry.register(
      agenticDataSource({
        name: 'badSource',
        kind: 'rest',
        adapter: () => { throw new Error('boom'); },
      }),
    );
    const typed = registry.getTyped('badSource');
    expect(() => typed.adapter(undefined)).toThrow(/boom/);

    const dsHist = sink.histograms.filter((h) => h.name === 'data_source.query_ms');
    expect(dsHist[0]?.attributes).toMatchObject({ name: 'badSource', ok: 'false' });
  });

  it('records ok=true after an async adapter resolves', async () => {
    registry.register(
      agenticDataSource<{ q: string }, Promise<readonly string[]>>({
        name: 'asyncSource',
        kind: 'rest',
        adapter: async () => ['x'],
      }),
    );
    const typed = registry.getTyped<{ q: string }, Promise<readonly string[]>>('asyncSource');
    await typed.adapter({ q: '' });

    const dsHist = sink.histograms.filter((h) => h.name === 'data_source.query_ms');
    expect(dsHist).toHaveLength(1);
    expect(dsHist[0]?.attributes).toMatchObject({ name: 'asyncSource', ok: 'true' });
  });

  it('records ok=false when an async adapter rejects', async () => {
    registry.register(
      agenticDataSource<unknown, Promise<unknown>>({
        name: 'asyncBadSource',
        kind: 'rest',
        adapter: async () => { throw new Error('async-boom'); },
      }),
    );
    const typed = registry.getTyped<unknown, Promise<unknown>>('asyncBadSource');
    await expect(typed.adapter(undefined)).rejects.toThrow(/async-boom/);

    const dsHist = sink.histograms.filter((h) => h.name === 'data_source.query_ms');
    expect(dsHist[0]?.attributes).toMatchObject({ name: 'asyncBadSource', ok: 'false' });
  });
});
