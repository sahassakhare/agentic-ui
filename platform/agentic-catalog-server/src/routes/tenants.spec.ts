import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const BASE = `http://localhost/v1/tenants`;

describe('tenants routes (M4 C7 — platform-admin only)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('rejects unauth (401)', async () => {
    const res = await h.fetch(new Request(BASE));
    expect(res.status).toBe(401);
  });

  it('rejects non-admin tenant member (403)', async () => {
    const auth = await h.authHeader({ roles: ['member'] });
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.detail).toMatch(/platform-admin/i);
  });

  it('platform-admin can list tenants', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.find((t: { id: string }) => t.id === 'test-tenant')).toBeDefined();
  });

  it('POST creates a tenant (201 + Location)', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'acme', displayName: 'Acme Corp', quotas: { monthlyTokens: 1_000_000 } }),
    }));
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toMatch(/\/v1\/tenants\/acme$/);
    const body = await res.json();
    expect(body.id).toBe('acme');
    expect(body.status).toBe('active');
    expect(body.onboardedBy).toBeTruthy();
  });

  it('POST 409 on duplicate id', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const headers = { Authorization: auth, 'Content-Type': 'application/json' };
    const r1 = await h.fetch(new Request(BASE, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 'dup', displayName: 'Dup' }),
    }));
    expect(r1.status).toBe(201);
    const r2 = await h.fetch(new Request(BASE, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 'dup', displayName: 'Dup again' }),
    }));
    expect(r2.status).toBe(409);
  });

  it('POST 422 on invalid id (contains slash)', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'bad/id', displayName: 'X' }),
    }));
    expect(res.status).toBe(422);
  });

  it('GET /:id returns the tenant; 404 on missing', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const get = await h.fetch(new Request(`${BASE}/test-tenant`, { headers: { Authorization: auth } }));
    expect(get.status).toBe(200);
    const got = await get.json();
    expect(got.id).toBe('test-tenant');

    const miss = await h.fetch(new Request(`${BASE}/no-such`, { headers: { Authorization: auth } }));
    expect(miss.status).toBe(404);
  });

  it('PATCH updates displayName + quotas; rejects id changes implicitly', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const headers = { Authorization: auth, 'Content-Type': 'application/json' };
    await h.fetch(new Request(BASE, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 'patchable', displayName: 'P' }),
    }));
    const patch = await h.fetch(new Request(`${BASE}/patchable`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ displayName: 'Patched', quotas: { maxCapabilities: 50 } }),
    }));
    expect(patch.status).toBe(200);
    const updated = await patch.json();
    expect(updated.displayName).toBe('Patched');
    expect(updated.quotas).toEqual({ maxCapabilities: 50 });
  });

  it('POST /:id/suspend sets status + reason', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const headers = { Authorization: auth, 'Content-Type': 'application/json' };
    await h.fetch(new Request(BASE, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 'pausable', displayName: 'P' }),
    }));
    const sus = await h.fetch(new Request(`${BASE}/pausable/suspend`, {
      method: 'POST', headers,
      body: JSON.stringify({ reason: 'overdue invoice' }),
    }));
    expect(sus.status).toBe(200);
    const body = await sus.json();
    expect(body.status).toBe('suspended');
    expect(body.suspendedReason).toBe('overdue invoice');
  });

  it('POST /:id/activate resumes a suspended tenant', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const headers = { Authorization: auth, 'Content-Type': 'application/json' };
    await h.fetch(new Request(BASE, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 'resumable', displayName: 'R' }),
    }));
    await h.fetch(new Request(`${BASE}/resumable/suspend`, {
      method: 'POST', headers,
      body: JSON.stringify({ reason: 'temp' }),
    }));
    const act = await h.fetch(new Request(`${BASE}/resumable/activate`, {
      method: 'POST', headers,
      body: '{}',
    }));
    expect(act.status).toBe(200);
    const body = await act.json();
    expect(body.status).toBe('active');
    expect(body.suspendedReason).toBeNull();
  });

  it('DELETE soft-deletes; subsequent DELETE returns 404', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const headers = { Authorization: auth, 'Content-Type': 'application/json' };
    await h.fetch(new Request(BASE, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 'doomed', displayName: 'D' }),
    }));
    const del1 = await h.fetch(new Request(`${BASE}/doomed`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    }));
    expect(del1.status).toBe(204);
    const del2 = await h.fetch(new Request(`${BASE}/doomed`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    }));
    expect(del2.status).toBe(404);
  });

  it('lifecycle mutations append audit rows scoped to the affected tenant', async () => {
    const auth = await h.authHeader({ tenantId: 'mgmt', roles: ['platform-admin'] });
    const headers = { Authorization: auth, 'Content-Type': 'application/json' };
    const beforeCount = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'tenant'`,
    );
    const startN = Number(beforeCount.rows[0]?.count ?? '0');

    await h.fetch(new Request(BASE, {
      method: 'POST', headers,
      body: JSON.stringify({ id: 'audited', displayName: 'A' }),
    }));
    await h.fetch(new Request(`${BASE}/audited/suspend`, {
      method: 'POST', headers,
      body: JSON.stringify({ reason: 'test' }),
    }));

    const afterCount = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'tenant'`,
    );
    const endN = Number(afterCount.rows[0]?.count ?? '0');
    expect(endN).toBe(startN + 2);

    const rows = await h.pool.query<{ tenant_id: string; entity_id: string }>(
      `SELECT tenant_id, entity_id FROM catalog_audit
       WHERE entity_type = 'tenant' AND entity_id = 'audited'
       ORDER BY occurred_at ASC`,
    );
    expect(rows.rows.length).toBe(2);
    expect(rows.rows.every((r) => r.tenant_id === 'audited')).toBe(true);
  });
});
