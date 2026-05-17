# ADR-029 · Multi-replica SSE via Postgres `LISTEN/NOTIFY`

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-015](./0015-catalog-server-design.md) · [ADR-021](./0021-self-managed-packaging.md) · [ADR-027](./0027-catalog-sse-stream.md)

---

## Context

[ADR-027](./0027-catalog-sse-stream.md) shipped Server-Sent Events
for the catalog with an in-process `EventEmitter` as the pub/sub
substrate — a deliberate single-replica scope, with multi-replica
explicitly deferred ([§D5](./0027-catalog-sse-stream.md#decision)).

That decision was correct for v0.1 (Render demo runs one replica;
ships value today). But the [Helm chart](../../platform/helm/agentic-platform/values.yaml)
defaults `catalogServer.replicaCount: 2` — so any production-shape
adopter who follows our default deployment topology has a partial
event stream. SSE clients connected to replica A don't see
mutations issued through replica B.

This ADR closes that gap.

---

## Decision

### D1 — Postgres `LISTEN/NOTIFY` as the cross-replica fan-out

When a mutation lands on any replica:

1. The replica emits the event to its **in-process bus**
   immediately. Local SSE clients see the event with <1ms latency
   — same UX as ADR-027.
2. The replica also calls `pg_notify('catalog_events', '<json>')`
   on a pooled connection.

Every replica (including the originating one) holds a **dedicated
LISTEN connection** that:

1. Receives the notification from Postgres (sub-second propagation
   in practice).
2. Inspects the envelope's `originReplicaId`.
3. **Skips** events that originated on this replica (already
   delivered locally — avoids double-emit to local SSE clients).
4. **Forwards** events from other replicas to the local in-process
   bus, which fans them out to local SSE clients.

Net effect: every SSE client connected to any replica sees every
mutation across every replica, regardless of which replica handled
the originating HTTP request. The originating replica's local
clients see it ~1ms faster than remote-replica clients, but every
client sees it within hundreds of ms.

### D2 — Indirection layer: `publishCatalogEvent`

Routes don't import `catalogBus` or `pg_notify` directly. They go
through a single `publishCatalogEvent(event)` function that the
server boot configures:

- **Default (test + dev)**: in-process bus only. Same as ADR-027
  semantics. No pg connection required.
- **Production (server.ts)**: bus emit + pg_notify, via the
  `PgNotifyListener.publishLocalAndRemote` helper.

This keeps tests simple — `pg-mem` doesn't support `LISTEN/NOTIFY`,
so the existing 156 tests work unchanged with the default
publisher. Production wiring is a single `setCatalogEventPublisher`
call in `server.ts`.

The indirection is a `publish: (event) => void` function —
deliberately not async. Routes don't await event delivery.
`pg_notify` failures are logged but don't fail the HTTP request.
Mutations have already committed; the SSE event is best-effort
notification.

### D3 — Self-echo filter via `originReplicaId`

Each replica generates a UUID at startup (`src/events/replica-id.ts`).
That UUID rides every `pg_notify` payload as `originReplicaId`. The
LISTEN handler:

```ts
if (envelope.originReplicaId === self.replicaId) return;
```

Without this, every event would emit twice on the originating
replica (once locally + once via the pg round-trip). With it, every
client sees every event exactly once.

Alternative considered: tag emits with a marker and have the bus
dedupe. Rejected — pollutes the event payload with infrastructure
metadata that pollutes SSE clients too. The originReplicaId stays
in the wire envelope, the LISTEN handler strips it before bus
emit.

### D4 — Reconnect with linear-then-exponential backoff

The dedicated LISTEN connection lives forever in steady state;
network blips, pg restarts, or replica failover can break it.
Behaviour:

- Initial connect failure → log warning, retry in 2s.
- Subsequent failures → backoff (×2) up to 30s cap.
- On successful (re)connect, reset the backoff.

The HTTP server does **not** depend on LISTEN being up — if pg
LISTEN can't connect, single-replica behaviour persists. The SSE
endpoint stays functional via the in-process bus; cross-replica
events are silently dropped until LISTEN reconnects. This matches
the ADR-021 "single-replica works without operator intervention"
principle.

### D5 — Deliberately NOT a separate broker abstraction

We considered a `CatalogEventBroker` interface with two
implementations (`InProcessBroker`, `PgNotifyBroker`). Decided
against:

- The publisher indirection (D2) gives us the same swap-out at
  ~10 lines of code vs ~100 LOC for a full broker abstraction.
- Routes don't need to know which broker is in use. They just call
  `publishCatalogEvent`.
- Future SSE-pubsub backends (Redis, NATS) drop in by replacing
  the publisher in `server.ts`. The interface is "publish a
  CatalogMutationEvent;" that's it.

If we later want hot-swappable brokers (e.g. operator chooses
Redis for sub-millisecond cross-replica latency), the publisher
indirection accommodates that without disturbing routes.

### D6 — Test coverage: handler logic, not pg integration

`pg-mem` doesn't support `LISTEN/NOTIFY`. We could:

- Add testcontainers-backed integration tests against real Postgres
  (substantial new test infrastructure; CI gets slower).
- Test the *handler logic* (self-echo filter, bus forwarding,
  malformed-payload behaviour) directly without involving pg.

Chose the second for v1. The handler is small (~15 lines), the
filter is the only correctness-critical piece, and we exercise it
across 5 unit tests.

The pg-side integration (LISTEN connect, NOTIFY round-trip,
reconnect-after-disconnect) lives in the deferred testcontainers
slice. Until then, manual smoke against the deployed Render +
Helm-bundled Postgres is the verification path.

### D7 — `DATABASE_URL` re-used by the LISTEN client

The PgNotifyListener constructs a `pg.Client` with
`process.env.DATABASE_URL` rather than borrowing from the pool.
Reasons:

- `LISTEN` claims the connection for its lifetime; a pool-borrowed
  connection would never return.
- The pool's connection options aren't all exposed on the pool
  instance, so reading `DATABASE_URL` from env is the simplest
  source-of-truth that matches the pool's configuration.
- Operators using a managed PG (RDS / Cloud SQL / Aiven /
  Supabase) already point both the pool and the LISTEN connection
  at the same `DATABASE_URL`.

Tightening: a future enhancement could expose the pool's
connection config so we don't depend on the env var being
present at runtime. v1 keeps it env-driven.

---

## Consequences

### Positive

- **Helm-deployed adopters get correct multi-replica SSE.** A
  mutation on any replica is observed by SSE clients on every
  replica. The ADR-027 §D5 production gap is closed.
- **Single-replica deployments unaffected.** Render demo + dev
  + tests still work. The publisher indirection means the default
  is exactly today's behaviour; only production server.ts opts in
  to the cross-replica path.
- **8 new tests** (3 publisher + 5 LISTEN-handler logic). Total
  catalog 164/164.

### Negative / risks

- **No live integration test against real pg LISTEN/NOTIFY.**
  Documented in §D6. Manual smoke is the verification path until
  the testcontainers harness slice lands.
- **One extra connection per replica.** Every replica holds a
  dedicated LISTEN connection beyond the pool. For a 4-replica
  deployment that's 4 extra connections. Negligible against
  managed-PG connection limits (typically 100+ allowed).
- **`pg_notify` payload size limit (~8KB).** Catalog mutation
  events are tiny (<1KB), so we're well under. Documented as a
  guardrail if anyone tries to start shipping full rows in the
  payload (which D4 of ADR-027 already discourages).
- **Replica restart drops in-flight notifications.** Postgres
  doesn't queue notifications for offline LISTENers. SSE clients
  reconnecting after a restart may miss events that occurred during
  the gap. Acceptable — clients re-fetch on reconnect anyway.

### Out of scope (deferred)

- **Testcontainers-backed pg LISTEN integration tests.** Real
  end-to-end coverage. The tests would verify multi-replica fan-
  out, reconnect-after-disconnect, payload-too-large handling.
  Substantial separate slice.
- **Redis pubsub backend.** Sub-millisecond cross-replica
  latency. Drop-in via the publisher indirection (D2). Defer
  until pg LISTEN's latency/load characteristics show as a
  bottleneck.
- **Notification queueing through restarts.** Could be done with a
  separate `events_outbox` table + a tailing process; meaningfully
  bigger architecture. Not needed today; clients re-fetch on
  reconnect.
- **Per-tenant channel filtering at pg.** Today, every replica
  receives every notification regardless of tenant; the SSE route
  filters per-tenant in-process. For very high mutation volumes
  with many tenants, switching to per-tenant channels
  (`pg_notify('catalog_events_<tenantId>', ...)`) would reduce
  cross-replica chatter. Defer until profile data shows demand.

---

## Implementation summary

- `src/events/replica-id.ts` — module-load UUID for self-echo
  detection.
- `src/events/pg-notify-listener.ts` — dedicated pg.Client +
  LISTEN handler + reconnect loop. Provides `publishRemote` (calls
  `pg_notify`) and `publishLocalAndRemote` (in-process emit + pg
  notify).
- `src/events/publisher.ts` — `publishCatalogEvent(event)` indirection
  hook. Default impl emits to bus; `setCatalogEventPublisher`
  swaps to the multi-replica impl in production.
- All 5 mutation routes (capabilities, mfes, role-mappings,
  tenants, usage) migrated from `catalogBus.emit` to
  `publishCatalogEvent`. No semantic change in tests; production
  gets cross-replica delivery for free.
- `src/server.ts` — at boot: construct `PgNotifyListener`, call
  `start()`, install the multi-replica publisher. Graceful
  shutdown closes the LISTEN connection before the pool.
- 8 new tests (3 publisher routing + 5 self-echo handler logic).

Total catalog: 164/164. Platform: 644/644.
