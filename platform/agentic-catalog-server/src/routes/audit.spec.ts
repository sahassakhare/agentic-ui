import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const TENANT = 'test-tenant';
const BASE = `http://localhost/v1/catalogs/${TENANT}/audit`;
const CAPS = `http://localhost/v1/catalogs/${TENANT}/capabilities`;

describe('audit routes (M3 C4)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('rejects unauth (401)', async () => {
    const res = await h.fetch(new Request(`${BASE}/export`));
    expect(res.status).toBe(401);
  });

  it('export returns a JSONL stream with one line per audit row', async () => {
    const auth = await h.authHeader();
    // Generate two audit rows by exercising the capabilities CRUD.
    const c1 = await h.fetch(new Request(CAPS, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', name: 'audited-1', body: {} }),
    }));
    expect(c1.status).toBe(201);
    const c2 = await h.fetch(new Request(CAPS, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool', name: 'audited-2', body: {} }),
    }));
    expect(c2.status).toBe(201);

    const res = await h.fetch(new Request(`${BASE}/export`, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    expect(res.headers.get('content-disposition')).toContain('audit-test-tenant.jsonl');
    const body = await res.text();
    const lines = body.trim().split('\n').filter((s) => s.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const parsed = lines.map((l) => JSON.parse(l));
    for (const row of parsed) {
      expect(row).toMatchObject({
        tenantId: TENANT,
        operation: expect.any(String),
        entityType: expect.any(String),
        entityId: expect.any(String),
      });
      expect(row.entryHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.prevHash).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof row.chainPosition).toBe('number');
    }
  });

  it('verify returns {valid: true} for an untampered chain', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}/verify`, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(typeof body.checkedRows).toBe('number');
    expect(body.brokenAt).toBeNull();
  });

  it('export 422 on invalid query parameter (bad ISO date)', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}/export?from=not-a-date`, {
      headers: { Authorization: auth },
    }));
    expect(res.status).toBe(422);
  });

  it('export honours an explicit limit query parameter', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}/export?limit=1`, {
      headers: { Authorization: auth },
    }));
    expect(res.status).toBe(200);
    const body = await res.text();
    const lines = body.trim().split('\n').filter((s) => s.length > 0);
    expect(lines.length).toBeLessThanOrEqual(1);
  });
});
