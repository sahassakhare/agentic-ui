# Production deployment

What changes between the demo-server-on-localhost setup and a real
multi-pod deployment. The browser side scales naturally — every chat
session is independent. The bottleneck is the **server**, and inside
the server it's stateful agents that pin a conversation to a single
process.

## The state cliff

`OrchestratorAgent`'s sticky-by-thread routing is the canonical example.
First time a thread is routed, the agent stores the chosen specialist;
subsequent turns reuse it. With state in a `Map`, a pod restart drops
every conversation's routing state, and a multi-pod load-balancer with
non-sticky sessions misroutes immediately.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser                                                              │
│    chat shell · talks AG-UI to /agents/orchestrator/run               │
└──────────────────────┬────────────────────────────────────────────────┘
                       │ load balancer
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
   │  pod A  │    │  pod B  │    │  pod C  │
   │ Map<>   │    │ Map<>   │    │ Map<>   │   ← in-memory, lost on
   │ tid →   │    │ tid →   │    │ tid →   │     restart, NOT shared
   │ "book"  │    │ (empty) │    │ (empty) │
   └─────────┘    └─────────┘    └─────────┘
```

The fix is the `ThreadStateStore` interface — externalise the map.

```
   ┌─────────┐    ┌─────────┐    ┌─────────┐
   │  pod A  │    │  pod B  │    │  pod C  │
   └────┬────┘    └────┬────┘    └────┬────┘
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                ┌─────────────┐
                │   Redis     │   ← shared, durable
                │  threadId → │
                │  specialist │
                └─────────────┘
```

## The interface

Shipped from `@maverick/agentic-ui-server`:

```ts
export interface ThreadStateStore<TState = unknown> {
  get(threadId: string): Promise<TState | null>;
  set(threadId: string, state: TState): Promise<void>;
  delete?(threadId: string): Promise<void>;
}
```

Plus a default `InMemoryThreadStateStore` implementation that's used
when consumers don't pass a `stateStore` to the orchestrator.

```ts
export class InMemoryThreadStateStore<TState> implements ThreadStateStore<TState> {
  private map = new Map<string, TState>();
  async get(id) { return this.map.get(id) ?? null; }
  async set(id, state) { this.map.set(id, state); }
  async delete(id) { this.map.delete(id); }
}
```

## Redis adapter (drop-in)

```ts
import { createClient } from 'redis';
import type { ThreadStateStore } from '@maverick/agentic-ui-server';

export class RedisThreadStateStore<TState> implements ThreadStateStore<TState> {
  constructor(
    private readonly redis: ReturnType<typeof createClient>,
    private readonly prefix = 'agentic:thread',
    private readonly ttlSeconds = 86_400,                // 24h sliding window
  ) {}

  async get(threadId: string): Promise<TState | null> {
    const raw = await this.redis.get(`${this.prefix}:${threadId}`);
    if (!raw) return null;
    // Reset the sliding-window TTL on read so active conversations
    // don't get evicted.
    await this.redis.expire(`${this.prefix}:${threadId}`, this.ttlSeconds);
    return JSON.parse(raw) as TState;
  }

  async set(threadId: string, state: TState): Promise<void> {
    await this.redis.set(
      `${this.prefix}:${threadId}`,
      JSON.stringify(state),
      { EX: this.ttlSeconds },
    );
  }

  async delete(threadId: string): Promise<void> {
    await this.redis.del(`${this.prefix}:${threadId}`);
  }
}
```

Wire it into the orchestrator at server start:

```ts
// server.ts
import { createClient } from 'redis';
import { OrchestratorAgent } from './orchestrator-agent';
import { RedisThreadStateStore } from './redis-thread-state-store';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const orchestrator = new OrchestratorAgent('orchestrator', {
  apiKey,
  subAgents: specialists,
  stateStore: new RedisThreadStateStore(redis, 'agentic:thread', 86_400),
});
```

That's the whole change. The orchestrator's `run()` already awaits
`get` / `set` calls, so swapping a synchronous Map for a network
roundtrip is invisible to its consumers.

## Postgres adapter (sketch)

```ts
import type { Pool } from 'pg';
import type { ThreadStateStore } from '@maverick/agentic-ui-server';

export class PostgresThreadStateStore<TState> implements ThreadStateStore<TState> {
  constructor(private readonly pool: Pool, private readonly table = 'agentic_thread_state') {}

  async get(threadId: string): Promise<TState | null> {
    const r = await this.pool.query(
      `SELECT state FROM ${this.table} WHERE thread_id = $1 AND expires_at > NOW()`,
      [threadId],
    );
    return r.rows[0]?.state ?? null;
  }

  async set(threadId: string, state: TState): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table} (thread_id, state, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')
       ON CONFLICT (thread_id) DO UPDATE
         SET state = EXCLUDED.state, expires_at = EXCLUDED.expires_at`,
      [threadId, state],
    );
  }

  async delete(threadId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE thread_id = $1`, [threadId]);
  }
}
```

```sql
CREATE TABLE agentic_thread_state (
  thread_id   TEXT PRIMARY KEY,
  state       JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);
CREATE INDEX ON agentic_thread_state (expires_at);
-- Optional: nightly cleanup
-- DELETE FROM agentic_thread_state WHERE expires_at <= NOW();
```

## Other state worth externalising

The `OrchestratorAgent`'s sticky map is the obvious one. As you build
more stateful agents, the same pattern applies:

| State | Store via | Notes |
|---|---|---|
| Sticky routing (orchestrator) | `ThreadStateStore<{specialist: string}>` | Already wired |
| Conversation memory (multi-turn summary) | A second `ThreadStateStore<MemoryState>` instance, separate key prefix | Keep summarisation on the read path so reads stay fast |
| Tool-call cache (bookFlight should be idempotent) | A normal cache (Redis with shorter TTL) | Tool ids are derived; just `SET EX 60` on the call key |
| Agent-server config / feature flags | A real config service or env vars | Don't conflate with per-thread state |

## Concurrency caveat

`ThreadStateStore.set` is not transactional with `get` — two concurrent
turns on the same thread can race. In practice this isn't a problem
because `runUntilSettled` serialises turns from a single browser
session, but if your deployment has multiple devices or tabs hitting
the same thread you'll want CAS / optimistic locking. The interface
intentionally doesn't bake this in — different stores have different
primitives (Redis `WATCH`/`MULTI`, Postgres row locks). The cookbook
entry on hardening will cover it when we get there.

## What about the LLM rate limit?

Quota exhaustion is the second cliff after state. The orchestrator
already retries the classifier with backoff and falls back to keyword
matching, so individual turns survive. For traffic shaping, wrap the
route handler in a guard:

```ts
import { agUiRouteHandler } from '@maverick/agentic-ui-server';
import { rateLimit } from 'hono-rate-limiter';

app.use(
  '/agents/*',
  rateLimit({ keyGenerator: (c) => c.req.header('x-thread-id') ?? c.req.header('x-forwarded-for') ?? 'anon',
              windowMs: 60_000, limit: 30 }),
);
app.post('/agents/:id/run', (c) => agUiRouteHandler({ resolver })(c.req.raw));
```

A per-thread (or per-IP) cap keeps a runaway client from burning your
LLM quota for everyone else.

## Checklist for going to prod

- [ ] Replace `InMemoryThreadStateStore` with a Redis or Postgres adapter
- [ ] Wire `agentUrl` to a real production endpoint (not `localhost:4111`)
- [ ] Set `CORS_ORIGINS` to an explicit allowlist (no `*`)
- [ ] Set `AGENT_AUTH_TOKENS` to require bearer auth
- [ ] Add a per-thread / per-IP rate limiter at the route level
- [ ] Move LLM API keys out of `.env` into a secret manager
- [ ] Set up structured logging (the demo-server's logger.ts is a starting point)
- [ ] Wire `provideAgenticTelemetry({ kind: 'otel', exporter: 'otlp-http' })` for distributed tracing
- [ ] Configure SIGTERM handling so the pod drains in-flight SSE connections before exit (already done in `examples/demo-server/src/server.ts`)
- [ ] Set Kubernetes liveness probe to `GET /health`, readiness probe to a deeper agent-resolver check

## Where to next

- [Sample prompts](./sample-prompts.md) — boundary-condition prompts including abort-mid-stream that exercise the SIGTERM-drain path
- [Observability](./observability.md) — OpenTelemetry wiring across the SSE boundary
- [Multi-agent orchestration](./multi-agent-orchestration.md) — the routing flow that motivates needing a `ThreadStateStore` in the first place
