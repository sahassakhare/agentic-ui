import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

/**
 * Real-Postgres RLS isolation for `experience_publications` (migration 014).
 * pg-mem cannot enforce RLS, so this runs only when TEST_DATABASE_URL points at
 * a migrated catalog DB connected as the NON-superuser `catalog` role. Proves a
 * tenant cannot SELECT another tenant's publication row — even holding the raw
 * key hash — and cannot WRITE a row for another tenant (WITH CHECK).
 *
 *   TEST_DATABASE_URL=postgres://catalog:catalog@127.0.0.1:5433/catalog \
 *     npx vitest run src/repository/publication-rls.integration.spec.ts
 */
const DB = process.env['TEST_DATABASE_URL'];
const A = `pub-a-${Date.now()}`;
const B = `pub-b-${Date.now()}`;
const EXP_A = '11111111-1111-1111-1111-111111111111';
const EXP_B = '22222222-2222-2222-2222-222222222222';

describe.skipIf(!DB)('experience_publications RLS (real Postgres)', () => {
  let c: pg.Client;
  beforeAll(async () => {
    c = new pg.Client({ connectionString: DB! });
    await c.connect();
    await c.query(`INSERT INTO tenants(id, display_name) VALUES ($1,$1),($2,$2) ON CONFLICT (id) DO NOTHING`, [A, B]);
  });
  afterAll(async () => {
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
    await c.query(`DELETE FROM experience_publications WHERE tenant_id = ANY($1)`, [[A, B]]).catch(() => {});
    await c.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[A, B]]).catch(() => {});
    await c.end();
  });

  const scope = (t: string) => c.query(`SELECT set_config('app.tenant_id',$1,false)`, [t]);
  const insert = (t: string, exp: string, keyHash: string) =>
    c.query(
      `INSERT INTO experience_publications
        (tenant_id, experience_id, experience_name, published_version_no, key_hash, key_prefix, allowed_origins, bundle, published_by)
       VALUES ($1,$2,'e',1,$3,'emb_x','{}','{}'::jsonb,'root')`,
      [t, exp, keyHash],
    );

  it('a tenant sees only its own publications', async () => {
    await scope(A); await insert(A, EXP_A, 'hash-a');
    await scope(B); await insert(B, EXP_B, 'hash-b');

    await scope(A);
    const aRows = (await c.query(`SELECT key_hash FROM experience_publications`)).rows.map((r) => r.key_hash);
    expect(aRows).toContain('hash-a');
    expect(aRows).not.toContain('hash-b');
  });

  it('cannot read another tenant\'s publication even with the raw key hash', async () => {
    await scope(A);
    const n = (await c.query(`SELECT count(*)::int AS n FROM experience_publications WHERE key_hash = $1`, ['hash-b'])).rows[0].n;
    expect(n).toBe(0);
  });

  it('cannot WRITE a publication for another tenant (WITH CHECK)', async () => {
    await scope(A);
    await expect(insert(B, EXP_B, 'leak')).rejects.toThrow(/row-level security/i);
  });
});
