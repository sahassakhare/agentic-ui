import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createPgMemPool, type PgMemHandle } from '../test-helpers/pg-mem-pool.js';
import {
  createMfeRemote,
  deleteMfeRemote,
  findMfeByName,
  listMfeRemotes,
  recordHealth,
  updateMfeRemote,
} from './mfe-repo.js';

const TENANT = 'test-tenant';

describe('mfe-repo', () => {
  let handle: PgMemHandle;

  beforeEach(() => { handle = createPgMemPool({ seedTenantId: TENANT }); });
  afterEach(async () => { await handle.destroy(); });

  async function withClient<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await handle.pool.connect();
    try { return await fn(client); } finally { client.release(); }
  }

  it('creates + finds an MFE remote', async () => {
    const created = await withClient((c) => createMfeRemote(c, TENANT, {
      name: 'bookings',
      manifestUrl: 'https://bookings.example.com/remoteEntry.json',
      version: '1.2.3',
      requiredHostVersion: '^1.0.0',
      exposes: { tools: ['bookFlight'] },
      status: 'active',
    }));
    expect(created.name).toBe('bookings');
    expect(created.version).toBe('1.2.3');
    expect(created.exposes).toEqual({ tools: ['bookFlight'] });

    const got = await withClient((c) => findMfeByName(c, 'bookings'));
    expect(got?.name).toBe('bookings');
  });

  it('list returns entries ordered by name', async () => {
    await withClient(async (c) => {
      await createMfeRemote(c, TENANT, { name: 'zeta',  manifestUrl: 'https://z.example.com/r.json', exposes: {}, status: 'active' });
      await createMfeRemote(c, TENANT, { name: 'alpha', manifestUrl: 'https://a.example.com/r.json', exposes: {}, status: 'active' });
      await createMfeRemote(c, TENANT, { name: 'mu',    manifestUrl: 'https://m.example.com/r.json', exposes: {}, status: 'active' });
    });
    const items = await withClient(listMfeRemotes);
    expect(items.map((m) => m.name)).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('rejects duplicate (tenant_id, name)', async () => {
    await withClient((c) => createMfeRemote(c, TENANT, {
      name: 'dup', manifestUrl: 'https://d.example.com/r.json', exposes: {}, status: 'active',
    }));
    await expect(
      withClient((c) => createMfeRemote(c, TENANT, {
        name: 'dup', manifestUrl: 'https://d.example.com/r.json', exposes: {}, status: 'active',
      })),
    ).rejects.toThrow();
  });

  it('updates partial fields', async () => {
    await withClient((c) => createMfeRemote(c, TENANT, {
      name: 'bookings', manifestUrl: 'https://old.example.com/r.json', exposes: {}, status: 'active',
    }));
    const updated = await withClient((c) => updateMfeRemote(c, 'bookings', {
      manifestUrl: 'https://new.example.com/r.json',
      version: '2.0.0',
    }));
    expect(updated?.manifestUrl).toBe('https://new.example.com/r.json');
    expect(updated?.version).toBe('2.0.0');
    expect(updated?.status).toBe('active');  // unchanged
  });

  it('empty patch returns the existing row', async () => {
    await withClient((c) => createMfeRemote(c, TENANT, {
      name: 'noop', manifestUrl: 'https://n.example.com/r.json', exposes: {}, status: 'active',
    }));
    const updated = await withClient((c) => updateMfeRemote(c, 'noop', {}));
    expect(updated?.name).toBe('noop');
  });

  it('update on missing name returns null', async () => {
    const updated = await withClient((c) => updateMfeRemote(c, 'ghost', { status: 'inactive' }));
    expect(updated).toBeNull();
  });

  it('hard-deletes', async () => {
    await withClient((c) => createMfeRemote(c, TENANT, {
      name: 'gone', manifestUrl: 'https://g.example.com/r.json', exposes: {}, status: 'active',
    }));
    const ok = await withClient((c) => deleteMfeRemote(c, 'gone'));
    expect(ok).toBe(true);
    const got = await withClient((c) => findMfeByName(c, 'gone'));
    expect(got).toBeNull();
  });

  it('delete returns false when nothing matches', async () => {
    const ok = await withClient((c) => deleteMfeRemote(c, 'never-was'));
    expect(ok).toBe(false);
  });

  it('recordHealth updates status + last_health_at', async () => {
    await withClient((c) => createMfeRemote(c, TENANT, {
      name: 'observed', manifestUrl: 'https://o.example.com/r.json', exposes: {}, status: 'active',
    }));
    await withClient((c) => recordHealth(c, 'observed', 'degraded'));
    const got = await withClient((c) => findMfeByName(c, 'observed'));
    expect(got?.status).toBe('degraded');
    expect(got?.lastHealthAt).not.toBeNull();
  });
});
