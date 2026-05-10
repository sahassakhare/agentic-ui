import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  provideCatalogUsageMetering,
  CatalogUsageMeteringService,
} from './provide-catalog-usage-metering';
import { AGENTIC_TELEMETRY_SINK, type AgenticTelemetrySink } from '../telemetry/telemetry-sink';

interface FetchCall { url: string; init: RequestInit }
function recordingFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string'
      ? input
      : 'url' in (input as Request)
      ? (input as Request).url
      : String(input);
    calls.push({ url, init });
    return handler({ url, init });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const okFetch = () => recordingFetch(async () =>
  new Response(JSON.stringify({ id: 'srv-id' }), { status: 201 }),
);

describe('provideCatalogUsageMetering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues a tool.call usage event when an agentic.tool_call.start span ends', async () => {
    const fx = okFetch();
    TestBed.configureTestingModule({
      providers: [
        provideCatalogUsageMetering({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: fx.fn,
          flushIntervalMs: 0, // disable interval flush; we'll flush manually
        }),
      ],
    });
    const sink = TestBed.inject(AGENTIC_TELEMETRY_SINK);
    const svc = TestBed.inject(CatalogUsageMeteringService);

    const span = sink.startSpan('agentic.tool_call.start', {
      'agentic.tool.name': 'bookFlight',
      'agentic.tool.source': 'host',
    });
    span.end({ 'agentic.tool.success': true });

    await svc.flush();

    expect(fx.calls.length).toBe(1);
    expect(fx.calls[0]?.url).toBe('https://catalog.example.com/v1/catalogs/acme/usage');
    const body = JSON.parse(String(fx.calls[0]?.init.body));
    expect(body.kind).toBe('tool.call');
    expect(body.quantity).toBe(1);
    expect(body.tags['tool.name']).toBe('bookFlight');
    expect(body.tags['tool.source']).toBe('host');
    expect(body.tags.success).toBe(true);
    expect(body.occurredAt).toMatch(/T.*Z/);
    expect(svc.flushed()).toBe(1);
  });

  it('skips tool calls that were queued for HITL approval (didn\'t actually run)', async () => {
    const fx = okFetch();
    TestBed.configureTestingModule({
      providers: [
        provideCatalogUsageMetering({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: fx.fn,
          flushIntervalMs: 0,
        }),
      ],
    });
    const sink = TestBed.inject(AGENTIC_TELEMETRY_SINK);
    const svc = TestBed.inject(CatalogUsageMeteringService);

    const span = sink.startSpan('agentic.tool_call.start', {
      'agentic.tool.name': 'releaseLegalHold',
    });
    span.end({ 'agentic.tool.queued_for_approval': true });

    await svc.flush();
    expect(fx.calls.length).toBe(0);
  });

  it('queues widget.render and federation.load events from emit()', async () => {
    const fx = okFetch();
    TestBed.configureTestingModule({
      providers: [
        provideCatalogUsageMetering({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: fx.fn,
          flushIntervalMs: 0,
        }),
      ],
    });
    const sink = TestBed.inject(AGENTIC_TELEMETRY_SINK);
    const svc = TestBed.inject(CatalogUsageMeteringService);

    sink.emit('agentic.widget.render', { 'agentic.widget.name': 'flight-card' });
    sink.emit('agentic.federation.load.end', { 'agentic.federation.remote.name': 'bookings' });

    await svc.flush();

    expect(fx.calls.length).toBe(2);
    const kinds = fx.calls.map((c) => JSON.parse(String(c.init.body)).kind);
    expect(kinds).toEqual(['widget.render', 'federation.load']);
  });

  it('forwards every event to the delegate sink as well', () => {
    const captured: { name: string; attrs: unknown }[] = [];
    const delegate: AgenticTelemetrySink = {
      startSpan: (name, attrs) => {
        captured.push({ name, attrs });
        return { end: () => {}, recordError: () => {}, setAttribute: () => {} };
      },
      emit: (name, attrs) => { captured.push({ name, attrs }); },
      counter: () => {},
      histogram: () => {},
    };
    TestBed.configureTestingModule({
      providers: [
        provideCatalogUsageMetering({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: okFetch().fn,
          delegate,
          flushIntervalMs: 0,
        }),
      ],
    });
    const sink = TestBed.inject(AGENTIC_TELEMETRY_SINK);

    sink.emit('agentic.run.start', { 'agentic.thread_id': 't1' });
    sink.startSpan('agentic.tool_call.start', { 'agentic.tool.name': 'foo' });

    expect(captured.length).toBe(2);
    expect(captured[0]?.name).toBe('agentic.run.start');
    expect(captured[1]?.name).toBe('agentic.tool_call.start');
  });

  it('flushes on a timer at flushIntervalMs', async () => {
    const fx = okFetch();
    TestBed.configureTestingModule({
      providers: [
        provideCatalogUsageMetering({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: fx.fn,
          flushIntervalMs: 1000,
          maxBatchSize: 1000, // don't auto-flush on size during this test
        }),
      ],
    });
    const sink = TestBed.inject(AGENTIC_TELEMETRY_SINK);
    const svc = TestBed.inject(CatalogUsageMeteringService);

    const span = sink.startSpan('agentic.tool_call.start', { 'agentic.tool.name': 'foo' });
    span.end({ 'agentic.tool.success': true });

    expect(fx.calls.length).toBe(0);

    await vi.advanceTimersByTimeAsync(1100);
    await svc.lastFlush;

    expect(fx.calls.length).toBe(1);
  });

  it('flushes when queue reaches maxBatchSize', async () => {
    const fx = okFetch();
    TestBed.configureTestingModule({
      providers: [
        provideCatalogUsageMetering({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: fx.fn,
          flushIntervalMs: 0, // no time-based flush
          maxBatchSize: 3,
        }),
      ],
    });
    const sink = TestBed.inject(AGENTIC_TELEMETRY_SINK);
    const svc = TestBed.inject(CatalogUsageMeteringService);

    for (let i = 0; i < 3; i++) {
      const span = sink.startSpan('agentic.tool_call.start', { 'agentic.tool.name': `t${i}` });
      span.end({ 'agentic.tool.success': true });
    }
    await svc.lastFlush;

    expect(fx.calls.length).toBe(3);
  });

  it('records failed POSTs in the failed counter', async () => {
    const fail = recordingFetch(async () => new Response('boom', { status: 500 }));
    TestBed.configureTestingModule({
      providers: [
        provideCatalogUsageMetering({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: fail.fn,
          flushIntervalMs: 0,
        }),
      ],
    });
    const sink = TestBed.inject(AGENTIC_TELEMETRY_SINK);
    const svc = TestBed.inject(CatalogUsageMeteringService);

    const span = sink.startSpan('agentic.tool_call.start', { 'agentic.tool.name': 'foo' });
    span.end({ 'agentic.tool.success': false });

    await svc.flush();
    expect(svc.failed()).toBe(1);
    expect(svc.flushed()).toBe(0);
  });
});
