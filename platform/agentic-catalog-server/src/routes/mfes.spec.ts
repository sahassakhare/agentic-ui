import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const TENANT = 'test-tenant';
const BASE = `http://localhost/v1/catalogs/${TENANT}/mfes`;

describe('mfes routes', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('rejects without auth (401)', async () => {
    const res = await h.fetch(new Request(BASE));
    expect(res.status).toBe(401);
  });

  it('GET / returns empty list initially', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it('POST creates an MFE remote (201 + Location)', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'bookings',
        manifestUrl: 'https://bookings.example.com/remoteEntry.json',
        version: '1.0.0',
        exposes: { tools: ['bookFlight'] },
      }),
    }));
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toMatch(/\/mfes\/bookings$/);
    const body = await res.json();
    expect(body.name).toBe('bookings');
    expect(body.version).toBe('1.0.0');
    expect(body.exposes).toEqual({ tools: ['bookFlight'] });
  });

  it('POST 422 on invalid name', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'BAD NAME WITH SPACES',
        manifestUrl: 'https://bookings.example.com/remoteEntry.json',
        exposes: {},
      }),
    }));
    expect(res.status).toBe(422);
  });

  it('GET /:name returns the entry', async () => {
    const auth = await h.authHeader();
    await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'loyalty', manifestUrl: 'https://l.example.com/r.json', exposes: {} }),
    }));
    const res = await h.fetch(new Request(`${BASE}/loyalty`, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('loyalty');
  });

  it('GET /:name 404 for missing', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(`${BASE}/no-such-mfe`, { headers: { Authorization: auth } }));
    expect(res.status).toBe(404);
  });

  it('PATCH updates fields', async () => {
    const auth = await h.authHeader();
    await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'support', manifestUrl: 'https://s.example.com/r.json', exposes: {} }),
    }));
    const res = await h.fetch(new Request(`${BASE}/support`, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '2.1.0', status: 'degraded' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('2.1.0');
    expect(body.status).toBe('degraded');
  });

  it('DELETE removes (204)', async () => {
    const auth = await h.authHeader();
    await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'doomed', manifestUrl: 'https://d.example.com/r.json', exposes: {} }),
    }));
    const res = await h.fetch(new Request(`${BASE}/doomed`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    }));
    expect(res.status).toBe(204);

    const get = await h.fetch(new Request(`${BASE}/doomed`, { headers: { Authorization: auth } }));
    expect(get.status).toBe(404);
  });

  it('POST /:name/health updates the status + last_health_at', async () => {
    const auth = await h.authHeader();
    await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'observed', manifestUrl: 'https://o.example.com/r.json', exposes: {} }),
    }));
    const res = await h.fetch(new Request(`${BASE}/observed/health`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'degraded' }),
    }));
    expect(res.status).toBe(204);

    const get = await h.fetch(new Request(`${BASE}/observed`, { headers: { Authorization: auth } }));
    const body = await get.json();
    expect(body.status).toBe('degraded');
    expect(body.lastHealthAt).not.toBeNull();
  });

  it('audit row written for every mutation', async () => {
    const auth = await h.authHeader();
    const before = await h.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'mfe'");
    const beforeN = Number(before.rows[0]?.count ?? '0');

    await h.fetch(new Request(BASE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'audited-mfe', manifestUrl: 'https://a.example.com/r.json', exposes: {} }),
    }));

    const after = await h.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'mfe'");
    const afterN = Number(after.rows[0]?.count ?? '0');
    expect(afterN).toBe(beforeN + 1);
  });
});
