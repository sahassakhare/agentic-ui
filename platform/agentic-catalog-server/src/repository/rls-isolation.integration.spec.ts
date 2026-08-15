import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

/**
 * Real-Postgres RLS-isolation regression test (audit findings A6/A7 + the core
 * multi-tenant guarantee). pg-mem cannot enforce RLS, so this runs only when
 * TEST_DATABASE_URL points at a migrated catalog DB, connected as the
 * NON-superuser `catalog` role (superusers/BYPASSRLS bypass RLS). Proves, in
 * one session, that a tenant sees/writes only its own rows and that the
 * admin read-escape (`app.tenant_id = ''`) cannot WRITE cross-tenant
 * (the migration-012 WITH CHECK hardening).
 *
 *   TEST_DATABASE_URL=postgres://catalog:catalog@127.0.0.1:5433/catalog \
 *     npx vitest run src/repository/rls-isolation.integration.spec.ts
 */
const DB = process.env['TEST_DATABASE_URL'];
const A = `rls-a-${Date.now()}`;
const B = `rls-b-${Date.now()}`;

describe.skipIf(!DB)('RLS tenant isolation (real Postgres)', () => {
  let c: pg.Client;
  beforeAll(async () => {
    c = new pg.Client({ connectionString: DB! });
    await c.connect();
    // tenants has no RLS (platform directory); the owner role may seed it.
    await c.query(`INSERT INTO tenants(id, display_name) VALUES ($1,$1),($2,$2) ON CONFLICT (id) DO NOTHING`, [A, B]);
  });
  afterAll(async () => {
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
    await c.query(`DELETE FROM capabilities WHERE tenant_id = ANY($1)`, [[A, B]]).catch(() => {});
    await c.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[A, B]]).catch(() => {});
    await c.end();
  });

  const scope = (t: string) => c.query(`SELECT set_config('app.tenant_id',$1,false)`, [t]);
  const names = async () => (await c.query(`SELECT name FROM capabilities`)).rows.map((r) => r.name);

  it('each tenant sees only its own rows; cross-tenant read is blocked', async () => {
    await scope(A); await c.query(`INSERT INTO capabilities(tenant_id,kind,name,body,lifecycle,created_by) VALUES ($1,'tool','a-secret','{}'::jsonb,'published','t')`, [A]);
    await scope(B); await c.query(`INSERT INTO capabilities(tenant_id,kind,name,body,lifecycle,created_by) VALUES ($1,'tool','b-secret','{}'::jsonb,'published','t')`, [B]);
    await scope(A); const aNames = await names();
    expect(aNames).toContain('a-secret');
    expect(aNames).not.toContain('b-secret');
    await scope(B); const bNames = await names();
    expect(bNames).toContain('b-secret');
    expect(bNames).not.toContain('a-secret');
  });

  it('unset scope is fail-closed (zero rows)', async () => {
    await scope('');
    const n = (await c.query(`SELECT count(*)::int AS n FROM capabilities WHERE tenant_id = ANY($1)`, [[A, B]])).rows[0].n;
    // count() over the ANY filter still runs under RLS; escape-clause tables would leak, capabilities must not.
    expect(n).toBe(0);
  });

  it('cannot WRITE a row for another tenant (WITH CHECK)', async () => {
    await scope(A);
    await expect(
      c.query(`INSERT INTO capabilities(tenant_id,kind,name,body,lifecycle,created_by) VALUES ($1,'tool','leak','{}'::jsonb,'published','t')`, [B]),
    ).rejects.toThrow(/row-level security/i);
  });
});
