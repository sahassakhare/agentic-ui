import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createPgMemPool, type PgMemHandle } from '../test-helpers/pg-mem-pool.js';
import { appendAudit } from './audit-repo.js';

const TENANT = 'test-tenant';

describe('audit-repo', () => {
  let handle: PgMemHandle;

  beforeEach(() => { handle = createPgMemPool({ seedTenantId: TENANT }); });
  afterEach(async () => { await handle.destroy(); });

  async function withClient<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await handle.pool.connect();
    try { return await fn(client); } finally { client.release(); }
  }

  it('appends a row that survives the round-trip', async () => {
    await withClient((c) => appendAudit(c, {
      tenantId: TENANT,
      actor: 'user@idp.example.com',
      requestId: 'req-1',
      operation: 'create',
      entityType: 'capability',
      entityId: 'cap-001',
      diff: { after: { name: 'foo' } },
    }));

    const result = await withClient((c) =>
      c.query('SELECT * FROM catalog_audit ORDER BY occurred_at DESC LIMIT 1'),
    );
    expect(result.rows[0]).toMatchObject({
      tenant_id: TENANT,
      actor: 'user@idp.example.com',
      request_id: 'req-1',
      operation: 'create',
      entity_type: 'capability',
      entity_id: 'cap-001',
    });
    expect(result.rows[0].diff).toEqual({ after: { name: 'foo' } });
  });

  it('accepts null requestId + null diff', async () => {
    await withClient((c) => appendAudit(c, {
      tenantId: TENANT,
      actor: 'svc@example.com',
      requestId: null,
      operation: 'delete',
      entityType: 'capability',
      entityId: 'cap-002',
      diff: null,
    }));

    const result = await withClient((c) =>
      c.query('SELECT request_id, diff FROM catalog_audit WHERE entity_id = $1', ['cap-002']),
    );
    expect(result.rows[0].request_id).toBeNull();
    expect(result.rows[0].diff).toBeNull();
  });

  it('all four operations land', async () => {
    for (const op of ['create', 'update', 'delete', 'restore'] as const) {
      await withClient((c) => appendAudit(c, {
        tenantId: TENANT,
        actor: 'a@b.example',
        requestId: null,
        operation: op,
        entityType: 'capability',
        entityId: `cap-${op}`,
        diff: null,
      }));
    }
    const result = await withClient((c) =>
      c.query<{ operation: string }>('SELECT operation FROM catalog_audit ORDER BY operation'),
    );
    expect(result.rows.map((r) => r.operation)).toEqual(['create', 'delete', 'restore', 'update']);
  });
});
