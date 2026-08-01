import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

const TENANT = 'test-tenant';
const EXP = `http://localhost/v1/catalogs/${TENANT}/experiences`;
const CAPS = `http://localhost/v1/catalogs/${TENANT}/capabilities`;
const embedUrl = (tenant: string, name: string) => `http://localhost/v1/embed/${tenant}/experiences/${name}/manifest`;

describe('experience publishing + headless embed read', () => {
  let h: IntegrationHarness;
  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  const post = (auth: string, url: string, body: unknown) =>
    h.fetch(new Request(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

  /** Create → submit → approve an experience (with a branching workflow capability). */
  async function seedApproved(auth: string, name: string): Promise<string> {
    await post(auth, CAPS, {
      kind: 'workflow', name: `${name}-flow`,
      body: { workflow: { steps: [
        { id: 'category', widget: 'category-picker', next: 'priority' },
        { id: 'priority', widget: 'priority-picker', next: { branches: [{ when: { field: 'priority', op: '==', value: 'high' }, goto: 'escalate' }], default: 'review' } },
        { id: 'escalate', widget: 'access-picker', next: 'review' },
        { id: 'review', widget: 'review-summary', next: '' },
      ] } },
    });
    const created = await (await post(auth, EXP, {
      name, title: 'Support', goal: 'open a ticket',
      body: { requires: [{ kind: 'workflow', name: `${name}-flow` }] },
    })).json();
    await post(auth, `${EXP}/${created.id}/transition`, { action: 'submit' });
    await post(auth, `${EXP}/${created.id}/transition`, { action: 'approve' });
    return created.id;
  }

  it('refuses to publish an experience that is not approved (409)', async () => {
    const auth = await h.authHeader();
    const created = await (await post(auth, EXP, { name: 'draft-exp', title: 'x', goal: 'g' })).json();
    const res = await post(auth, `${EXP}/${created.id}/publish`, { allowedOrigins: [] });
    expect(res.status).toBe(409);
  });

  it('publishes an approved experience and serves the manifest via embed key', async () => {
    const auth = await h.authHeader();
    const id = await seedApproved(auth, 'support-ticket');

    const pub = await post(auth, `${EXP}/${id}/publish`, { allowedOrigins: ['https://portal.acme.com'] });
    expect(pub.status).toBe(201);
    const { publication, embedKey } = await pub.json();
    expect(embedKey).toMatch(/^emb_/);
    expect(publication.status).toBe('active');
    expect(publication.keyPrefix).toMatch(/^emb_/);

    // Anonymous embed read (no Origin → server-side caller) with the key → 200 + manifest.
    const read = await h.fetch(new Request(embedUrl(TENANT, 'support-ticket'), { headers: { 'x-embed-key': embedKey } }));
    expect(read.status).toBe(200);
    const manifest = await read.json();
    expect(manifest.experience.name).toBe('support-ticket');
    expect(manifest.workflow.steps).toHaveLength(4);
    expect(manifest.widgets.map((w: { name: string }) => w.name)).toContain('priority-picker');
    // The branching step survived serialization.
    const priority = manifest.workflow.steps.find((s: { id: string }) => s.id === 'priority');
    expect(priority.next.branches[0].goto).toBe('escalate');
  });

  it('denies the deny-matrix: bad key, wrong tenant, bad origin, draft, revoked', async () => {
    const auth = await h.authHeader();
    const id = await seedApproved(auth, 'matrix-exp');
    const { embedKey } = await (await post(auth, `${EXP}/${id}/publish`, { allowedOrigins: ['https://portal.acme.com'] })).json();

    // bogus key → 404 (no oracle)
    expect((await h.fetch(new Request(embedUrl(TENANT, 'matrix-exp'), { headers: { 'x-embed-key': 'emb_bogus' } }))).status).toBe(404);
    // no key at all → 401
    expect((await h.fetch(new Request(embedUrl(TENANT, 'matrix-exp')))).status).toBe(401);
    // valid key, wrong tenant path → 404 (explicit tenant filter)
    expect((await h.fetch(new Request(embedUrl('globex', 'matrix-exp'), { headers: { 'x-embed-key': embedKey } }))).status).toBe(404);
    // valid key, but key was minted for a different experience name → 404
    expect((await h.fetch(new Request(embedUrl(TENANT, 'support-ticket'), { headers: { 'x-embed-key': embedKey } }))).status).toBe(404);
    // valid key, disallowed origin → 403
    expect((await h.fetch(new Request(embedUrl(TENANT, 'matrix-exp'), { headers: { 'x-embed-key': embedKey, Origin: 'https://evil.example' } }))).status).toBe(403);
    // allowed origin → 200
    expect((await h.fetch(new Request(embedUrl(TENANT, 'matrix-exp'), { headers: { 'x-embed-key': embedKey, Origin: 'https://portal.acme.com' } }))).status).toBe(200);

    // unpublish → previously valid key stops resolving (404)
    expect((await post(auth, `${EXP}/${id}/unpublish`, {})).status).toBe(200);
    expect((await h.fetch(new Request(embedUrl(TENANT, 'matrix-exp'), { headers: { 'x-embed-key': embedKey } }))).status).toBe(404);
  });

  it('rotate-key invalidates the old key and issues a new one', async () => {
    const auth = await h.authHeader();
    const id = await seedApproved(auth, 'rotate-exp');
    const { embedKey: oldKey } = await (await post(auth, `${EXP}/${id}/publish`, { allowedOrigins: [] })).json();
    const rot = await post(auth, `${EXP}/${id}/publish/rotate-key`, {});
    expect(rot.status).toBe(200);
    const { embedKey: newKey } = await rot.json();
    expect(newKey).not.toBe(oldKey);
    expect((await h.fetch(new Request(embedUrl(TENANT, 'rotate-exp'), { headers: { 'x-embed-key': oldKey } }))).status).toBe(404);
    expect((await h.fetch(new Request(embedUrl(TENANT, 'rotate-exp'), { headers: { 'x-embed-key': newKey } }))).status).toBe(200);
  });

  it('a member (non-writer) cannot publish (RBAC 403)', async () => {
    const auth = await h.authHeader();
    const id = await seedApproved(auth, 'rbac-exp');
    const memberAuth = await h.authHeader({ roles: ['member'] });
    const res = await post(memberAuth, `${EXP}/${id}/publish`, { allowedOrigins: [] });
    expect(res.status).toBe(403);
  });
});
