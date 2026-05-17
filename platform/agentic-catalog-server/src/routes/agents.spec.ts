import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const TENANT = 'test-tenant';
const BASE = `http://localhost/v1/catalogs/${TENANT}/agents`;

describe('agents routes (slice AGT / ADR-039)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('rejects requests without an Authorization header', async () => {
    const res = await h.fetch(new Request(BASE));
    expect(res.status).toBe(401);
  });

  it('GET / returns empty list for a fresh tenant', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [] });
  });

  it('POST + GET round-trip', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'gemini-coordinator',
        kind: 'ag-ui',
        manifestUrl: 'https://agents.example.com/v1/agents/gemini',
        version: '1.0.0',
        capabilities: ['bookFlight', 'searchDocuments'],
      }),
    }));
    expect(create.status).toBe(201);
    expect(create.headers.get('location')).toMatch(/\/v1\/catalogs\/test-tenant\/agents\/[0-9a-f-]{36}$/);
    const created = await create.json();
    expect(created.name).toBe('gemini-coordinator');
    expect(created.kind).toBe('ag-ui');
    expect(created.capabilities).toEqual(['bookFlight', 'searchDocuments']);
    expect(created.status).toBe('active');
    expect(created.lastHealthAt).toBeTruthy();

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
      body: JSON.stringify({ kind: 'unknown-kind', name: '', manifestUrl: 'not-a-url' }),
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.title).toBe('Unprocessable Entity');
  });

  it('POST 409 on duplicate name (idempotent registrar)', async () => {
    const auth = await h.authHeader();
    const body = JSON.stringify({
      name: 'duplicate-agent',
      kind: 'ag-ui',
      manifestUrl: 'https://agents.example.com/agents/dup',
    });
    const first = await h.fetch(new Request(BASE, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body,
    }));
    expect(first.status).toBe(201);
    const second = await h.fetch(new Request(BASE, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body,
    }));
    expect(second.status).toBe(409);
    const problem = await second.json();
    expect(problem.title).toBe('Conflict');
  });

  it('PATCH updates status + manifestUrl', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'patchable-agent',
        kind: 'mcp',
        manifestUrl: 'https://agents.example.com/v1/agents/old',
      }),
    }));
    const created = await create.json();

    const patch = await h.fetch(new Request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'degraded',
        manifestUrl: 'https://agents.example.com/v1/agents/new',
      }),
    }));
    expect(patch.status).toBe(200);
    const updated = await patch.json();
    expect(updated.status).toBe('degraded');
    expect(updated.manifestUrl).toBe('https://agents.example.com/v1/agents/new');
  });

  it('POST /:id/heartbeat updates last_health_at without auditing', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'heartbeat-agent',
        kind: 'ag-ui',
        manifestUrl: 'https://agents.example.com/v1/agents/hb',
      }),
    }));
    const created = await create.json();
    const initialHealth = created.lastHealthAt as string;

    // Wait a bit so the heartbeat timestamp differs.
    await new Promise((r) => setTimeout(r, 50));

    const hb = await h.fetch(new Request(`${BASE}/${created.id}/heartbeat`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    }));
    expect(hb.status).toBe(200);
    const updated = await hb.json();
    expect(updated.lastHealthAt).not.toBe(initialHealth);
    expect(new Date(updated.lastHealthAt).getTime())
      .toBeGreaterThan(new Date(initialHealth).getTime());
  });

  it('DELETE soft-deletes (204) and the entry vanishes from list', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'doomed-agent',
        kind: 'ag-ui',
        manifestUrl: 'https://agents.example.com/v1/agents/doomed',
      }),
    }));
    const created = await create.json();

    const del = await h.fetch(new Request(`${BASE}/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    }));
    expect(del.status).toBe(204);

    const list = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    const body = await list.json();
    expect(body.items.find((a: { name: string }) => a.name === 'doomed-agent')).toBeUndefined();
  });

  it('audit row appended on create (operation=create, entity_type=agent)', async () => {
    const auth = await h.authHeader();
    const before = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'agent'`,
    );
    const beforeN = Number(before.rows[0]?.count ?? '0');

    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'audited-agent',
        kind: 'ag-ui',
        manifestUrl: 'https://agents.example.com/v1/agents/aud',
      }),
    }));
    expect(res.status).toBe(201);

    const after = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'agent'`,
    );
    const afterN = Number(after.rows[0]?.count ?? '0');
    expect(afterN).toBe(beforeN + 1);
  });

  it('heartbeat does NOT append an audit row (heartbeats too frequent)', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'no-audit-heartbeat',
        kind: 'ag-ui',
        manifestUrl: 'https://agents.example.com/v1/agents/nah',
      }),
    }));
    const created = await create.json();

    const before = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_id = $1`,
      [created.id],
    );
    const beforeN = Number(before.rows[0]?.count ?? '0');

    await h.fetch(new Request(`${BASE}/${created.id}/heartbeat`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));

    const after = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_id = $1`,
      [created.id],
    );
    const afterN = Number(after.rows[0]?.count ?? '0');
    expect(afterN).toBe(beforeN);
  });
});
