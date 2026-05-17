import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildDisabledAuthHarness, type DisabledAuthHarness } from '../test-helpers/integration.js';

// Use the harness's seeded tenant so capability/role-mapping FK
// inserts find a parent row.
const TENANT = 'test-tenant';
const CAPS = `http://localhost/v1/catalogs/${TENANT}/capabilities`;
const TENANTS = 'http://localhost/v1/tenants';
const ROLE_MAPPINGS = `http://localhost/v1/catalogs/${TENANT}/role-mappings`;

describe('AUTH_MODE=disabled (ADR-022)', () => {
  let h: DisabledAuthHarness;

  beforeAll(async () => { h = await buildDisabledAuthHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('admits unauthenticated requests on tenant-scoped routes', async () => {
    const res = await h.fetch(new Request(CAPS));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], total: 0, limit: 100, offset: 0 });
  });

  it('writes scope to the URL-path tenant', async () => {
    const create = await h.fetch(new Request(CAPS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', name: 'demo-tool', body: {} }),
    }));
    expect(create.status).toBe(201);
    const body = await create.json();
    expect(body.tenantId).toBe(TENANT);
    expect(body.createdBy).toBe('anonymous@auth-disabled');
  });

  it('admits platform-admin endpoints (tenant lifecycle)', async () => {
    const res = await h.fetch(new Request(TENANTS));
    // No 403 — the synthetic principal carries `platform-admin`.
    expect(res.status).toBe(200);
  });

  it('admits role-mapping create with no Authorization header', async () => {
    const res = await h.fetch(new Request(ROLE_MAPPINGS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimPath: 'groups',
        claimValue: 'demo-group',
        runtimePersona: 'paralegal',
      }),
    }));
    expect(res.status).toBe(201);
  });

  it('still validates request bodies via Zod (422 on bad input)', async () => {
    const res = await h.fetch(new Request(CAPS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'not-a-real-kind' }),
    }));
    expect(res.status).toBe(422);
  });

  it('healthz reports authMode=disabled so monitoring can flag it', async () => {
    const res = await h.fetch(new Request('http://localhost/healthz'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authMode).toBe('disabled');
  });

  it('audit row carries actor=anonymous@auth-disabled', async () => {
    await h.fetch(new Request(CAPS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', name: 'audited-cap', body: {} }),
    }));
    const rows = await h.pool.query<{ actor: string; tenant_id: string }>(
      `SELECT actor, tenant_id FROM catalog_audit
       WHERE entity_type = 'capability'
       ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(rows.rows[0]?.actor).toBe('anonymous@auth-disabled');
    expect(rows.rows[0]?.tenant_id).toBe(TENANT);
  });
});
