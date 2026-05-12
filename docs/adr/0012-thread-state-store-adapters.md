# ADR-012 · `ThreadStateStore` adapters — sibling-package design

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-010](./0010-platform-principles-and-license.md) · [ADR-011](./0011-registry-provider-hook.md)

---

## Context

`@infra-tools/agentic-ui-server` already ships a `ThreadStateStore<TState>` interface and an `InMemoryThreadStateStore` default. The interface is async-shaped:

```ts
interface ThreadStateStore<TState = unknown> {
  get(threadId: string): Promise<TState | null>;
  set(threadId: string, state: TState): Promise<void>;
  delete?(threadId: string): Promise<void>;
}
```

Single-pod deployments use the default. Multi-pod deployments need a backing store that converges across pods + survives restarts. The v3 plan §4.1 R3 calls for Redis + Postgres adapters as the M1 deliverable.

This ADR records the design decisions that shape the adapter package.

---

## Decision

### D1 — Adapters live in a sibling package, not in `agentic-ui-server`

New package: `@infra-tools/agentic-ui-server-stores`. The Redis + Postgres adapters live there, not in `agentic-ui-server`. Reasoning:

- **Embedded-first principle (ADR-010 D3)** applies tonally even to the server-side surface. Pulling `ioredis` + `pg` into `agentic-ui-server` would inflate install size + dependency surface for every consumer, including those who only need the in-memory default.
- **Optional peer dependencies are awkward in a single package**. Declaring `ioredis` + `pg` as optional peers on `agentic-ui-server` forces consumers to wade through warnings about missing peers. A separate package puts the peer-dep declaration where it's actually load-bearing.
- **Mirrors the existing pattern**: `@infra-tools/agentic-ui-mcp` is a sibling to the runtime tier; `@infra-tools/agentic-ui-server-stores` is the same pattern for the server tier.

### D2 — Both adapters declare optional peer dependencies

`ioredis ^5.4` and `pg ^8.11` are declared in `peerDependencies` *and* `peerDependenciesMeta.{optional: true}`. Consumers install only the adapter they use:

```bash
npm install @infra-tools/agentic-ui-server-stores
npm install ioredis    # for Redis
# OR
npm install pg         # for Postgres
```

Subpath entry points (`./redis`, `./postgres`) ensure the unused adapter's peer dep is never loaded. The barrel `./index.js` re-exports both for convenience but eagerly loads both peer deps; production code should prefer the subpath imports.

### D3 — Caller-managed client lifecycle

Neither adapter creates or disposes its underlying client (`Redis` instance for `ioredis`, `Pool` for `pg`). The adapter takes a pre-constructed client in its options bag and uses it.

Reasoning:

- Hosts often use a single shared client across multiple subsystems (orchestrator + cache + rate-limiter).
- Sentinel / cluster setups need custom client construction the adapter shouldn't try to model.
- Disposal timing is host-specific (graceful shutdown sequencing, drain semantics).

### D4 — JSON serialisation; consumer responsibility for safe shapes

Both adapters call `JSON.stringify` / `JSON.parse` on `TState`. Consumers must keep `TState` JSON-serialisable (no functions, no class instances, no circular refs). This is the same constraint the in-memory default has *implicitly*; we surface it explicitly here.

A future ADR could introduce structured-clone / msgpack / CBOR encoding; not in scope for v0.1.

### D5 — TTL is a first-class concern

Production stores grow unbounded without TTL. Both adapters set TTL on every write:

- **Redis**: native `EX` argument (server-side expiry, no host involvement).
- **Postgres**: `expires_at TIMESTAMPTZ` column; reads filter `WHERE expires_at > now()`. Hosts run a periodic cleanup job (e.g., daily cron + `DELETE WHERE expires_at < now()`). The adapter does NOT run a sweeper itself — sweepers belong in the host's job scheduler, not in a library.

Default TTL: 24 hours. Set to `null` to disable. Documented in the README's trade-off matrix.

### D6 — Postgres schema migration is host-owned

`createSchemaSql({table})` returns idempotent `CREATE TABLE IF NOT EXISTS` + index DDL. The adapter does NOT execute this. Hosts apply it through their migration framework (knex / prisma / sqitch / hand-rolled) so the migration is auditable + version-controlled like every other schema change.

### D7 — Multi-tenancy is the host's pattern, not the adapter's

Adapters are tenant-agnostic. The recommended pattern:

- **Redis**: one store per tenant, with a tenant-scoped `prefix` (e.g., `prod:t-123:agentic:thread`).
- **Postgres**: one store per tenant, with a tenant-scoped `table` argument *or* a shared table with row-level security.

Building tenancy into the adapter would over-couple it to a tenancy model we don't fully know yet. A future cookbook entry will document the canonical patterns.

### D8 — Pub/sub on changes is out of scope

The adapters do **not** notify when other pods write to the same key. For live cross-pod propagation of `RegistryProviderHook` (ADR-011) state, hosts wire a Redis pub/sub channel separately + invalidate their local registry on receipt. A future cookbook entry covers this — the adapter contract doesn't grow.

This keeps the `ThreadStateStore` contract narrow + stable. It's a CRUD store, not a reactive primitive.

### D9 — Unit-test adapters with mocked clients; defer integration tests

The PR ships unit tests that exercise the adapter logic against mocked `ioredis` / `pg` clients. Integration tests against real Redis / Postgres need:

- CI infrastructure (Docker-in-Docker on GitHub Actions, or `testcontainers`)
- A standardised test harness for the adapter contract

Both add scope to this PR without proving the design. Defer to a follow-up that introduces the testcontainers-based harness for *all* adapters consistently. Until then, the unit tests confirm the SQL/Redis-command shapes; the integration story is established once a real adopter wires this in production.

---

## Consequences

### Positive

- **Embedded-first preserved.** `agentic-ui-server` install size unchanged; consumers without multi-pod needs pay nothing.
- **Single source of truth for the interface.** Adapters import from `agentic-ui-server`; if the interface evolves (additive only per ADR-010 D4), all adapters stay aligned.
- **Pattern reusable.** Future adapters (DynamoDB, FoundationDB, Cloudflare Durable Objects) follow the same package-shape recipe.
- **Optional peer deps don't pollute the main lib.** Consumers see no warnings about missing peers.

### Negative

- **Consumers see two npm-installs** (the package + the peer dep). README documents this clearly.
- **No live cross-pod sync** in v0.1. For approval/operation registry mirroring across pods, hosts need to wire Redis pub/sub themselves. Cookbook coming.
- **Postgres adapter requires a migration step.** Not zero-config. Reasonable for the audience that picks Postgres for durability.

### Neutral

- Sub-paths force consumers to import from `/redis` or `/postgres`. Barrel still works. Consistent with how `@angular-architects/native-federation` ships its subpaths.

---

## Alternatives considered

### A1 — Bundle adapters into `agentic-ui-server`

Reject. Inflates install size for every consumer; conflicts with ADR-010 D3 spirit.

### A2 — One adapter per package (`agentic-ui-server-stores-redis`, `…-postgres`)

Reject. Over-fragments the package landscape. Two adapters per package is the right granularity; the subpath imports give the same effective lazy-load behaviour without forcing users to learn which package each adapter lives in.

### A3 — Make adapters provide pub/sub out of the box

Reject for v0.1. Pub/sub is a cross-pod pattern that requires careful design (delivery guarantees, ordering, partial-failure). Doing it well needs more design time than R3 has. v0.2 / v1.0 of this package can grow it once a real consumer drives the requirements.

### A4 — Use a generic key-value abstraction (Keyv, unstorage) instead of per-adapter classes

Reject. Keyv / unstorage abstract too much — they hide the optimisations (Redis `EX`, Postgres `ON CONFLICT`) we want to expose. Per-adapter classes are 60–100 LOC each and stay readable; a generic wrapper would obscure what's actually happening.

---

## Implementation

This ADR is implemented in the same PR. Files:

- `projects/agentic-ui-server-stores/package.json` — peer-dep declarations + subpath exports
- `projects/agentic-ui-server-stores/src/redis.ts` — `RedisThreadStateStore` (~110 LOC)
- `projects/agentic-ui-server-stores/src/postgres.ts` — `PostgresThreadStateStore` + `createSchemaSql` (~140 LOC)
- `projects/agentic-ui-server-stores/src/index.ts` — barrel export
- `projects/agentic-ui-server-stores/tsconfig.json` — same shape as `agentic-ui-server`
- `projects/agentic-ui-server-stores/CHANGELOG.md` — v0.1.0 entry
- `projects/agentic-ui-server-stores/README.md` — install + usage + trade-offs
- `projects/agentic-ui-server-stores/LICENSE` — Apache 2.0

Out of scope:

- Integration tests against real Redis / Postgres (deferred — needs testcontainers harness).
- Cookbook entries for multi-tenancy + pub/sub (separate PRs).
- Wiring an adopter end-to-end (orchestrator using Redis store) — separate PR.

---

## References

- [ADR-010 — Platform principles, Apache 2.0, codified non-goals](./0010-platform-principles-and-license.md)
- [ADR-011 — RegistryProviderHook design](./0011-registry-provider-hook.md)
- [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md) §4.1 R3
- [`@infra-tools/agentic-ui-server`](../../projects/agentic-ui-server/) — the package that owns the `ThreadStateStore<TState>` interface
- [docs/cookbook/production-deployment.md](../cookbook/production-deployment.md) — existing concept doc
