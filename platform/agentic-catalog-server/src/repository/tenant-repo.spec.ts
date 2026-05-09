import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createPgMemPool, type PgMemHandle } from '../test-helpers/pg-mem-pool.js';
import {
  activateTenant,
  createTenant,
  findTenantById,
  listTenants,
  softDeleteTenant,
  suspendTenant,
  updateTenant,
} from './tenant-repo.js';

const SEED_TENANT = 'test-tenant';

async function withClient<T>(handle: PgMemHandle, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await handle.pool.connect();
  try { return await fn(client); } finally { client.release(); }
}

describe('tenant-repo (M4 C7)', () => {
  let handle: PgMemHandle;

  beforeEach(() => { handle = createPgMemPool({ seedTenantId: SEED_TENANT }); });
  afterEach(async () => { await handle.destroy(); });

  it('createTenant inserts a row with onboarded metadata', async () => {
    const t = await withClient(handle, (c) => createTenant(c, {
      id: 'acme', displayName: 'Acme Corp', quotas: { monthlyTokens: 1_000_000 },
    }, 'admin@iss'));
    expect(t.id).toBe('acme');
    expect(t.status).toBe('active');
    expect(t.onboardedBy).toBe('admin@iss');
    expect(t.onboardedAt).not.toBeNull();
    expect(t.quotas).toEqual({ monthlyTokens: 1_000_000 });
  });

  it('listTenants excludes soft-deleted by default', async () => {
    await withClient(handle, async (c) => {
      await createTenant(c, { id: 'a', displayName: 'A', quotas: {} }, 'admin@iss');
      await createTenant(c, { id: 'b', displayName: 'B', quotas: {} }, 'admin@iss');
      await softDeleteTenant(c, 'a');
    });
    const visible = await withClient(handle, (c) => listTenants(c));
    expect(visible.map((t) => t.id).sort()).toEqual(['b', SEED_TENANT].sort());

    const all = await withClient(handle, (c) => listTenants(c, { includeDeleted: true }));
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('updateTenant patches displayName + quotas', async () => {
    await withClient(handle, (c) => createTenant(c, { id: 'acme', displayName: 'A', quotas: {} }, 'admin@iss'));
    const after = await withClient(handle, (c) => updateTenant(c, 'acme', {
      displayName: 'Acme Corporation',
      quotas: { monthlyTokens: 5_000_000 },
    }));
    expect(after?.displayName).toBe('Acme Corporation');
    expect(after?.quotas).toEqual({ monthlyTokens: 5_000_000 });
  });

  it('updateTenant on missing id returns null', async () => {
    const after = await withClient(handle, (c) => updateTenant(c, 'nope', { displayName: 'X' }));
    expect(after).toBeNull();
  });

  it('updateTenant returns existing row when patch is empty', async () => {
    await withClient(handle, (c) => createTenant(c, { id: 'acme', displayName: 'A', quotas: {} }, 'admin@iss'));
    const after = await withClient(handle, (c) => updateTenant(c, 'acme', {}));
    expect(after?.id).toBe('acme');
  });

  it('suspendTenant sets status + reason; activateTenant clears them', async () => {
    await withClient(handle, (c) => createTenant(c, { id: 'acme', displayName: 'A', quotas: {} }, 'admin@iss'));
    const sus = await withClient(handle, (c) => suspendTenant(c, 'acme', 'admin@iss', 'overdue invoice'));
    expect(sus?.status).toBe('suspended');
    expect(sus?.suspendedReason).toBe('overdue invoice');
    expect(sus?.suspendedBy).toBe('admin@iss');
    expect(sus?.suspendedAt).not.toBeNull();

    const back = await withClient(handle, (c) => activateTenant(c, 'acme'));
    expect(back?.status).toBe('active');
    expect(back?.suspendedReason).toBeNull();
    expect(back?.suspendedAt).toBeNull();
  });

  it('suspendTenant is idempotent — repeat updates reason but keeps original timestamp', async () => {
    await withClient(handle, (c) => createTenant(c, { id: 'acme', displayName: 'A', quotas: {} }, 'admin@iss'));
    const first = await withClient(handle, (c) => suspendTenant(c, 'acme', 'admin@iss', 'reason A'));
    const second = await withClient(handle, (c) => suspendTenant(c, 'acme', 'admin@iss', 'reason B'));
    expect(second?.suspendedReason).toBe('reason B');
    expect(second?.suspendedAt).toBe(first?.suspendedAt);
  });

  it('softDeleteTenant marks status + deleted_at; subsequent reads still find it', async () => {
    await withClient(handle, (c) => createTenant(c, { id: 'doomed', displayName: 'D', quotas: {} }, 'admin@iss'));
    const deleted = await withClient(handle, (c) => softDeleteTenant(c, 'doomed'));
    expect(deleted?.status).toBe('deleted');
    expect(deleted?.deletedAt).not.toBeNull();
    const direct = await withClient(handle, (c) => findTenantById(c, 'doomed'));
    expect(direct?.status).toBe('deleted');
  });

  it('updateTenant refuses to patch a soft-deleted tenant', async () => {
    await withClient(handle, (c) => createTenant(c, { id: 'doomed', displayName: 'D', quotas: {} }, 'admin@iss'));
    await withClient(handle, (c) => softDeleteTenant(c, 'doomed'));
    const after = await withClient(handle, (c) => updateTenant(c, 'doomed', { displayName: 'rename' }));
    expect(after).toBeNull();
  });

  it('createTenant rejects duplicate id', async () => {
    await withClient(handle, (c) => createTenant(c, { id: 'acme', displayName: 'A', quotas: {} }, 'admin@iss'));
    await expect(
      withClient(handle, (c) => createTenant(c, { id: 'acme', displayName: 'B', quotas: {} }, 'admin@iss')),
    ).rejects.toThrow();
  });
});
