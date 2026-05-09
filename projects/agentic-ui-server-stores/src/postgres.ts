import type { Pool, PoolClient } from 'pg';
import type { ThreadStateStore } from '@maverick/agentic-ui-server';

/**
 * Construction options for {@link PostgresThreadStateStore}.
 */
export interface PostgresThreadStateStoreOptions {
  /**
   * A `pg.Pool` instance. The store does NOT manage the pool's
   * lifecycle — callers are responsible for creating and ending it.
   * Lets the host use a single shared pool across multiple stores.
   */
  readonly pool: Pool;

  /**
   * Schema-qualified table name to use. The table must already exist
   * with the schema documented in {@link createSchemaSql} below.
   *
   * @example "agentic.thread_state"
   */
  readonly table: string;

  /**
   * Time-to-live in seconds. Set on every write. The store relies on
   * a Postgres `expires_at` column + a periodic cleanup job (NOT
   * provided by this store — typical pattern: a daily cron + a
   * `DELETE WHERE expires_at < now()`). `get` always filters by
   * `expires_at > now()` so expired rows read as missing.
   *
   * Set to `null` to disable TTL entirely (rows live until explicitly
   * deleted).
   *
   * @default 86_400 (24 hours)
   */
  readonly ttlSeconds?: number | null;
}

/**
 * Postgres-backed implementation of {@link ThreadStateStore}. Suitable
 * for multi-pod deployments that already use Postgres + want stronger
 * durability guarantees than Redis.
 *
 * @remarks
 * Trade-offs vs. {@link RedisThreadStateStore}:
 *
 * - **Stronger durability.** WAL-backed; survives Postgres restarts +
 *   replication failover.
 * - **Higher write latency.** Postgres writes typically 1.5–3× slower
 *   than Redis for this workload.
 * - **Reuses existing infrastructure.** Most enterprise stacks
 *   already have Postgres; no new operational dependency.
 * - **Tenant isolation** via row-level security or per-tenant tables
 *   is the host's responsibility; this store doesn't model tenancy.
 *   The recommended pattern is to construct one store per tenant
 *   with a tenant-scoped `table` argument.
 *
 * @example
 * ```ts
 * import { Pool } from 'pg';
 * import {
 *   PostgresThreadStateStore,
 *   createSchemaSql,
 * } from '@maverick/agentic-ui-server-stores/postgres';
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *
 * // One-time: create the table.
 * await pool.query(createSchemaSql({ table: 'agentic.thread_state' }));
 *
 * const store = new PostgresThreadStateStore<{ specialist: string }>({
 *   pool,
 *   table: 'agentic.thread_state',
 *   ttlSeconds: 86_400,
 * });
 *
 * await store.set('thread-1', { specialist: 'bookings' });
 * ```
 */
export class PostgresThreadStateStore<TState = unknown> implements ThreadStateStore<TState> {
  private readonly pool: Pool;
  private readonly table: string;
  private readonly ttlSeconds: number | null;

  constructor(options: PostgresThreadStateStoreOptions) {
    this.pool = options.pool;
    this.table = options.table;
    this.ttlSeconds = options.ttlSeconds === undefined ? 86_400 : options.ttlSeconds;
  }

  async get(threadId: string): Promise<TState | null> {
    const result = await this.withClient((client) =>
      client.query<{ state: TState }>(
        `SELECT state FROM ${this.table}
         WHERE thread_id = $1
           AND (expires_at IS NULL OR expires_at > now())
         LIMIT 1`,
        [threadId],
      ),
    );
    return result.rows[0]?.state ?? null;
  }

  async set(threadId: string, state: TState): Promise<void> {
    const expiresAt = this.ttlSeconds === null
      ? null
      : new Date(Date.now() + this.ttlSeconds * 1000);

    await this.withClient((client) =>
      client.query(
        `INSERT INTO ${this.table} (thread_id, state, expires_at, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (thread_id)
         DO UPDATE SET state = EXCLUDED.state,
                       expires_at = EXCLUDED.expires_at,
                       updated_at = now()`,
        [threadId, JSON.stringify(state), expiresAt],
      ),
    );
  }

  async delete(threadId: string): Promise<void> {
    await this.withClient((client) =>
      client.query(`DELETE FROM ${this.table} WHERE thread_id = $1`, [threadId]),
    );
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
}

/**
 * Schema migration helper. Returns the `CREATE TABLE` SQL needed for
 * {@link PostgresThreadStateStore}. The store does not run this
 * automatically — hosts apply it through their migration system
 * (knex / prisma / sqitch / hand-rolled / etc.) so the migration
 * is auditable + version-controlled like every other schema change.
 *
 * @example
 * ```ts
 * await pool.query(createSchemaSql({ table: 'agentic.thread_state' }));
 * ```
 */
export function createSchemaSql(options: { table: string }): string {
  return `
    CREATE TABLE IF NOT EXISTS ${options.table} (
      thread_id   TEXT PRIMARY KEY,
      state       JSONB NOT NULL,
      expires_at  TIMESTAMPTZ NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ${indexName(options.table, 'expires_at')}
      ON ${options.table} (expires_at)
      WHERE expires_at IS NOT NULL;
  `;
}

function indexName(table: string, column: string): string {
  // Strip schema prefix + sanitise, since CREATE INDEX names live
  // in the global namespace within a schema.
  const base = table.includes('.') ? table.split('.').pop() ?? table : table;
  return `${base}_${column}_idx`;
}
