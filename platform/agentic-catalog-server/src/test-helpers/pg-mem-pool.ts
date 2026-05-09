import { newDb, DataType } from 'pg-mem';
import type pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build an in-memory Postgres for unit tests. pg-mem implements a
 * useful subset of Postgres — enough for our DDL + parameterised
 * queries + JSONB. RLS is NOT supported by pg-mem, so we test the
 * RLS-free path here and rely on integration tests (testcontainers)
 * for RLS verification.
 *
 * Also seeds the schema by loading + executing
 * `001_initial.sql`. RLS-enabling statements are stripped (pg-mem
 * doesn't understand `ENABLE ROW LEVEL SECURITY` / policies).
 */
export interface PgMemPoolOptions {
  /**
   * Tenant id seeded into the `tenants` table. Default `'test-tenant'`.
   */
  readonly seedTenantId?: string;
}

export interface PgMemHandle {
  readonly pool: pg.Pool;
  readonly destroy: () => Promise<void>;
}

export function createPgMemPool(options: PgMemPoolOptions = {}): PgMemHandle {
  const tenantId = options.seedTenantId ?? 'test-tenant';
  const db = newDb();

  // pg-mem doesn't ship gen_random_uuid() out of the box; pgcrypto
  // does. Register a stand-in that returns a fresh UUID per call.
  // `impure: true` is critical — without it pg-mem memoizes the call
  // result per query plan and every default-generated UUID collides.
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });

  // pg-mem also doesn't support GIN indexes (which we use for tags).
  // Strip them; functional behaviour is unaffected (queries still use
  // sequential scan).
  // pg-mem also doesn't grok `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY`
  // / `set_config`. Strip those — RLS isolation is integration-tested
  // separately (or by the operator's actual Postgres).
  const sqlPath = join(__dirname, '..', 'db', 'migrations', '001_initial.sql');
  const raw = readFileSync(sqlPath, 'utf-8');

  // Take the up section only (split on the explicit "-- Down Migration"
  // comment from our migrations file).
  const upSql = raw.split(/--\s*Down Migration/i)[0] ?? raw;

  const filtered = upSql
    .replace(/CREATE INDEX[^;]+USING GIN[^;]+;/gi, '')
    .replace(/ALTER TABLE\s+\w+\s+(ENABLE|FORCE)\s+ROW LEVEL SECURITY\s*;/gi, '')
    .replace(/DROP POLICY[^;]+;/gi, '')
    .replace(/CREATE POLICY[^;]+;/gi, '')
    // pg-mem doesn't support PL/pgSQL functions or triggers. The
    // touch_updated_at trigger maintains `updated_at` in real Postgres;
    // for unit tests, the application + tests do not assert on
    // updated_at changing within a sub-second test, so dropping it is
    // safe. Strip the function definition (multi-line $$-quoted body)
    // and any DROP/CREATE TRIGGER that references it.
    .replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$[\s\S]*?\$\$\s+LANGUAGE\s+\w+\s*;/gi, '')
    .replace(/DROP\s+TRIGGER\s+IF\s+EXISTS[^;]+;/gi, '')
    .replace(/CREATE\s+TRIGGER[^;]+EXECUTE\s+FUNCTION[^;]+;/gi, '')
    ;

  const adapter = db.adapters.createPg();
  const PgPool = adapter.Pool;

  // Apply migration
  // pg-mem's adapter is a pg-API-compatible Pool, but it doesn't expose
  // `query()` directly on the adapter — we have to use a client.
  const pool = new PgPool() as pg.Pool;

  const initPromise = (async () => {
    const client = await pool.connect();
    try {
      // Run statement-by-statement so a single failure doesn't stop all.
      // Strip leading/trailing whitespace AND skip statements that are
      // entirely whitespace or comments after the strip pass — pg-mem
      // rejects empty queries. The comment check strips `--` lines and
      // checks if anything else remains.
      const stmts = filtered
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter((s) => {
          if (s.length === 0) return false;
          // Strip every -- comment line; if nothing useful is left, drop.
          const stripped = s.replace(/--[^\n]*/g, '').trim();
          return stripped.length > 0;
        });
      for (const stmt of stmts) {
        try {
          await client.query(stmt);
        } catch (err) {
          // Swallow errors for unsupported features; surface anything else.
          if (
            err instanceof Error
            && /(ROW LEVEL SECURITY|POLICY|GIN)/i.test(err.message)
          ) {
            continue;
          }
          throw new Error(`pg-mem migration failed at:\n${stmt}\n→ ${(err as Error).message}`);
        }
      }
      // Seed the test tenant.
      await client.query(
        `INSERT INTO tenants (id, display_name) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [tenantId, tenantId],
      );
    } finally {
      client.release();
    }
  })();

  // Wrap pool.connect to await init.
  const originalConnect = pool.connect.bind(pool);
  pool.connect = (async () => {
    await initPromise;
    return originalConnect();
  }) as typeof pool.connect;

  return {
    pool,
    destroy: async () => {
      await pool.end();
    },
  };
}
