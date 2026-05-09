import pg from 'pg';
import type { Principal } from '../domain/principal.js';

/**
 * Process-wide Postgres connection pool. Constructed once at server
 * startup; closed on graceful shutdown. Operators tune pool size via
 * `DATABASE_POOL_MAX` env var (default: 10) and `DATABASE_IDLE_MS`
 * (default: 30_000).
 */
export type CatalogPool = pg.Pool;

export interface PoolConfig {
  readonly connectionString: string;
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
  readonly statementTimeoutMs?: number;
}

export function createPool(config: PoolConfig): CatalogPool {
  return new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    statement_timeout: config.statementTimeoutMs ?? 5_000,
    application_name: 'agentic-catalog-server',
  });
}

/**
 * Acquire a connection from the pool, set the tenant variable that
 * drives RLS policies, run the callback inside a transaction, and
 * release the connection (regardless of error). Every catalog query
 * goes through this — RLS is the only thing keeping tenants apart at
 * the DB layer, so missing the `SET LOCAL` is a security bug.
 *
 * The variable name (`app.tenant_id`) matches the RLS policies
 * defined in `migrations/001_initial.sql`.
 *
 * @example
 * ```ts
 * const rows = await withTenantScope(pool, principal, async (client) => {
 *   const r = await client.query(
 *     'SELECT * FROM capabilities WHERE kind = $1', ['tool']);
 *   return r.rows;
 * });
 * ```
 */
export async function withTenantScope<T>(
  pool: CatalogPool,
  principal: Principal,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL is transaction-scoped — auto-cleared on COMMIT/ROLLBACK
    // so a connection returned to the pool can't leak its previous
    // tenant scope to the next checkout. set_config('app.tenant_id', $1, true)
    // is equivalent to SET LOCAL but accepts a parameterised value (SET LOCAL
    // does not, by design).
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [principal.tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow — original error wins */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Connectivity check used by `/readyz`. Quick `SELECT 1` with a
 * timeout. Returns `false` on any error so probe results stay
 * boolean — log details separately.
 */
export async function pingDb(pool: CatalogPool): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}
