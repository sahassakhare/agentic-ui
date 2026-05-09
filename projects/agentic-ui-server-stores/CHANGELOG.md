# Changelog

All notable changes to `@maverick/agentic-ui-server-stores` are recorded here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-09

Initial release. Production adapters for `ThreadStateStore<TState>` from
[@maverick/agentic-ui-server](https://www.npmjs.com/package/@maverick/agentic-ui-server).

### Added

- **`RedisThreadStateStore`** — Redis-backed adapter using `ioredis`. Configurable
  prefix + TTL; caller-managed client lifecycle. Sub-2 ms write latency for
  co-located deployments. Subpath import: `@maverick/agentic-ui-server-stores/redis`.
- **`PostgresThreadStateStore`** — Postgres-backed adapter using `pg`. JSONB column
  + `expires_at` timestamp for TTL filtering. Caller owns the pool. Subpath import:
  `@maverick/agentic-ui-server-stores/postgres`. Includes `createSchemaSql()` helper
  returning idempotent migration DDL — run through your migration framework.
- **`peerDependencies`** — `ioredis ^5.4` and `pg ^8.11` are declared as **optional**
  peers, so consumers only install the adapter they use. The `exports` field's
  subpath entries (`/redis`, `/postgres`) ensure unused peer deps are never loaded.

### Trade-offs documented

- In-memory (default in `agentic-ui-server`) → Redis → Postgres trade-off matrix in
  [README](./README.md). Picks Redis as the recommended default; Postgres for
  stacks that already operate it.
- Multi-tenancy is **caller-owned**: per-tenant `prefix` (Redis) or per-tenant
  `table` (Postgres). The adapter doesn't model tenancy.
- Pub/sub-on-change is **out of scope** for this release. Cross-pod propagation
  of `RegistryProviderHook` (ADR-011) state is a separate cookbook pattern.

### Known gaps

- No automatic Postgres sweeper for expired rows. Run a daily cron with
  `DELETE WHERE expires_at < now()`.
- No built-in metrics. Wire your own via the host's OpenTelemetry stack.
- Integration tests against real Redis / Postgres are not in this PR — the
  adapters are unit-tested against mocked clients. Integration tests land
  alongside the cookbook entry that exercises them end-to-end.

### Related

- [ADR-012 — ThreadStateStore adapter package](../../docs/adr/0012-thread-state-store-adapters.md)
- [docs/plans/platform-evolution-plan.md](../../docs/plans/platform-evolution-plan.md) §4.1 R3
