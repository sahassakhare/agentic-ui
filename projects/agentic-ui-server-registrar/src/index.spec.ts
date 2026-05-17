import { describe, expect, it, vi } from 'vitest';
import { registerAgentWithCatalog } from './index.js';

interface FetchCall { url: string; init: RequestInit }

function recordingFetch(handler: (call: FetchCall) => Response | Promise<Response>): {
  fn: typeof fetch; calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const SILENT_LOGGER = { info: () => {}, warn: () => {} };

describe('registerAgentWithCatalog', () => {
  it('POSTs to /agents with the agent payload + bearer auth, returns the assigned id', async () => {
    const fx = recordingFetch(async () =>
      new Response(JSON.stringify({ id: 'a-123' }), { status: 201 }),
    );
    const reg = await registerAgentWithCatalog({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => 'tok-abc',
      agent: {
        name: 'gemini',
        kind: 'ag-ui',
        manifestUrl: 'https://agent.example.com/run',
        capabilities: ['bookFlight'],
      },
      fetchFn: fx.fn,
      heartbeatIntervalMs: 0,
      logger: SILENT_LOGGER,
    });
    expect(reg.id).toBe('a-123');

    expect(fx.calls.length).toBe(1);
    expect(fx.calls[0]?.url).toBe('https://catalog.example.com/v1/catalogs/acme/agents');
    const headers = fx.calls[0]?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-abc');
    const body = JSON.parse(String(fx.calls[0]?.init.body));
    expect(body.name).toBe('gemini');
    expect(body.capabilities).toEqual(['bookFlight']);
  });

  it('on 409 (already registered), recovers id via list lookup by name', async () => {
    let callCount = 0;
    const fx = recordingFetch(async () => {
      callCount += 1;
      if (callCount === 1) return new Response('conflict', { status: 409 });
      return new Response(
        JSON.stringify({ items: [
          { id: 'a-1', name: 'other' },
          { id: 'a-2', name: 'gemini' },
        ] }),
        { status: 200 },
      );
    });
    const reg = await registerAgentWithCatalog({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      agent: {
        name: 'gemini',
        kind: 'ag-ui',
        manifestUrl: 'https://agent.example.com/run',
      },
      fetchFn: fx.fn,
      heartbeatIntervalMs: 0,
      logger: SILENT_LOGGER,
    });
    expect(reg.id).toBe('a-2');
    expect(fx.calls.length).toBe(2); // POST → 409 → GET list
  });

  it('on network error during registration, returns id=null but doesn\'t throw (server keeps running)', async () => {
    const fx = recordingFetch(async () => { throw new Error('econnrefused'); });
    const reg = await registerAgentWithCatalog({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      agent: { name: 'gemini', kind: 'ag-ui', manifestUrl: 'https://x.com' },
      fetchFn: fx.fn,
      heartbeatIntervalMs: 0,
      logger: SILENT_LOGGER,
    });
    expect(reg.id).toBeNull();
  });

  it('on heartbeatIntervalMs > 0 with valid id, sets up a ticking heartbeat', async () => {
    vi.useFakeTimers();
    try {
      const fx = recordingFetch(async () =>
        new Response(JSON.stringify({ id: 'a-tick', status: 'active' }), { status: 201 }),
      );
      const reg = await registerAgentWithCatalog({
        catalogUrl: 'https://catalog.example.com',
        tenantId: 'acme',
        getToken: () => null,
        agent: { name: 'tick', kind: 'ag-ui', manifestUrl: 'https://x.com' },
        fetchFn: fx.fn,
        heartbeatIntervalMs: 1000,
        logger: SILENT_LOGGER,
      });
      expect(reg.id).toBe('a-tick');
      expect(fx.calls.length).toBe(1);

      // Advance 3.5s — should see 3 heartbeats.
      await vi.advanceTimersByTimeAsync(3500);
      expect(fx.calls.length).toBeGreaterThanOrEqual(4); // 1 register + 3 heartbeats
      const heartbeatCalls = fx.calls.slice(1);
      for (const c of heartbeatCalls) {
        expect(c.url).toContain('/heartbeat');
      }

      await reg.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shutdown() POSTs status=inactive heartbeat + clears the timer', async () => {
    const fx = recordingFetch(async () =>
      new Response(JSON.stringify({ id: 'a-x', status: 'active' }), { status: 201 }),
    );
    const reg = await registerAgentWithCatalog({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      agent: { name: 'x', kind: 'ag-ui', manifestUrl: 'https://x.com' },
      fetchFn: fx.fn,
      heartbeatIntervalMs: 0, // disable timer; just test shutdown
      logger: SILENT_LOGGER,
    });

    await reg.shutdown();
    const last = fx.calls[fx.calls.length - 1];
    expect(last?.url).toContain('/heartbeat');
    const body = JSON.parse(String(last?.init.body));
    expect(body.status).toBe('inactive');
  });

  it('explicit heartbeat(status) call POSTs the supplied status', async () => {
    const fx = recordingFetch(async () =>
      new Response(JSON.stringify({ id: 'a-d' }), { status: 201 }),
    );
    const reg = await registerAgentWithCatalog({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      agent: { name: 'd', kind: 'ag-ui', manifestUrl: 'https://x.com' },
      fetchFn: fx.fn,
      heartbeatIntervalMs: 0,
      logger: SILENT_LOGGER,
    });
    await reg.heartbeat('degraded');
    const last = fx.calls[fx.calls.length - 1];
    const body = JSON.parse(String(last?.init.body));
    expect(body.status).toBe('degraded');
  });
});
