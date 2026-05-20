import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { agenticTool } from '../../factories/agentic-tool';
import { HashbrownBackend } from './hashbrown-backend';
import { InMemoryTelemetrySink } from '../../testing/in-memory-telemetry-sink';
import type { AgenticEvent, AgenticMessage, ToolDef } from '../../internal';

/**
 * Slice L1 — Hashbrown adapter spec. Asserts the parity contract:
 *   - Tools posted with full JSON-Schema parameters
 *   - `state` field threaded
 *   - Inbound NDJSON Zod-validated; malformed lines telemetry'd + dropped
 *   - Malformed events do not corrupt run state
 *
 * Mocks the `fetch` global to control the wire — no live HTTP.
 */

function ndjsonReadable(events: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const ev of events) {
        controller.enqueue(enc.encode(JSON.stringify(ev) + '\n'));
      }
      controller.close();
    },
  });
}

function ndjsonResponse(events: unknown[]): Response {
  return new Response(ndjsonReadable(events), {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

let lastRequest: { url: string; init?: RequestInit; body: unknown } | null = null;

function stubFetch(response: Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    lastRequest = { url, ...(init !== undefined ? { init } : {}), body };
    return response;
  }) as typeof fetch;
}

async function collect(iter: AsyncIterable<AgenticEvent>): Promise<AgenticEvent[]> {
  const out: AgenticEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  threadId: 't-1',
  runId: 'r-1',
  messages: [{ id: 'u-1', role: 'user', content: 'hello', toolCalls: [], widgets: [] }] as readonly AgenticMessage[],
  tools: [] as readonly ToolDef[],
  widgets: [],
  signal: new AbortController().signal,
  ...overrides,
});

describe('HashbrownBackend — L1 parity', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    lastRequest = null;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts tools with their full JSON-Schema parameters (was: dropped)', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([
      { type: 'run-finished', runId: 'r-1' },
    ]));

    const tool = agenticTool({
      name: 'searchDocs',
      description: 'free-text search',
      schema: z.object({ q: z.string(), limit: z.number().optional() }),
      handler: async () => ({ ok: true }),
    });
    const backend = new HashbrownBackend(
      { url: 'http://hashbrown.test/run' },
      new InMemoryTelemetrySink(),
    );

    await collect(backend.run(baseInput({ tools: [tool] as unknown as ToolDef[] })));

    const tools = (lastRequest?.body as { tools: Array<{ name: string; parameters: { properties?: Record<string, unknown> } }> }).tools;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('searchDocs');
    // The pre-L1 wire dropped `parameters`. Assert it's now present.
    expect(tools[0]?.parameters?.properties?.['q']).toBeDefined();
    expect(tools[0]?.parameters?.properties?.['limit']).toBeDefined();
  });

  it('threads the host `state` field per ADR-013 (was: not posted)', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([
      { type: 'run-finished', runId: 'r-1' },
    ]));

    const backend = new HashbrownBackend(
      { url: 'http://hashbrown.test/run' },
      new InMemoryTelemetrySink(),
    );

    await collect(backend.run(baseInput({
      state: { persona: 'lead-counsel', route: '/workspace', matter: 'M-2026-0042' },
    })));

    const state = (lastRequest?.body as { state: Record<string, unknown> }).state;
    expect(state['persona']).toBe('lead-counsel');
    expect(state['route']).toBe('/workspace');
    expect(state['matter']).toBe('M-2026-0042');
  });

  it('defaults `state` to `{}` when none is provided', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([
      { type: 'run-finished', runId: 'r-1' },
    ]));

    const backend = new HashbrownBackend(
      { url: 'http://hashbrown.test/run' },
      new InMemoryTelemetrySink(),
    );
    await collect(backend.run(baseInput()));
    expect((lastRequest?.body as { state: object }).state).toEqual({});
  });

  it('yields valid events from the NDJSON stream', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([
      { type: 'text-delta', messageId: 'm-1', delta: 'hi' },
      { type: 'text-end', messageId: 'm-1' },
      { type: 'run-finished', runId: 'r-1' },
    ]));

    const backend = new HashbrownBackend(
      { url: 'http://hashbrown.test/run' },
      new InMemoryTelemetrySink(),
    );

    const events = await collect(backend.run(baseInput()));
    // run-started is yielded by the adapter; then the 3 wire events;
    // then run-finished is the LAST wire event.
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'run-started', 'text-delta', 'text-end', 'run-finished', 'run-finished',
    ]);
  });

  it('drops malformed NDJSON lines with telemetry (was: cast crashed)', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([
      { type: 'text-delta', delta: 'no-id' },  // missing messageId
      { type: 'text-delta', messageId: 'm-1', delta: 'valid' },
      { type: 'invented-event' },              // unknown type
      { type: 'run-finished', runId: 'r-1' },
    ]));
    const sink = new InMemoryTelemetrySink();

    const backend = new HashbrownBackend(
      { url: 'http://hashbrown.test/run' },
      sink,
    );

    const events = await collect(backend.run(baseInput()));
    // Only the valid text-delta + run-finished pass through.
    const types = events.map((e) => e.type);
    expect(types).toContain('text-delta');
    expect(types.filter((t) => t === 'text-delta')).toHaveLength(1);

    const malformed = sink.eventsByName('agentic.run.malformed_event');
    expect(malformed).toHaveLength(2);
    expect(malformed.every((e) => e.attributes?.['agentic.backend.id'] === 'hashbrown')).toBe(true);
  });

  it('yields run-error when the wire request fails', async () => {
    globalThis.fetch = stubFetch(new Response('boom', { status: 500 }));

    const backend = new HashbrownBackend(
      { url: 'http://hashbrown.test/run' },
      new InMemoryTelemetrySink(),
    );

    const events = await collect(backend.run(baseInput()));
    const err = events.find((e): e is Extract<AgenticEvent, { type: 'run-error' }> => e.type === 'run-error');
    expect(err).toBeDefined();
    expect(err?.error.code).toBe('hashbrown_error');
  });

  it('honours a pre-aborted signal — emits run-started + run-finished, no fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const backend = new HashbrownBackend(
      { url: 'http://hashbrown.test/run' },
      new InMemoryTelemetrySink(),
    );

    const ac = new AbortController();
    ac.abort();
    const events = await collect(backend.run(baseInput({ signal: ac.signal })));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['run-started', 'run-finished']);
  });

  it('advertises capabilities (streaming + clientTools + generativeUi)', () => {
    const backend = new HashbrownBackend(
      { url: 'http://hashbrown.test/run' },
      new InMemoryTelemetrySink(),
    );
    expect(backend.capabilities.streaming).toBe(true);
    expect(backend.capabilities.clientTools).toBe(true);
    expect(backend.capabilities.generativeUi).toBe(true);
    expect(backend.capabilities.uiActions).toBe(false);
  });
});
