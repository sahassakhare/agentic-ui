import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createPgMemPool, type PgMemHandle } from '../test-helpers/pg-mem-pool.js';
import {
  createCapability,
  findCapabilityById,
  findCapabilityByName,
  listCapabilities,
  softDeleteCapability,
  restoreCapability,
  updateCapability,
} from './capability-repo.js';
import { CapabilityListQuerySchema } from '../domain/capability.js';

const TENANT = 'test-tenant';

describe('capability-repo', () => {
  let handle: PgMemHandle;

  beforeEach(() => {
    handle = createPgMemPool({ seedTenantId: TENANT });
  });

  afterEach(async () => {
    await handle.destroy();
  });

  async function withClient<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await handle.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  it('creates + reads back a capability', async () => {
    const created = await withClient((c) => createCapability(c, TENANT, {
      kind: 'tool',
      name: 'bookFlight',
      body: { description: 'book a flight' },
      lifecycle: 'published',
      tags: ['bookings'],
    }, 'sub@iss'));
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.kind).toBe('tool');
    expect(created.name).toBe('bookFlight');

    const found = await withClient((c) => findCapabilityById(c, created.id));
    expect(found?.body).toEqual({ description: 'book a flight' });
    expect(found?.tags).toEqual(['bookings']);
    expect(found?.lifecycle).toBe('published');
  });

  it('findCapabilityByName finds the entry by (kind, name) tuple', async () => {
    await withClient((c) => createCapability(c, TENANT, {
      kind: 'tool',
      name: 'bookFlight',
      body: {},
      lifecycle: 'published',
      tags: [],
    }, 'sub@iss'));
    const got = await withClient((c) => findCapabilityByName(c, 'tool', 'bookFlight'));
    expect(got?.name).toBe('bookFlight');
  });

  it('rejects duplicate (tenant_id, kind, name)', async () => {
    await withClient((c) => createCapability(c, TENANT, {
      kind: 'tool', name: 'dup', body: {}, lifecycle: 'published', tags: [],
    }, 'sub@iss'));
    await expect(
      withClient((c) => createCapability(c, TENANT, {
        kind: 'tool', name: 'dup', body: {}, lifecycle: 'published', tags: [],
      }, 'sub@iss')),
    ).rejects.toThrow();
  });

  it('updates lifecycle + body', async () => {
    const created = await withClient((c) => createCapability(c, TENANT, {
      kind: 'tool', name: 'evolving', body: { v: 1 }, lifecycle: 'draft', tags: [],
    }, 'sub@iss'));
    const updated = await withClient((c) => updateCapability(c, created.id, {
      lifecycle: 'published',
      body: { v: 2 },
    }));
    expect(updated?.lifecycle).toBe('published');
    expect(updated?.body).toEqual({ v: 2 });
  });

  it('empty patch returns the existing row unchanged', async () => {
    const created = await withClient((c) => createCapability(c, TENANT, {
      kind: 'tool', name: 'noop', body: {}, lifecycle: 'published', tags: [],
    }, 'sub@iss'));
    const updated = await withClient((c) => updateCapability(c, created.id, {}));
    expect(updated?.id).toBe(created.id);
  });

  it('list filters by kind / lifecycle / tag / q', async () => {
    await withClient(async (c) => {
      await createCapability(c, TENANT, { kind: 'tool', name: 'alpha', body: {}, lifecycle: 'published', tags: ['x'] }, 'sub@iss');
      await createCapability(c, TENANT, { kind: 'tool', name: 'beta',  body: {}, lifecycle: 'draft',     tags: ['y'] }, 'sub@iss');
      await createCapability(c, TENANT, { kind: 'component', name: 'gamma', body: {}, lifecycle: 'published', tags: ['x'] }, 'sub@iss');
    });

    const byKind = await withClient((c) => listCapabilities(c, CapabilityListQuerySchema.parse({ kind: 'tool' })));
    expect(byKind.items.map((i) => i.name).sort()).toEqual(['alpha', 'beta']);

    const byLifecycle = await withClient((c) => listCapabilities(c, CapabilityListQuerySchema.parse({ lifecycle: 'draft' })));
    expect(byLifecycle.items.map((i) => i.name)).toEqual(['beta']);

    const byTag = await withClient((c) => listCapabilities(c, CapabilityListQuerySchema.parse({ tag: 'x' })));
    expect(byTag.items.map((i) => i.name).sort()).toEqual(['alpha', 'gamma']);

    const byQ = await withClient((c) => listCapabilities(c, CapabilityListQuerySchema.parse({ q: 'amma' })));
    expect(byQ.items.map((i) => i.name)).toEqual(['gamma']);
  });

  it('list paginates', async () => {
    await withClient(async (c) => {
      for (let i = 0; i < 5; i++) {
        await createCapability(c, TENANT, {
          kind: 'tool', name: `t-${i}`, body: {}, lifecycle: 'published', tags: [],
        }, 'sub@iss');
      }
    });
    const page1 = await withClient((c) => listCapabilities(c, CapabilityListQuerySchema.parse({ limit: 2, offset: 0 })));
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    const page2 = await withClient((c) => listCapabilities(c, CapabilityListQuerySchema.parse({ limit: 2, offset: 2 })));
    expect(page2.items).toHaveLength(2);
    const page3 = await withClient((c) => listCapabilities(c, CapabilityListQuerySchema.parse({ limit: 2, offset: 4 })));
    expect(page3.items).toHaveLength(1);
  });

  it('soft-delete sets soft_deleted_at + lifecycle=disabled', async () => {
    const created = await withClient((c) => createCapability(c, TENANT, {
      kind: 'tool', name: 'dying', body: {}, lifecycle: 'published', tags: [],
    }, 'sub@iss'));
    const deleted = await withClient((c) => softDeleteCapability(c, created.id));
    expect(deleted?.softDeletedAt).not.toBeNull();
    expect(deleted?.lifecycle).toBe('disabled');
  });

  it('list omits soft-deleted by default; includeDeleted=true returns them', async () => {
    const created = await withClient((c) => createCapability(c, TENANT, {
      kind: 'tool', name: 'gone', body: {}, lifecycle: 'published', tags: [],
    }, 'sub@iss'));
    await withClient((c) => softDeleteCapability(c, created.id));

    const def = await withClient((c) => listCapabilities(c, CapabilityListQuerySchema.parse({})));
    expect(def.items.find((i) => i.name === 'gone')).toBeUndefined();

    const incl = await withClient((c) => listCapabilities(c, CapabilityListQuerySchema.parse({ includeDeleted: 'true' })));
    expect(incl.items.find((i) => i.name === 'gone')).toBeDefined();
  });

  it('restore reverses a soft-delete', async () => {
    const created = await withClient((c) => createCapability(c, TENANT, {
      kind: 'tool', name: 'phoenix', body: {}, lifecycle: 'published', tags: [],
    }, 'sub@iss'));
    await withClient((c) => softDeleteCapability(c, created.id));
    const restored = await withClient((c) => restoreCapability(c, created.id));
    expect(restored?.softDeletedAt).toBeNull();
  });

  it('soft-delete returns null when already deleted', async () => {
    const created = await withClient((c) => createCapability(c, TENANT, {
      kind: 'tool', name: 'twice', body: {}, lifecycle: 'published', tags: [],
    }, 'sub@iss'));
    await withClient((c) => softDeleteCapability(c, created.id));
    const second = await withClient((c) => softDeleteCapability(c, created.id));
    expect(second).toBeNull();
  });

  it('update on nonexistent id returns null', async () => {
    const updated = await withClient((c) => updateCapability(c, '00000000-0000-0000-0000-000000000000', {
      lifecycle: 'deprecated',
    }));
    expect(updated).toBeNull();
  });
});
