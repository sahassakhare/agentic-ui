import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const TENANT = 'test-tenant';
const BASE = `http://localhost/v1/catalogs/${TENANT}/usage`;

describe('usage routes (M3 C5)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('rejects unauth (401)', async () => {
    const res = await h.fetch(new Request(BASE));
    expect(res.status).toBe(401);
  });

  it('POST creates a usage event (201)', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'llm.tokens.input',
        quantity: 1234,
        tags: { model: 'gpt-4o' },
      }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe('llm.tokens.input');
    expect(body.quantity).toBe(1234);
    expect(body.tags).toEqual({ model: 'gpt-4o' });
  });

  it('POST 422 on invalid kind (uppercase)', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'BAD', quantity: 1 }),
    }));
    expect(res.status).toBe(422);
  });

  it('POST 422 on negative quantity', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'k', quantity: -1 }),
    }));
    expect(res.status).toBe(422);
  });

  it('idempotent POST returns the same event on replay', async () => {
    const auth = await h.authHeader();
    const headers = { Authorization: auth, 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      kind: 'tool.invoke', quantity: 1, idempotencyKey: 'idemp-1',
    });
    const r1 = await h.fetch(new Request(BASE, { method: 'POST', headers, body }));
    const r2 = await h.fetch(new Request(BASE, {
      method: 'POST', headers,
      body: JSON.stringify({ kind: 'tool.invoke', quantity: 999, idempotencyKey: 'idemp-1' }),
    }));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j2.id).toBe(j1.id);
    expect(j2.quantity).toBe(1);
  });

  it('GET / aggregates by kind', async () => {
    const auth = await h.authHeader();
    const headers = { Authorization: auth, 'Content-Type': 'application/json' };
    await h.fetch(new Request(BASE, { method: 'POST', headers,
      body: JSON.stringify({ kind: 'llm.tokens.input', quantity: 100 }) }));
    await h.fetch(new Request(BASE, { method: 'POST', headers,
      body: JSON.stringify({ kind: 'llm.tokens.input', quantity: 200 }) }));
    await h.fetch(new Request(BASE, { method: 'POST', headers,
      body: JSON.stringify({ kind: 'llm.tokens.output', quantity: 50 }) }));

    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.byKind['llm.tokens.input']).toBeGreaterThanOrEqual(300);
    expect(body.byKind['llm.tokens.output']).toBeGreaterThanOrEqual(50);
    expect(typeof body.totalQuantity).toBe('number');
  });

  it('GET / 422 on malformed query', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}?from=not-a-date`, {
      headers: { Authorization: auth },
    }));
    expect(res.status).toBe(422);
  });

  it('GET /recent returns events newest-first', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}/recent?limit=10`, {
      headers: { Authorization: auth },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('GET /recent 422 on invalid limit', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}/recent?limit=99999`, {
      headers: { Authorization: auth },
    }));
    expect(res.status).toBe(422);
  });

  it('rejects path tenant mismatch (403)', async () => {
    const auth = await h.authHeader({ tenantId: 'other-tenant' });
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(403);
  });
});
