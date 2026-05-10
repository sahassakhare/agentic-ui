import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const TENANT = 'test-tenant';
const BUNDLES = `http://localhost/v1/catalogs/${TENANT}/policy/bundles`;
const DECIDE = `http://localhost/v1/catalogs/${TENANT}/policy/decide`;

describe('policy routes — slice OPA-A / ADR-040', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('GET /bundles returns empty list for a fresh tenant', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BUNDLES, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [] });
  });

  it('POST + GET round-trip; isActive defaults to false', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BUNDLES, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'baseline-allow',
        regoSource: 'package maverick.allow\n\ndefault allow := false\nallow := true { input.subject.role == "lead-counsel" }',
        rulePath: 'maverick/allow',
      }),
    }));
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.name).toBe('baseline-allow');
    expect(created.isActive).toBe(false);
    expect(created.rulePath).toBe('maverick/allow');

    const get = await h.fetch(new Request(`${BUNDLES}/${created.id}`, { headers: { Authorization: auth } }));
    expect(get.status).toBe(200);
    const got = await get.json();
    expect(got.name).toBe(created.name);
    expect(got.regoSource).toContain('package maverick.allow');
  });

  it('POST 422 on invalid body (missing regoSource, bad rule_path chars)', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BUNDLES, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad', regoSource: '', rulePath: 'spaces in path' }),
    }));
    expect(res.status).toBe(422);
  });

  it('POST 409 on duplicate name', async () => {
    const auth = await h.authHeader();
    const body = JSON.stringify({ name: 'dup-bundle', regoSource: 'package x\n' });
    const first = await h.fetch(new Request(BUNDLES, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body,
    }));
    expect(first.status).toBe(201);
    const second = await h.fetch(new Request(BUNDLES, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body,
    }));
    expect(second.status).toBe(409);
  });

  it('PATCH isActive=true demotes any previously-active bundle (one-active-per-tenant invariant)', async () => {
    const auth = await h.authHeader();
    const create = (name: string, isActive: boolean) => h.fetch(new Request(BUNDLES, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, regoSource: 'package x\n', isActive }),
    }));
    const a = await (await create('bundle-a', true)).json();
    const b = await (await create('bundle-b', false)).json();

    expect(a.isActive).toBe(true);
    expect(b.isActive).toBe(false);

    // Now activate B — A should be demoted.
    const patch = await h.fetch(new Request(`${BUNDLES}/${b.id}`, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    }));
    expect(patch.status).toBe(200);
    const updatedB = await patch.json();
    expect(updatedB.isActive).toBe(true);

    const reloaded = await (await h.fetch(new Request(`${BUNDLES}/${a.id}`, { headers: { Authorization: auth } }))).json();
    expect(reloaded.isActive).toBe(false);
  });

  it('DELETE soft-deletes via DELETE row + audit row', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(new Request(BUNDLES, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'doomed-bundle', regoSource: 'package x\n' }),
    }));
    const created = await create.json();

    const del = await h.fetch(new Request(`${BUNDLES}/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    }));
    expect(del.status).toBe(204);

    const get = await h.fetch(new Request(`${BUNDLES}/${created.id}`, { headers: { Authorization: auth } }));
    expect(get.status).toBe(404);
  });

  it('POST /decide returns 422 when OPA_URL is unset (default in tests)', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(DECIDE, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: { role: 'paralegal' }, action: 'invoke', resource: { tool: 'addCustodian' } }),
    }));
    expect(res.status).toBe(422);
    const problem = await res.json();
    expect(problem.detail).toMatch(/OPA policy decisions not configured/);
  });

  it('audit row appended on bundle create (entity_type=policy_bundle)', async () => {
    const auth = await h.authHeader();
    const before = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'policy_bundle'`,
    );
    const beforeN = Number(before.rows[0]?.count ?? '0');

    const res = await h.fetch(new Request(BUNDLES, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'audited-bundle', regoSource: 'package x\n' }),
    }));
    expect(res.status).toBe(201);

    const after = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog_audit WHERE entity_type = 'policy_bundle'`,
    );
    expect(Number(after.rows[0]?.count ?? '0')).toBe(beforeN + 1);
  });
});
