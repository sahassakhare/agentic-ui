import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createPgMemPool, type PgMemHandle } from '../test-helpers/pg-mem-pool.js';
import {
  appendAudit,
  AUDIT_GENESIS_HASH,
  listAuditRowsForExport,
  verifyAuditChain,
} from './audit-repo.js';

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

  // ── M3 C4 — hash-linked chain ────────────────────────────────
  describe('hash-linked chain', () => {
    it('first append uses the genesis hash; chain_position starts at 1', async () => {
      const row = await withClient((c) => appendAudit(c, {
        tenantId: TENANT, actor: 'a@iss', requestId: 'req-1',
        operation: 'create', entityType: 'capability', entityId: 'cap-1',
        diff: { after: { name: 'demo' } },
      }));
      expect(row.prevHash).toBe(AUDIT_GENESIS_HASH);
      expect(row.chainPosition).toBe(1);
      expect(row.entryHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('subsequent rows link to the previous entry_hash and increment position', async () => {
      const r1 = await withClient((c) => appendAudit(c, {
        tenantId: TENANT, actor: 'a', requestId: null,
        operation: 'create', entityType: 'capability', entityId: 'c-1', diff: { v: 1 },
      }));
      const r2 = await withClient((c) => appendAudit(c, {
        tenantId: TENANT, actor: 'a', requestId: null,
        operation: 'update', entityType: 'capability', entityId: 'c-1', diff: { v: 2 },
      }));
      const r3 = await withClient((c) => appendAudit(c, {
        tenantId: TENANT, actor: 'a', requestId: null,
        operation: 'delete', entityType: 'capability', entityId: 'c-1', diff: null,
      }));
      expect(r2.prevHash).toBe(r1.entryHash);
      expect(r3.prevHash).toBe(r2.entryHash);
      expect([r1.chainPosition, r2.chainPosition, r3.chainPosition]).toEqual([1, 2, 3]);
    });

    it('verifyAuditChain returns valid for a clean chain', async () => {
      for (let i = 0; i < 5; i++) {
        await withClient((c) => appendAudit(c, {
          tenantId: TENANT, actor: 'a', requestId: `r-${i}`,
          operation: 'create', entityType: 'capability', entityId: `c-${i}`, diff: { i },
        }));
      }
      const result = await withClient((c) => verifyAuditChain(c, TENANT));
      expect(result.valid).toBe(true);
      expect(result.checkedRows).toBe(5);
      expect(result.brokenAt).toBeNull();
      expect(result.chainHead?.chainPosition).toBe(5);
    });

    it('verifyAuditChain detects diff tampering', async () => {
      await withClient((c) => appendAudit(c, {
        tenantId: TENANT, actor: 'a', requestId: null,
        operation: 'create', entityType: 'capability', entityId: 'c-1',
        diff: { value: 'original' },
      }));
      await withClient((c) => appendAudit(c, {
        tenantId: TENANT, actor: 'a', requestId: null,
        operation: 'update', entityType: 'capability', entityId: 'c-1',
        diff: { value: 'second' },
      }));
      // Tamper with the first row's diff WITHOUT recomputing the hash.
      await withClient((c) => c.query(
        `UPDATE catalog_audit SET diff = $1::JSONB
         WHERE chain_position = 1 AND tenant_id = $2`,
        [JSON.stringify({ value: 'tampered' }), TENANT],
      ));

      const result = await withClient((c) => verifyAuditChain(c, TENANT));
      expect(result.valid).toBe(false);
      expect(result.brokenAt?.chainPosition).toBe(1);
      expect(result.brokenAt?.reason).toMatch(/entry_hash/i);
    });

    it('verifyAuditChain detects an injected (out-of-band) row', async () => {
      await withClient((c) => appendAudit(c, {
        tenantId: TENANT, actor: 'a', requestId: null,
        operation: 'create', entityType: 'capability', entityId: 'c-1', diff: null,
      }));
      // Inject a row by hand WITHOUT hashing.
      await withClient((c) => c.query(
        `INSERT INTO catalog_audit
           (tenant_id, actor, request_id, operation, entity_type, entity_id,
            diff, chain_position, prev_hash, entry_hash)
         VALUES ($1, 'attacker', NULL, 'create', 'capability', 'forged',
                 NULL, 2, $2, $3)`,
        [
          TENANT,
          AUDIT_GENESIS_HASH,
          'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        ],
      ));
      const result = await withClient((c) => verifyAuditChain(c, TENANT));
      expect(result.valid).toBe(false);
    });

    it('listAuditRowsForExport returns rows in chronological/position order', async () => {
      for (let i = 0; i < 3; i++) {
        await withClient((c) => appendAudit(c, {
          tenantId: TENANT, actor: 'a', requestId: `r-${i}`,
          operation: 'create', entityType: 'capability', entityId: `c-${i}`, diff: { i },
        }));
      }
      const rows = await withClient((c) => listAuditRowsForExport(c, TENANT));
      expect(rows.length).toBe(3);
      expect(rows.map((r) => r.chainPosition)).toEqual([1, 2, 3]);
    });

    it('canonical hash is stable under different key insertion order in `diff`', async () => {
      const r1 = await withClient((c) => appendAudit(c, {
        tenantId: TENANT, actor: 'a', requestId: null,
        operation: 'create', entityType: 'capability', entityId: 'c-1',
        diff: { a: 1, b: 2 },
      }));
      // Tamper with the diff using the SAME object content but a
      // freshly serialised JSON. The hash MUST still validate
      // because the canonicalisation is order-invariant.
      await withClient((c) => c.query(
        `UPDATE catalog_audit SET diff = $1::JSONB
         WHERE chain_position = 1 AND tenant_id = $2`,
        [JSON.stringify({ b: 2, a: 1 }), TENANT],
      ));
      const result = await withClient((c) => verifyAuditChain(c, TENANT));
      expect(result.valid).toBe(true);
      expect(result.chainHead?.entryHash).toBe(r1.entryHash);
    });
  });
});
