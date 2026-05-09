/**
 * @maverick/agentic-ui-server-stores
 *
 * Production-ready adapters for `@maverick/agentic-ui-server`'s
 * `ThreadStateStore<TState>` interface. Use these in multi-pod
 * deployments where in-memory thread state isn't enough.
 *
 * Two adapters ship today:
 *
 * - `RedisThreadStateStore` — backed by `ioredis`. Lowest write
 *   latency; TTL via Redis `EX`. Recommended default for new
 *   deployments.
 * - `PostgresThreadStateStore` — backed by `pg`. Stronger durability;
 *   reuses existing Postgres infra. Recommended when the host stack
 *   already has Postgres + ops tooling around it.
 *
 * Each adapter has its own subpath import to keep peer-dependency
 * loading lazy:
 *
 *     import { RedisThreadStateStore } from '@maverick/agentic-ui-server-stores/redis';
 *     import { PostgresThreadStateStore } from '@maverick/agentic-ui-server-stores/postgres';
 *
 * The barrel export below re-exports both for convenience but also
 * imports both peer dependencies on first load — prefer the subpath
 * imports in production code so you only pay for the adapter you
 * use.
 */
export { RedisThreadStateStore } from './redis';
export type { RedisThreadStateStoreOptions } from './redis';

export {
  PostgresThreadStateStore,
  createSchemaSql,
} from './postgres';
export type { PostgresThreadStateStoreOptions } from './postgres';
