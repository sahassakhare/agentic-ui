# @maverick/agentic-ui-server-stores

Production-ready adapters for [`@maverick/agentic-ui-server`](../agentic-ui-server/)'s `ThreadStateStore<TState>` interface — multi-pod-safe thread state for production deployments. Apache 2.0.

The base lib ships an `InMemoryThreadStateStore` that's adequate for single-pod deployments and tests. This package adds two production adapters:

| Adapter | Backed by | Best for |
|---|---|---|
| `RedisThreadStateStore` | [`ioredis`](https://github.com/redis/ioredis) | Lowest write latency; TTL via Redis `EX`. Recommended default. |
| `PostgresThreadStateStore` | [`pg`](https://node-postgres.com) | Stronger durability; reuses existing Postgres infra. |

## Install

```bash
npm install @maverick/agentic-ui-server-stores

# Plus whichever adapter(s) you use:
npm install ioredis     # for Redis
npm install pg          # for Postgres
```

`ioredis` and `pg` are declared as **optional peer dependencies**, so you only install the one you need. The package's `exports` field carries subpath entry points (`/redis`, `/postgres`) so the unused adapter's peer dep is never loaded.

## Redis adapter

```ts
import Redis from 'ioredis';
import { RedisThreadStateStore } from '@maverick/agentic-ui-server-stores/redis';

const redis = new Redis(process.env.REDIS_URL!);

const store = new RedisThreadStateStore<{ specialist: string }>({
  client: redis,
  prefix: 'prod:agentic:thread',
  ttlSeconds: 86_400,
});

await store.set('thread-1', { specialist: 'bookings' });
const state = await store.get('thread-1');
// → { specialist: 'bookings' }
```

The store **does not manage** the `ioredis` client's lifecycle — callers create + dispose. This makes the store agnostic to whether the host uses a single shared client, a per-tenant client, or a Sentinel / cluster setup.

Wire into the orchestrator agent:

```ts
import { OrchestratorAgent } from '@maverick/agentic-ui-server';

const orchestrator = new OrchestratorAgent('coordinator', {
  specialists,
  classifier,
  threadStateStore: store,
});
```

## Postgres adapter

```ts
import { Pool } from 'pg';
import {
  PostgresThreadStateStore,
  createSchemaSql,
} from '@maverick/agentic-ui-server-stores/postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// One-time: create the table. Run through your migration framework
// (knex / prisma / sqitch / hand-rolled). createSchemaSql() returns
// idempotent CREATE TABLE IF NOT EXISTS + index DDL.
await pool.query(createSchemaSql({ table: 'agentic.thread_state' }));

const store = new PostgresThreadStateStore<{ specialist: string }>({
  pool,
  table: 'agentic.thread_state',
  ttlSeconds: 86_400,
});
```

The Postgres adapter doesn't run the migration automatically — hosts apply it through their migration system so it's auditable + version-controlled like every other schema change.

### TTL + cleanup

`expires_at` is set on every write. `get` filters by `expires_at > now()` so expired rows read as missing. The package does not run a sweeper itself — typical pattern is a daily cron + `DELETE FROM agentic.thread_state WHERE expires_at < now()`.

## Multi-tenancy

Both adapters are tenant-agnostic by design. The recommended pattern:

- **Redis:** one store per tenant, with a tenant-scoped `prefix` (e.g. `prod:t-123:agentic:thread`).
- **Postgres:** one store per tenant, with a tenant-scoped `table` argument *or* a shared table with row-level security.

A future ADR + cookbook entry will document the canonical multi-tenant pattern. Until then, the simplest path is per-tenant store instantiation.

## Trade-offs at a glance

| Concern | In-memory (default) | Redis | Postgres |
|---|---|---|---|
| Multi-pod-safe | ❌ | ✅ | ✅ |
| Survives restart | ❌ | ✅ (within TTL) | ✅ |
| Write latency | ~µs | ~ms | ~few ms |
| Operational dependency | none | new (Redis) | reuse existing Postgres |
| TTL handling | n/a | Redis `EX` (native) | `expires_at` column + cron |

## What this package does NOT do

- ❌ **Pub/sub on changes.** For live cross-pod propagation of approval / operation registry state (ADR-011's `RegistryProviderHook`), the host wires a Redis pub/sub channel separately. A future cookbook entry covers the pattern.
- ❌ **Connection management.** Callers own client lifecycles.
- ❌ **Migration management.** `createSchemaSql` returns DDL; running it is the host's migration framework's job.
- ❌ **Built-in tenancy.** One adapter instance per tenant; tenancy is a host pattern, not a store concern.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
