import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const TENANT = 'test-tenant';
const BASE = `http://localhost/v1/catalogs/${TENANT}/role-mappings`;

describe('role-mappings routes', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  // ── auth + tenant scope ─────────────────────────────────────────
  it('rejects without auth (401)', async () => {
    const res = await h.fetch(new Request(BASE));
    expect(res.status).toBe(401);
  });

  it('rejects path tenant mismatch (403)', async () => {
    const auth = await h.authHeader({ tenantId: 'other-tenant' });
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(403);
  });

  // ── LIST ────────────────────────────────────────────────────────
  it('GET / returns an empty list initially', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [] });
  });

  // ── CREATE ──────────────────────────────────────────────────────
  it('POST creates a mapping (201 + Location)', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'groups',
        claimValue: 'engineering@acme.com',
        runtimePersona: 'paralegal',
        priority: 100,
        enabled: true,
      }),
    }));
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toMatch(/\/role-mappings\/[0-9a-f-]{36}$/);
    const body = await res.json();
    expect(body.runtimePersona).toBe('paralegal');
    expect(body.priority).toBe(100);
    expect(body.enabled).toBe(true);
  });

  it('POST 422 on invalid body', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimValue: '', runtimePersona: '' }),
    }));
    expect(res.status).toBe(422);
  });

  // ── PRIVILEGE-ESCALATION GUARD ──────────────────────────────────
  it('non-admin cannot create a mapping to a protected persona (403)', async () => {
    const auth = await h.authHeader({ roles: ['member'] });
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'groups',
        claimValue: 'execs',
        runtimePersona: 'platform-admin',
      }),
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.detail).toMatch(/protected/i);
  });

  it('platform-admin CAN create a mapping to a protected persona', async () => {
    const auth = await h.authHeader({ roles: ['platform-admin'] });
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'groups',
        claimValue: 'execs-admin',
        runtimePersona: 'platform-admin',
      }),
    }));
    expect(res.status).toBe(201);
  });

  it('non-admin cannot patch runtimePersona to a protected persona (403)', async () => {
    const adminAuth = await h.authHeader({ roles: ['platform-admin'] });
    // create as admin first with a non-protected persona
    const createRes = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'groups',
        claimValue: 'patchable',
        runtimePersona: 'paralegal',
      }),
    }));
    const created = await createRes.json();

    // member tries to escalate
    const memberAuth = await h.authHeader({ roles: ['member'] });
    const patch = await h.fetch(new Request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: memberAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtimePersona: 'lead-counsel' }),
    }));
    expect(patch.status).toBe(403);
  });

  // ── READ / UPDATE / DELETE ──────────────────────────────────────
  it('GET /:id returns the mapping; non-UUID → 404', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'groups', claimValue: 'getme', runtimePersona: 'paralegal',
      }),
    }));
    const created = await create.json();

    const get = await h.fetch(new Request(`${BASE}/${created.id}`, { headers: { Authorization: auth } }));
    expect(get.status).toBe(200);
    const got = await get.json();
    expect(got.id).toBe(created.id);

    const bad = await h.fetch(new Request(`${BASE}/not-a-uuid`, { headers: { Authorization: auth } }));
    expect(bad.status).toBe(404);
  });

  it('PATCH updates priority + enabled', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'groups', claimValue: 'tweakme', runtimePersona: 'paralegal', priority: 100,
      }),
    }));
    const created = await create.json();

    const patch = await h.fetch(new Request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 250, enabled: false }),
    }));
    expect(patch.status).toBe(200);
    const updated = await patch.json();
    expect(updated.priority).toBe(250);
    expect(updated.enabled).toBe(false);
  });

  it('DELETE returns 204; subsequent DELETE returns 404', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'groups', claimValue: 'doomed-mapping', runtimePersona: 'paralegal',
      }),
    }));
    const created = await create.json();

    const del = await h.fetch(new Request(`${BASE}/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    }));
    expect(del.status).toBe(204);

    const del2 = await h.fetch(new Request(`${BASE}/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    }));
    expect(del2.status).toBe(404);
  });

  // ── RESOLVE ─────────────────────────────────────────────────────
  it('POST /resolve returns null persona when no claim values match', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}/resolve`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimPath: 'groups', claimValues: ['no-such-group'] }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimePersona).toBeNull();
    expect(body.matchedClaimValues).toEqual([]);
    expect(body.mappingId).toBeNull();
  });

  it('POST /resolve picks the highest-priority enabled mapping', async () => {
    const auth = await h.authHeader();
    // priority 50 vs priority 100; the latter should win
    await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'resolve-test', claimValue: 'low', runtimePersona: 'paralegal', priority: 50,
      }),
    }));
    const adminAuth = await h.authHeader({ roles: ['platform-admin'] });
    await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: adminAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'resolve-test', claimValue: 'high', runtimePersona: 'lead-counsel', priority: 100,
      }),
    }));

    const res = await h.fetch(new Request(`${BASE}/resolve`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimPath: 'resolve-test', claimValues: ['low', 'high'] }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimePersona).toBe('lead-counsel');
    expect(body.priority).toBe(100);
  });

  it('POST /resolve 422 on malformed body', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}/resolve`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimValues: 'not-an-array' }),
    }));
    expect(res.status).toBe(422);
  });

  // ── Audit row ───────────────────────────────────────────────────
  it('audit row appended on create + delete', async () => {
    const auth = await h.authHeader();
    const before = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'role_mapping'`,
    );
    const beforeN = Number(before.rows[0]?.count ?? '0');

    const create = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'groups', claimValue: 'audited', runtimePersona: 'paralegal',
      }),
    }));
    const created = await create.json();

    await h.fetch(new Request(`${BASE}/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    }));

    const after = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'role_mapping'`,
    );
    const afterN = Number(after.rows[0]?.count ?? '0');
    expect(afterN).toBe(beforeN + 2);
  });
});
