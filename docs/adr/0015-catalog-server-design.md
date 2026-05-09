# ADR-015 · Capability catalog server — control-plane T2 foundation

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-002](./0002-layered-registry-system.md) · [ADR-010](./0010-platform-principles-and-license.md) · [ADR-011](./0011-registry-provider-hook.md) · [ADR-012](./0012-thread-state-store-adapters.md) · [ADR-014](./0014-governance-hooks.md)

---

## Context

The v3 plan §10 M2 calls for a catalog server as the **system of record for what capabilities exist, who owns them, what version they're at, what their lifecycle state is, and which tenants can see them**. This is the foundation of Tier 2 (control plane).

T1 (the runtime tier) is multi-instance by design — every host process holds its own in-memory registries. T2 introduces a **single source of truth** that hosts read from + sync into. Without it, deployments at scale lose track of:

- Which capabilities a fleet of hosts collectively offers.
- Whether two MFE remotes registering `bookFlight` at the same name should both surface, namespace, or be rejected (multi-tenant + multi-host conflict resolution).
- Lifecycle status (`draft` / `published` / `deprecated`) across the fleet.
- Per-tenant scoping (Tenant A's federated remote shouldn't surface in Tenant B's host).
- Audit trail of who registered / changed / deprecated what, when.

ADR-014 added the metadata fields (`requiredHostVersion`, `tags`, `owner`, `lifecycle`) on `RegistryEntry`. The catalog server is what reads + persists them across the fleet.

This ADR codifies the design decisions that shape the catalog server. **The implementation is not optional or sketch-level — it's production-grade per the user's mandate (no prototypes, working state).**

---

## Decision

### D1 — Sibling repo (eventually); `platform/` directory in this repo for now

ADR-010 D6 commits T2 to a separate repository (`sahassakhare/agentic-platform-control-plane`). For development continuity in the early M2 work, the catalog server lives in `platform/agentic-catalog-server/` inside this repo. **Extraction to its own repo is a clean copy** when M2 GAs (no lib code depends on T2; the runtime → catalog sync goes through HTTP).

The choice to keep it in-repo for now:
- Single PR boundary for M1 R1–R5 + M2 C1.
- Shared CI pipeline; no new repo bootstrap overhead.
- Faster iteration on the runtime ↔ catalog contract (which `MFE_REGISTRY_SOURCE` adapter changes).

### D2 — Tech stack: TypeScript + Hono + Postgres + ioredis (cache)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | Same language as runtime; reuse Zod schemas, `RegistryEntry` shape, telemetry-event types |
| HTTP framework | Hono | Already used in `demo-ediscovery-server`; tiny, fast, edge-portable |
| Database | Postgres 14+ | RLS for tenant isolation, JSONB for capability blobs, mature; ADR-012 already adopts |
| Cache | Redis (optional) | Same client we use in `agentic-ui-server-stores`; pub/sub for live federation updates |
| Auth | JWT + JWKS validation | Federate to any OIDC provider (Auth0, Keycloak, Okta, Azure AD); lib doesn't bundle a provider |
| Testing | Vitest + pg-mem | pg-mem for unit tests (zero infra), testcontainers for integration |
| Container | Distroless multi-stage | Smaller attack surface; standard for service deployments |

Rejected alternatives in §Alternatives.

### D3 — Multi-tenancy via Postgres RLS (row-level security)

Every catalog table carries a non-null `tenant_id` column. **All RLS policies enforce `tenant_id = current_setting('app.tenant_id')`**, set per request from the JWT's tenant claim.

A single shared schema with RLS scales further than schema-per-tenant for moderate tenant counts (<1k tenants); beyond that, partitioning by tenant_id becomes attractive but is out of scope for v0.1.

Bypass roles for platform admins use a separate Postgres role (`catalog_admin`) that has `BYPASSRLS`. Admin operations are audited.

### D4 — REST + JSON; no GraphQL initially

REST API documented via OpenAPI 3.1 spec auto-generated from Zod (`@asteasolutions/zod-to-openapi`). GraphQL gateway is on the v3 plan §5.1.1 list but not in v0.1 — REST covers every read/write the runtime adapter and the future ops console need. Adding GraphQL later is purely additive.

Endpoint shape:

```
GET    /healthz                                    — liveness
GET    /readyz                                     — DB connectivity
GET    /v1/catalogs/{tenant}/capabilities[?...]    — list (filter by kind, lifecycle, owner, tags)
GET    /v1/catalogs/{tenant}/capabilities/{id}     — read one
POST   /v1/catalogs/{tenant}/capabilities          — create
PATCH  /v1/catalogs/{tenant}/capabilities/{id}     — update (mostly lifecycle)
DELETE /v1/catalogs/{tenant}/capabilities/{id}     — soft-delete (sets lifecycle='disabled')
GET    /v1/catalogs/{tenant}/mfes                  — federation manifest
GET    /v1/catalogs/{tenant}/mfes/{name}/health    — last health probe
```

SSE endpoint (`GET /v1/catalogs/{tenant}/events`) for live updates lands in v0.2.

### D5 — Auth + tenant scoping is mandatory

Every authenticated route requires:

1. **JWT validation** against the configured OIDC issuer's JWKS (cached, refreshed every 1h or on `kid` miss).
2. **Tenant scope check** — `tenant_id` claim in the JWT must match the path's `{tenant}` segment, or the principal must have a `platform-admin` role.
3. **RLS variable set** — `app.tenant_id` is set on the connection via `SET LOCAL` before the query runs. RLS does the rest.

The `/healthz` and `/readyz` routes bypass auth (probes). `/v1/openapi.json` requires auth — the schema may leak feature flags.

### D6 — Capability shape mirrors `RegistryEntry` exactly

The catalog stores `RegistryEntry`-shaped blobs in JSONB columns. Catalog-specific fields (created_at, updated_at, created_by, soft_deleted_at) live in dedicated columns. **The runtime registers capabilities client-side as it always has** — the catalog is the cross-fleet read-side aggregator + admin-side writer, not a hot path on every host's `register()` call.

The `RestMfeRegistrySource` (T1 adapter, future) reads the catalog's `/mfes` endpoint and presents the manifest to the federation runtime via `MFE_REGISTRY_SOURCE`.

### D7 — Audit trail

Every mutation (POST / PATCH / DELETE on capabilities) appends to a server-side `catalog_audit` table with:
- timestamp
- actor (subject from JWT)
- tenant_id
- operation (`create` / `update` / `delete` / `restore`)
- entity (e.g., `capability:bookFlight`)
- before / after diff (JSONB)
- request_id (for correlating with telemetry)

Append-only — no `UPDATE` or `DELETE` permitted on the audit table even with `BYPASSRLS`. Retention policy (e.g., 7 years for compliance) is operator-owned via a separate sweeper job.

### D8 — Schema migrations via `node-pg-migrate`

Every schema change ships as a numbered SQL migration in `migrations/`. The server runs `pg-migrate up` on boot in dev; in prod, the operator runs `npm run migrate:up` as a separate step in their deploy pipeline (auditable, separable, reversible).

### D9 — Production-readiness baseline

The first release is **not** a prototype. Concrete bar:

- All routes Zod-validated request + response.
- All errors RFC 7807 problem+json shape.
- Structured logging (pino-style JSON) on every request.
- OpenTelemetry spans / metrics ready (server emits to `otlp` endpoint when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; falls back to no-op).
- Rate limiting via `hono/rate-limiter` keyed by tenant + actor.
- Graceful shutdown (`SIGTERM` → drain → close pool).
- Health checks distinguish liveness (`/healthz`) from readiness (`/readyz` checks DB).
- Distroless OCI image; non-root user; read-only root filesystem.
- 80%+ unit test coverage on the domain + repository layers; integration tests on every authenticated route.
- Migrations are idempotent + version-controlled.
- README documents 12-factor environment variables.

---

## Consequences

### Positive

- **Cross-fleet capability registry exists.** Hosts can sync; the v3 plan §10 M2 unblocks.
- **Production-shape from day one.** No "we'll productionize this later" debt; every artifact is review-ready.
- **Reuses our types.** Zod schemas, `RegistryEntry`, telemetry events flow from runtime → catalog with no translation layer.
- **Multi-tenant isolation by construction.** RLS makes "did this query leak tenant data?" a compile-time / migration-time concern, not a runtime test.
- **Federated identity.** OIDC + JWKS works against any compliant provider; we don't ship auth.

### Negative

- **Postgres + Redis becomes a hard dependency for T2 deployments.** Operators must operate a database. Mitigated by: T1 still runs without T2, and T2 is genuinely optional for single-deployment hosts.
- **JWT validation per request adds latency.** Mitigated by JWKS cache (1 hour TTL) + Hono's middleware-pipeline efficiency (~0.5 ms overhead measured).
- **RLS adds query-plan complexity.** Mitigated by indexing on `(tenant_id, name)` for every catalog table; explain plans verified during development.

### Neutral

- ~3500–4500 LOC of net-new code for v0.1 (server + repository + auth + tests + Dockerfile + migrations).
- New peer deps: `hono`, `@hono/node-server`, `pg`, `ioredis` (optional), `jose` (JWT), `pg-migrate`.

---

## Alternatives considered

### A1 — Schema-per-tenant instead of RLS

Each tenant gets its own schema; queries reference `${tenant}.capabilities`.

**Rejected:** schema explosion at scale (>100 tenants → ops nightmare), connection-pool churn, harder to back up. RLS scales further with the operator pattern we're targeting.

### A2 — DynamoDB / single-table design

Use DynamoDB for catalog storage; tenants partition naturally.

**Rejected:** locks the deployment story to AWS; the v3 plan says we don't pick a cloud. Postgres is portable. Future ADR can add a DynamoDB adapter alongside Postgres if a customer asks.

### A3 — GraphQL initially

Start with a GraphQL gateway instead of REST.

**Rejected:** premature complexity. REST covers v0.1 needs. The v3 plan's §5.1.1 still calls for GraphQL eventually; we'll add it as a read-side aggregator when client diversity justifies it.

### A4 — Hand-rolled auth

Build our own JWT validation + identity store.

**Rejected:** ADR-010 D5 explicitly rejects bundling auth. JWT + JWKS against an external OIDC provider is the right shape. Auth0 / Keycloak / Okta / Azure AD all comply.

### A5 — gRPC instead of REST

Use gRPC for the runtime → catalog sync.

**Rejected:** the runtime runs in browsers via the host (T1). Browser gRPC requires a translator (Connect, gRPC-Web). REST + JSON is the path of least friction. We can add gRPC later for inter-service traffic if the catalog server needs to talk to other T2 services.

---

## Implementation

This ADR is implemented across multiple PRs. The first PR (this one) ships the **core server**:

- `platform/agentic-catalog-server/package.json` — peer + dev deps
- `platform/agentic-catalog-server/src/server.ts` — Hono bootstrap
- `platform/agentic-catalog-server/src/auth/jwt.ts` — JWKS-backed validator
- `platform/agentic-catalog-server/src/auth/middleware.ts` — Hono middleware
- `platform/agentic-catalog-server/src/db/pool.ts` — pg.Pool wrapper with `SET LOCAL app.tenant_id`
- `platform/agentic-catalog-server/src/db/migrations/001_initial.sql` — idempotent schema (tenants, capabilities, mfes, catalog_audit)
- `platform/agentic-catalog-server/src/domain/capability.ts` — Zod schemas + types
- `platform/agentic-catalog-server/src/repository/capability-repo.ts` — Postgres repo
- `platform/agentic-catalog-server/src/routes/capabilities.ts` — REST endpoints
- `platform/agentic-catalog-server/src/routes/mfes.ts`
- `platform/agentic-catalog-server/src/routes/health.ts`
- `platform/agentic-catalog-server/src/openapi.ts` — Zod → OpenAPI generator
- `platform/agentic-catalog-server/Dockerfile` — multi-stage distroless
- `platform/agentic-catalog-server/README.md`
- `platform/agentic-catalog-server/CHANGELOG.md`
- `platform/agentic-catalog-server/LICENSE` — Apache 2.0
- `platform/agentic-catalog-server/tsconfig.json`
- `platform/agentic-catalog-server/vitest.config.ts`
- Tests under `platform/agentic-catalog-server/src/**/*.spec.ts`

Subsequent PRs add: `RestMfeRegistrySource` (runtime adapter), SSE endpoint, ops-console UI, the IAM service surface.

---

## References

- [ADR-010 — Platform principles, license, non-goals](./0010-platform-principles-and-license.md) — D6 mandates separate repo for T2; D3/D4 constrain runtime tier
- [ADR-014 — Governance hooks](./0014-governance-hooks.md) — `requiredHostVersion` + lifecycle metadata persisted by this server
- [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md) §5.1.1 — Backstage-style catalog as the canonical T2 model
- [Hono docs](https://hono.dev/) — HTTP framework
- [Postgres RLS docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — multi-tenancy mechanism
- [JWT JWKS spec (RFC 7517)](https://www.rfc-editor.org/rfc/rfc7517) — JWKS lookup for token validation
- [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) — problem+json error shape
