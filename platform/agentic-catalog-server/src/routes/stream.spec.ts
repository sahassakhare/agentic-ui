import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';
import { catalogBus } from '../events/catalog-bus.js';

const TENANT = 'test-tenant';
const STREAM = `http://localhost/v1/catalogs/${TENANT}/stream`;
const CAPS = `http://localhost/v1/catalogs/${TENANT}/capabilities`;

/**
 * Drains a Response body and parses SSE frames. Each frame is
 * `event: <name>\ndata: <json>\n\n`. Returns the first N frames or
 * stops when the body closes.
 */
async function readSSEFrames(
  res: Response,
  count: number,
  timeoutMs = 2000,
): Promise<{ event: string; data: string }[]> {
  if (!res.body) throw new Error('response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames: { event: string; data: string }[] = [];
  let buf = '';
  const start = Date.now();
  while (frames.length < count) {
    if (Date.now() - start > timeoutMs) break;
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = /event:\s*(\S+)/.exec(block)?.[1] ?? '';
      const data = /data:\s*(.+)/.exec(block)?.[1] ?? '';
      frames.push({ event, data });
      if (frames.length >= count) break;
    }
  }
  void reader.cancel();
  return frames;
}

describe('SSE stream route (ADR-027)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('rejects unauth', async () => {
    const res = await h.fetch(new Request(STREAM));
    expect(res.status).toBe(401);
    // Drain the body so the harness doesn't retain it.
    await res.text();
  });

  it('opens a stream with the open frame, then emits mutation frames for the same tenant', async () => {
    const auth = await h.authHeader();
    // Fire-and-forget the stream subscribe; we'll trigger an event
    // afterwards.
    const subscribePromise = h.fetch(new Request(STREAM, {
      headers: { Authorization: auth, Accept: 'text/event-stream' },
    }));

    // Give the subscriber a beat to connect + register on the bus.
    // (in-process; usually instant)
    await new Promise((r) => setTimeout(r, 50));

    // Trigger a mutation: create a capability via the public route.
    const create = await h.fetch(new Request(CAPS, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', name: 'sse-test', body: {} }),
    }));
    expect(create.status).toBe(201);

    const res = await subscribePromise;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const frames = await readSSEFrames(res, 2, 2000);
    // First frame is `open`, second should be the mutation.
    expect(frames[0]?.event).toBe('open');
    expect(frames[1]?.event).toBe('mutation');
    const payload = JSON.parse(frames[1]!.data);
    expect(payload).toMatchObject({
      tenantId: TENANT,
      entityType: 'capability',
      operation: 'create',
    });
    expect(payload.summary).toMatchObject({ kind: 'tool', name: 'sse-test' });
  });

  it('filters out events for other tenants', async () => {
    // Fire a mutation event manually for a different tenant on the
    // shared bus while listening on TENANT's stream.
    const auth = await h.authHeader();
    const subscribePromise = h.fetch(new Request(STREAM, {
      headers: { Authorization: auth, Accept: 'text/event-stream' },
    }));
    await new Promise((r) => setTimeout(r, 50));

    catalogBus.emit({
      tenantId: 'other-tenant',
      entityType: 'capability',
      operation: 'create',
      entityId: 'cap-other',
      occurredAt: new Date().toISOString(),
    });
    catalogBus.emit({
      tenantId: TENANT,
      entityType: 'capability',
      operation: 'update',
      entityId: 'cap-mine',
      occurredAt: new Date().toISOString(),
    });

    const res = await subscribePromise;
    const frames = await readSSEFrames(res, 2, 1000);
    // open + the only mutation that matches TENANT
    expect(frames[0]?.event).toBe('open');
    expect(frames[1]?.event).toBe('mutation');
    const payload = JSON.parse(frames[1]!.data);
    expect(payload.tenantId).toBe(TENANT);
    expect(payload.entityId).toBe('cap-mine');
  });

  it('cleans up bus subscribers when the stream is cancelled', async () => {
    const auth = await h.authHeader();
    const before = catalogBus.listenerCount();

    const res = await h.fetch(new Request(STREAM, {
      headers: { Authorization: auth, Accept: 'text/event-stream' },
    }));
    expect(res.status).toBe(200);

    // Wait long enough for the open frame + subscription to register.
    await new Promise((r) => setTimeout(r, 100));
    const peak = catalogBus.listenerCount();
    expect(peak).toBeGreaterThan(before);

    // Cancel the body; Hono's onAbort should fire and unsubscribe.
    await res.body!.cancel();
    await new Promise((r) => setTimeout(r, 100));
    expect(catalogBus.listenerCount()).toBeLessThanOrEqual(peak - 1);
  });
});
