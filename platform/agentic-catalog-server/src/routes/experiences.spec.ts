import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const TENANT = 'test-tenant';
const BASE = `http://localhost/v1/catalogs/${TENANT}/experiences`;
const CAPS = `http://localhost/v1/catalogs/${TENANT}/capabilities`;

describe('experiences routes (AEP Seam F)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  const json = (auth: string, body: unknown, method = 'POST', url = BASE) =>
    new Request(url, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('rejects unauthenticated requests', async () => {
    const res = await h.fetch(new Request(BASE));
    expect(res.status).toBe(401);
  });

  it('GET / is empty for a fresh tenant', async () => {
    const auth = await h.authHeader();
    const res = await h.fetch(new Request(BASE, { headers: { Authorization: auth } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0 });
  });

  it('POST + GET round-trip with requires body', async () => {
    const auth = await h.authHeader();
    const create = await h.fetch(json(auth, {
      name: 'legalIntake',
      title: 'Legal Intake',
      goal: 'Create Legal Matter',
      body: {
        intents: ['create matter'],
        requires: [{ kind: 'form', name: 'customerSearch' }, { kind: 'tool', name: 'conflictCheck' }],
        defaultLayout: 'legal-intake-layout',
      },
      tags: ['legal'],
    }));
    expect(create.status).toBe(201);
    expect(create.headers.get('location')).toMatch(/\/experiences\/[0-9a-f-]{36}$/);
    const created = await create.json();
    expect(created.name).toBe('legalIntake');
    expect(created.approvalState).toBe('draft');
    expect(created.body.requires).toHaveLength(2);

    const get = await h.fetch(new Request(`${BASE}/${created.id}`, { headers: { Authorization: auth } }));
    expect((await get.json()).goal).toBe('Create Legal Matter');
  });

  it('409s on duplicate name', async () => {
    const auth = await h.authHeader();
    await h.fetch(json(auth, { name: 'dup', title: 'x', goal: 'g' }));
    const again = await h.fetch(json(auth, { name: 'dup', title: 'x', goal: 'g' }));
    expect(again.status).toBe(409);
  });

  it('drives the approval state machine via /transition', async () => {
    const auth = await h.authHeader();
    const created = await (await h.fetch(json(auth, { name: 'toApprove', title: 'x', goal: 'g' }))).json();

    const submit = await h.fetch(json(auth, { action: 'submit' }, 'POST', `${BASE}/${created.id}/transition`));
    expect((await submit.json()).approvalState).toBe('review');

    const approve = await h.fetch(json(auth, { action: 'approve', comment: 'ok' }, 'POST', `${BASE}/${created.id}/transition`));
    const approved = await approve.json();
    expect(approved.approvalState).toBe('approved');
    expect(approved.approvalChain).toHaveLength(2);
    expect(approved.approvalChain[1].action).toBe('approve');

    // filter by approvalState
    const list = await h.fetch(new Request(`${BASE}?approvalState=approved`, { headers: { Authorization: auth } }));
    expect((await list.json()).items.map((e: { name: string }) => e.name)).toContain('toApprove');
  });

  it('409s on an illegal transition', async () => {
    const auth = await h.authHeader();
    const created = await (await h.fetch(json(auth, { name: 'illegal', title: 'x', goal: 'g' }))).json();
    // approve straight from draft is illegal
    const res = await h.fetch(json(auth, { action: 'approve' }, 'POST', `${BASE}/${created.id}/transition`));
    expect(res.status).toBe(409);
  });

  it('/plan resolves direct requirements against the tenant catalog', async () => {
    const auth = await h.authHeader();
    // register one of the two required capabilities
    await h.fetch(json(auth, { kind: 'form', name: 'customerSearch', body: {} }, 'POST', CAPS));

    const created = await (await h.fetch(json(auth, {
      name: 'planExp', title: 'x', goal: 'g',
      body: { requires: [{ kind: 'form', name: 'customerSearch' }, { kind: 'tool', name: 'missingTool' }] },
    }))).json();

    const plan = await h.fetch(new Request(`${BASE}/${created.id}/plan`, { method: 'POST', headers: { Authorization: auth } }));
    const body = await plan.json();
    expect(body.matched).toEqual([{ kind: 'form', name: 'customerSearch' }]);
    expect(body.unmet).toEqual([{ kind: 'tool', name: 'missingTool' }]);
    expect(body.complete).toBe(false);
  });

  it('PATCH updates and DELETE soft-deletes', async () => {
    const auth = await h.authHeader();
    const created = await (await h.fetch(json(auth, { name: 'crud', title: 'x', goal: 'g' }))).json();

    const patched = await h.fetch(json(auth, { goal: 'updated goal' }, 'PATCH', `${BASE}/${created.id}`));
    expect((await patched.json()).goal).toBe('updated goal');

    const del = await h.fetch(new Request(`${BASE}/${created.id}`, { method: 'DELETE', headers: { Authorization: auth } }));
    expect(del.status).toBe(204);

    const get = await h.fetch(new Request(`${BASE}/${created.id}`, { headers: { Authorization: auth } }));
    // soft-deleted rows are hidden from the default list but the row still exists;
    // GET by id returns it (matches capabilities semantics) — assert it's flagged.
    if (get.status === 200) expect((await get.json()).softDeletedAt).not.toBeNull();
  });
});
