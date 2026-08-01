import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createPgMemPool, type PgMemHandle } from '../test-helpers/pg-mem-pool.js';
import { withTenantScope } from '../db/pool.js';
import type { Principal } from '../domain/principal.js';
import type { Experience } from '../domain/experience.js';
import {
  findActivePublicationByExperienceId,
  findActivePublicationByKeyHash,
  findActivePublicationByName,
  getLatestExperienceVersionNo,
  insertPublication,
  resolveCapabilityBodiesForExperience,
  revokeActivePublication,
  rotatePublicationKey,
} from './publication-repo.js';

const TENANT = 'acme';
const principal = { tenantId: TENANT } as Principal;
const bundle = { experience: { name: 'support-ticket', title: 'T', goal: 'g' }, workflow: null, widgets: [], publishedVersionNo: 1, publishedAt: 'x' };

async function seedExperience(pool: PgMemHandle['pool'], name: string): Promise<Experience> {
  return withTenantScope(pool, principal, async (c) => {
    const r = await c.query(
      `INSERT INTO experiences (tenant_id, name, title, goal, body, approval_state, tags, created_by)
       VALUES ($1,$2,'T','g','{"requires":[{"kind":"workflow","name":"support-flow"}]}'::jsonb,'approved','{}','root')
       RETURNING id`,
      [TENANT, name],
    );
    const id = r.rows[0].id as string;
    await c.query(
      `INSERT INTO experience_versions (tenant_id, experience_id, version_no, snapshot, reason, created_by)
       VALUES ($1,$2,1,'{}'::jsonb,'create','root'), ($1,$2,2,'{}'::jsonb,'update','root')`,
      [TENANT, id],
    );
    return { id } as Experience;
  });
}

describe('publication-repo (pg-mem)', () => {
  let h: PgMemHandle;
  beforeAll(() => { h = createPgMemPool({ seedTenantId: TENANT }); });
  afterAll(async () => { await h.destroy(); });

  it('getLatestExperienceVersionNo returns the max version', async () => {
    const exp = await seedExperience(h.pool, 'exp-ver');
    const v = await withTenantScope(h.pool, principal, (c) => getLatestExperienceVersionNo(c, exp.id));
    expect(v).toBe(2);
  });

  it('insert then look up by key hash and name', async () => {
    const exp = await seedExperience(h.pool, 'exp-lookup');
    const rec = await withTenantScope(h.pool, principal, (c) =>
      insertPublication(c, TENANT, {
        experienceId: exp.id, experienceName: 'exp-lookup', publishedVersionNo: 2,
        keyHash: 'hash-A', keyPrefix: 'emb_aa', allowedOrigins: ['https://p.com'], bundle, publishedBy: 'root',
      }));
    expect(rec.status).toBe('active');

    const byKey = await withTenantScope(h.pool, principal, (c) => findActivePublicationByKeyHash(c, 'hash-A', TENANT));
    expect(byKey?.experienceName).toBe('exp-lookup');
    // Wrong tenant → no row even without RLS (explicit tenant filter, defense-in-depth).
    const wrongTenant = await withTenantScope(h.pool, { tenantId: 'globex' } as Principal, (c) => findActivePublicationByKeyHash(c, 'hash-A', 'globex'));
    expect(wrongTenant).toBeNull();

    const byName = await withTenantScope(h.pool, principal, (c) => findActivePublicationByName(c, 'exp-lookup'));
    expect(byName?.keyPrefix).toBe('emb_aa');
  });

  it('re-publish revokes the prior active row (one active per experience)', async () => {
    const exp = await seedExperience(h.pool, 'exp-republish');
    await withTenantScope(h.pool, principal, (c) => insertPublication(c, TENANT, {
      experienceId: exp.id, experienceName: 'exp-republish', publishedVersionNo: 1,
      keyHash: 'hash-old', keyPrefix: 'emb_old', allowedOrigins: [], bundle, publishedBy: 'root',
    }));
    await withTenantScope(h.pool, principal, (c) => insertPublication(c, TENANT, {
      experienceId: exp.id, experienceName: 'exp-republish', publishedVersionNo: 2,
      keyHash: 'hash-new', keyPrefix: 'emb_new', allowedOrigins: [], bundle, publishedBy: 'root',
    }));
    // Old key no longer resolves; new key does.
    expect(await withTenantScope(h.pool, principal, (c) => findActivePublicationByKeyHash(c, 'hash-old', TENANT))).toBeNull();
    expect(await withTenantScope(h.pool, principal, (c) => findActivePublicationByKeyHash(c, 'hash-new', TENANT))).not.toBeNull();
  });

  it('rotate swaps the key; unpublish revokes', async () => {
    const exp = await seedExperience(h.pool, 'exp-rotate');
    await withTenantScope(h.pool, principal, (c) => insertPublication(c, TENANT, {
      experienceId: exp.id, experienceName: 'exp-rotate', publishedVersionNo: 1,
      keyHash: 'k1', keyPrefix: 'emb_k1', allowedOrigins: [], bundle, publishedBy: 'root',
    }));
    await withTenantScope(h.pool, principal, (c) => rotatePublicationKey(c, exp.id, 'k2', 'emb_k2'));
    expect(await withTenantScope(h.pool, principal, (c) => findActivePublicationByKeyHash(c, 'k1', TENANT))).toBeNull();
    expect(await withTenantScope(h.pool, principal, (c) => findActivePublicationByKeyHash(c, 'k2', TENANT))).not.toBeNull();

    await withTenantScope(h.pool, principal, (c) => revokeActivePublication(c, exp.id));
    expect(await withTenantScope(h.pool, principal, (c) => findActivePublicationByExperienceId(c, exp.id))).toBeNull();
  });

  it('resolveCapabilityBodiesForExperience pulls workflow steps + widget names', async () => {
    const exp = await withTenantScope(h.pool, principal, async (c) => {
      const r = await c.query(
        `INSERT INTO experiences (tenant_id, name, title, goal, body, approval_state, tags, created_by)
         VALUES ($1,'exp-wf','T','g','{"requires":[{"kind":"workflow","name":"wf-x"}]}'::jsonb,'approved','{}','root')
         RETURNING id, tenant_id, name, title, goal, body, approval_state, approval_chain, owner, tags, version, created_at, updated_at, created_by, soft_deleted_at`,
        [TENANT],
      );
      // Seed the workflow capability + a component capability with a propsSchema.
      await c.query(
        `INSERT INTO capabilities (tenant_id, kind, name, body, lifecycle, created_by) VALUES
         ($1,'workflow','wf-x','{"workflow":{"steps":[{"id":"a","widget":"picker","next":""},{"id":"b","widget":"summary","next":null}]}}'::jsonb,'published','root'),
         ($1,'component','picker','{"propsSchema":{"type":"object"}}'::jsonb,'published','root')`,
        [TENANT],
      );
      return r.rows[0];
    });

    const sources = await withTenantScope(h.pool, principal, (c) =>
      resolveCapabilityBodiesForExperience(c, {
        ...exp, tenantId: exp.tenant_id, approvalState: exp.approval_state, body: exp.body,
        approvalChain: [], createdAt: '', updatedAt: '', softDeletedAt: null,
      } as unknown as Experience));

    expect(sources.workflow?.steps.map((s) => s.id)).toEqual(['a', 'b']);
    // Terminal '' normalized to null.
    expect(sources.workflow?.steps[0]?.next).toBeNull();
    expect(sources.widgets.find((w) => w.name === 'picker')?.propsSchema).toEqual({ type: 'object' });
    expect(sources.widgets.find((w) => w.name === 'summary')?.kind).toBe('component'); // default when no capability
  });
});
