import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, withTenantScope, type CatalogPool } from '../db/pool.js';
import { appendAudit, verifyAuditChain } from './audit-repo.js';
import type { Principal } from '../domain/principal.js';

/**
 * Regression test for the audit-chain concurrency fix (per-tenant advisory
 * lock in {@link appendAudit}). Before the fix, concurrent appenders for one
 * tenant raced on the "read head → compute next chain_position → insert"
 * sequence and collided on `catalog_audit_chain_position_idx` (500s under load,
 * ~25/40 in manual soak). pg-mem cannot cover this — it has no advisory locks
 * and runs single-threaded — so this is a REAL-Postgres integration test,
 * skipped unless TEST_DATABASE_URL points at a migrated catalog database.
 *
 *   TEST_DATABASE_URL=postgres://catalog:catalog@127.0.0.1:5433/catalog \
 *     npx vitest run src/repository/audit-repo.concurrency.integration.spec.ts
 */
const DB = process.env['TEST_DATABASE_URL'];
const CONCURRENCY = 40;

describe.skipIf(!DB)('appendAudit — concurrent appenders (real Postgres)', () => {
  let pool: CatalogPool;
  const tenantId = `conc-test-${Date.now()}`;
  const principal: Principal = {
    sub: 'tester', tenantId, roles: ['member'], displayName: 'Tester',
  } as Principal;

  beforeAll(async () => {
    pool = createPool({ connectionString: DB!, max: CONCURRENCY });
  });
  afterAll(async () => {
    // Clean the rows this test created, then close.
    await withTenantScope(pool, principal, async (c) => {
      await c.query('DELETE FROM catalog_audit WHERE tenant_id = $1', [tenantId]);
    }).catch(() => { /* best-effort cleanup */ });
    await pool.end();
  });

  it(`${CONCURRENCY} concurrent appends to one tenant produce a dense, valid chain with zero collisions`, async () => {
    const appends = Array.from({ length: CONCURRENCY }, (_, i) =>
      withTenantScope(pool, principal, (client) =>
        appendAudit(client, {
          tenantId,
          actor: 'tester',
          requestId: `req-${i}`,
          operation: 'create',
          entityType: 'capability',
          entityId: `cap-${i}`,
          diff: { i },
        }),
      ),
    );

    // No append should reject — a duplicate-key would surface here.
    const results = await Promise.allSettled(appends);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected, rejected.map((r: any) => r.reason?.message).join('; ')).toHaveLength(0);

    // Positions must be dense 1..N with no gaps or dupes.
    const positions = results
      .map((r) => (r.status === 'fulfilled' ? r.value.chainPosition : null))
      .filter((p): p is number => p != null)
      .sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));

    // And the chain must verify end to end.
    const verify = await withTenantScope(pool, principal, (c) => verifyAuditChain(c, tenantId));
    expect(verify.valid).toBe(true);
    expect(verify.checkedRows).toBe(CONCURRENCY);
  });
});
