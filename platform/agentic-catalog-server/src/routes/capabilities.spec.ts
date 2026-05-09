import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const TENANT = 'test-tenant';
const BASE = `http://localhost/v1/catalogs/${TENANT}/capabilities`;

describe('capabilities routes', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('rejects requests without an Authorization header', async () => {
    const res = await h.fetch(new Request(BASE));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('problem+json');
    const body = await res.json();
    expect(body.title).toBe('Unauthorized');
    expect(body.requestId).toBeTruthy();
  });

  it('rejects malformed Bearer header', async () => {
    const res = await h.fetch(new Request(BASE, {
      headers: { Authorization: 'NotBearer xxx' },
    }));
    expect(res.status).toBe(401);
  });

  it('rejects path tenant mismatch', async () => {
    const auth = await h.authHeader({ tenantId: 'other-tenant' });
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.detail).toMatch(/Tenant scope mismatch/);
  });

  it('platform-admin role bypasses tenant scope check', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
  });

  it('GET / returns empty list for a fresh tenant', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    });
  });

  it('POST + GET round-trip', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'tool',
        name: 'roundtrip-tool',
        body: { description: 'a tool for testing' },
        lifecycle: 'published',
        tags: ['test'],
      }),
    }));
    expect(create.status).toBe(201);
    // Location is a relative URL per Hono convention — `/v1/catalogs/.../capabilities/<id>`.
    expect(create.headers.get('location')).toMatch(/\/v1\/catalogs\/test-tenant\/capabilities\/[0-9a-f-]{36}$/);
    const created = await create.json();
    expect(created.kind).toBe('tool');
    expect(created.name).toBe('roundtrip-tool');

    const get = await h.fetch(new Request(`${BASE}/${created.id}`, { headers: { Authorization: auth } }));
    expect(get.status).toBe(200);
    const got = await get.json();
    expect(got.id).toBe(created.id);
  });

  it('POST 422 on invalid body (Zod problem+json)', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'not-a-real-kind', name: '', body: 'should-be-object' }),
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.title).toBe('Unprocessable Entity');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('PATCH updates lifecycle', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', name: 'patchable', body: {} }),
    }));
    const created = await create.json();

    const patch = await h.fetch(new Request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lifecycle: 'deprecated' }),
    }));
    expect(patch.status).toBe(200);
    const updated = await patch.json();
    expect(updated.lifecycle).toBe('deprecated');
  });

  it('DELETE soft-deletes (204) and the entry vanishes from default list', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', name: 'doomed', body: {} }),
    }));
    const created = await create.json();

    const del = await h.fetch(new Request(`${BASE}/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    }));
    expect(del.status).toBe(204);

    const list = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    const body = await list.json();
    expect(body.items.find((i: { name: string }) => i.name === 'doomed')).toBeUndefined();

    const inclList = await h.fetch(new Request(`${BASE}?includeDeleted=true`, { headers: { Authorization: auth } }));
    const inclBody = await inclList.json();
    expect(inclBody.items.find((i: { name: string }) => i.name === 'doomed')).toBeDefined();
  });

  it('GET non-UUID id → 404', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}/not-a-uuid`, { headers: { Authorization: auth } }));
    expect(res.status).toBe(404);
  });

  it('every response carries X-Request-Id', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('audit row appended on create', async () => {
    const auth = await h.authHeader();
    const before = await h.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM catalog_audit',
    );
    const beforeN = Number(before.rows[0]?.count ?? '0');

    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', name: 'audited', body: {} }),
    }));
    expect(res.status).toBe(201);

    const after = await h.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM catalog_audit',
    );
    const afterN = Number(after.rows[0]?.count ?? '0');
    expect(afterN).toBe(beforeN + 1);

    const last = await h.pool.query(
      'SELECT operation, entity_type FROM catalog_audit ORDER BY occurred_at DESC LIMIT 1',
    );
    expect(last.rows[0]).toMatchObject({ operation: 'create', entity_type: 'capability' });
  });

  it('list filtering by kind via query param', async () => {
    const auth = await h.authHeader();
    await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'component', name: 'comp-1', body: {} }),
    }));
    const res = await h.fetch(new Request(`${BASE}?kind=component`, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.every((i: { kind: string }) => i.kind === 'component')).toBe(true);
  });
});
