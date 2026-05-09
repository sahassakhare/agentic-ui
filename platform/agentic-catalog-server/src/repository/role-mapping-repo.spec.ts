import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createPgMemPool, type PgMemHandle } from '../test-helpers/pg-mem-pool.js';
import {
  createRoleMapping,
  deleteRoleMapping,
  findRoleMappingById,
  listRoleMappings,
  resolveByClaimValues,
  updateRoleMapping,
} from './role-mapping-repo.js';

const TENANT = 'test-tenant';

describe('role-mapping-repo', () => {
  let handle: PgMemHandle;

  beforeEach(() => { handle = createPgMemPool({ seedTenantId: TENANT }); });
  afterEach(async () => { await handle.destroy(); });

  async function withClient<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await handle.pool.connect();
    try { return await fn(client); } finally { client.release(); }
  }

  it('creates + finds a mapping', async () => {
    const created = await withClient((c) => createRoleMapping(c, TENANT, {
      claimPath: 'groups',
      claimValue: 'engineering@acme.com',
      runtimePersona: 'paralegal',
      priority: 100,
      enabled: true,
    }, 'admin@iss'));
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.runtimePersona).toBe('paralegal');

    const got = await withClient((c) => findRoleMappingById(c, created.id));
    expect(got?.runtimePersona).toBe('paralegal');
  });

  it('rejects duplicate (tenant_id, claim_path, claim_value)', async () => {
    await withClient((c) => createRoleMapping(c, TENANT, {
      claimPath: 'groups', claimValue: 'eng', runtimePersona: 'p', priority: 100, enabled: true,
    }, 'a@iss'));
    await expect(
      withClient((c) => createRoleMapping(c, TENANT, {
        claimPath: 'groups', claimValue: 'eng', runtimePersona: 'q', priority: 100, enabled: true,
      }, 'a@iss')),
    ).rejects.toThrow();
  });

  it('list returns ordered by priority DESC, created_at ASC', async () => {
    await withClient(async (c) => {
      await createRoleMapping(c, TENANT, { claimPath: 'g', claimValue: 'a', runtimePersona: 'p', priority: 50, enabled: true }, 'a@iss');
      await createRoleMapping(c, TENANT, { claimPath: 'g', claimValue: 'b', runtimePersona: 'p', priority: 100, enabled: true }, 'a@iss');
      await createRoleMapping(c, TENANT, { claimPath: 'g', claimValue: 'c', runtimePersona: 'p', priority: 75, enabled: true }, 'a@iss');
    });
    const items = await withClient(listRoleMappings);
    expect(items.map((m) => m.claimValue)).toEqual(['b', 'c', 'a']);
  });

  it('update changes runtimePersona / priority / enabled / description', async () => {
    const created = await withClient((c) => createRoleMapping(c, TENANT, {
      claimPath: 'g', claimValue: 'eng', runtimePersona: 'p', priority: 100, enabled: true,
    }, 'a@iss'));
    const updated = await withClient((c) => updateRoleMapping(c, created.id, {
      runtimePersona: 'q',
      priority: 200,
      enabled: false,
      description: 'paused for audit',
    }));
    expect(updated?.runtimePersona).toBe('q');
    expect(updated?.priority).toBe(200);
    expect(updated?.enabled).toBe(false);
    expect(updated?.description).toBe('paused for audit');
  });

  it('empty patch returns existing row', async () => {
    const created = await withClient((c) => createRoleMapping(c, TENANT, {
      claimPath: 'g', claimValue: 'eng', runtimePersona: 'p', priority: 100, enabled: true,
    }, 'a@iss'));
    const updated = await withClient((c) => updateRoleMapping(c, created.id, {}));
    expect(updated?.id).toBe(created.id);
  });

  it('update on missing id returns null', async () => {
    const updated = await withClient((c) => updateRoleMapping(c, '00000000-0000-0000-0000-000000000000', {
      enabled: false,
    }));
    expect(updated).toBeNull();
  });

  it('delete returns true on hit, false on miss', async () => {
    const created = await withClient((c) => createRoleMapping(c, TENANT, {
      claimPath: 'g', claimValue: 'eng', runtimePersona: 'p', priority: 100, enabled: true,
    }, 'a@iss'));
    expect(await withClient((c) => deleteRoleMapping(c, created.id))).toBe(true);
    expect(await withClient((c) => deleteRoleMapping(c, created.id))).toBe(false);
  });

  // ── resolveByClaimValues ──────────────────────────────────────
  describe('resolveByClaimValues', () => {
    it('returns null when claimValues is empty', async () => {
      const result = await withClient((c) => resolveByClaimValues(c, {
        claimPath: 'groups', claimValues: [],
      }));
      expect(result.runtimePersona).toBeNull();
    });

    it('returns null when no mapping matches', async () => {
      await withClient((c) => createRoleMapping(c, TENANT, {
        claimPath: 'groups', claimValue: 'eng', runtimePersona: 'paralegal', priority: 100, enabled: true,
      }, 'a@iss'));
      const result = await withClient((c) => resolveByClaimValues(c, {
        claimPath: 'groups', claimValues: ['legal'],
      }));
      expect(result.runtimePersona).toBeNull();
    });

    it('matches a single mapping', async () => {
      await withClient((c) => createRoleMapping(c, TENANT, {
        claimPath: 'groups', claimValue: 'legal-counsel', runtimePersona: 'lead-counsel', priority: 100, enabled: true,
      }, 'a@iss'));
      const result = await withClient((c) => resolveByClaimValues(c, {
        claimPath: 'groups', claimValues: ['legal-counsel'],
      }));
      expect(result.runtimePersona).toBe('lead-counsel');
      expect(result.matchedClaimValues).toEqual(['legal-counsel']);
      expect(result.priority).toBe(100);
    });

    it('priority breaks ties between multiple matches', async () => {
      await withClient(async (c) => {
        await createRoleMapping(c, TENANT, { claimPath: 'g', claimValue: 'team-a', runtimePersona: 'paralegal', priority: 50, enabled: true }, 'a@iss');
        await createRoleMapping(c, TENANT, { claimPath: 'g', claimValue: 'team-b', runtimePersona: 'lead-counsel', priority: 100, enabled: true }, 'a@iss');
      });
      const result = await withClient((c) => resolveByClaimValues(c, {
        claimPath: 'g', claimValues: ['team-a', 'team-b'],
      }));
      expect(result.runtimePersona).toBe('lead-counsel');
      expect(result.priority).toBe(100);
    });

    it('disabled mappings are not returned', async () => {
      await withClient((c) => createRoleMapping(c, TENANT, {
        claimPath: 'g', claimValue: 'eng', runtimePersona: 'paralegal', priority: 100, enabled: false,
      }, 'a@iss'));
      const result = await withClient((c) => resolveByClaimValues(c, {
        claimPath: 'g', claimValues: ['eng'],
      }));
      expect(result.runtimePersona).toBeNull();
    });

    it('claim_path scoping isolates groups vs. roles vs. custom paths', async () => {
      await withClient(async (c) => {
        await createRoleMapping(c, TENANT, { claimPath: 'groups', claimValue: 'eng',  runtimePersona: 'paralegal',     priority: 100, enabled: true }, 'a@iss');
        await createRoleMapping(c, TENANT, { claimPath: 'roles',  claimValue: 'eng',  runtimePersona: 'lead-counsel', priority: 100, enabled: true }, 'a@iss');
      });
      const groups = await withClient((c) => resolveByClaimValues(c, {
        claimPath: 'groups', claimValues: ['eng'],
      }));
      expect(groups.runtimePersona).toBe('paralegal');

      const roles = await withClient((c) => resolveByClaimValues(c, {
        claimPath: 'roles', claimValues: ['eng'],
      }));
      expect(roles.runtimePersona).toBe('lead-counsel');
    });

    it('returns matchedClaimValues for ties at the winning priority + persona', async () => {
      await withClient(async (c) => {
        await createRoleMapping(c, TENANT, { claimPath: 'g', claimValue: 'team-a', runtimePersona: 'paralegal', priority: 100, enabled: true }, 'a@iss');
        await createRoleMapping(c, TENANT, { claimPath: 'g', claimValue: 'team-b', runtimePersona: 'paralegal', priority: 100, enabled: true }, 'a@iss');
      });
      const result = await withClient((c) => resolveByClaimValues(c, {
        claimPath: 'g', claimValues: ['team-a', 'team-b'],
      }));
      expect(result.runtimePersona).toBe('paralegal');
      expect(result.matchedClaimValues.sort()).toEqual(['team-a', 'team-b']);
    });
  });
});
