# Changelog

All notable changes to `@maverick/agentic-catalog-server` are recorded here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-09

Initial release. Capability catalog server — control-plane T2 foundation.
M2 C1 from the [v3 platform-evolution plan](../../docs/plans/platform-evolution-plan.md).
Design rationale in [ADR-015](../../docs/adr/0015-catalog-server-design.md).

### Added

- **Capability CRUD** — REST endpoints under `/v1/catalogs/{tenant}/capabilities`.
  List with filters (`kind` / `lifecycle` / `owner` / `tag` / free-text `q`) +
  pagination. Create / read / patch / soft-delete. UUID ids.
- **MFE remote registry** — `/v1/catalogs/{tenant}/mfes` for federation
  manifest entries. CRUD + health-record endpoint.
- **Multi-tenant RLS** — Postgres row-level security on every catalog table.
  Connection-scoped tenant variable (`app.tenant_id`) set per request.
  `BYPASSRLS` role for platform admins.
- **OIDC/JWT auth** — `JwtVerifier` with JWKS validation against any compliant
  OIDC provider (Auth0, Keycloak, Okta, Azure AD, etc.). `bearerAuth`
  middleware extracts principal; `requireTenantScope` middleware asserts
  path tenant matches JWT claim (or principal is `platform-admin`).
  Configurable tenant + roles claim names.
- **Append-only audit trail** — every mutation appends to `catalog_audit`
  inside the same transaction as the data write. Atomic by construction.
- **RFC 7807 errors** — `application/problem+json` responses with `type`,
  `title`, `status`, `detail`, `requestId`. Validation errors (422) include
  per-field `errors[]`.
- **Structured logging** — pino-based JSON logs. Request id propagation
  (honours incoming `X-Request-Id` or generates a fresh UUID). Authorization
  + cookie headers redacted.
- **Health probes** — `/healthz` (liveness, always 200 if process is up),
  `/readyz` (readiness, checks DB connectivity). Bypass auth.
- **OpenAPI 3.1 spec** — `/v1/openapi.json` documents the full public
  surface.
- **Graceful shutdown** — SIGTERM / SIGINT trigger drain + DB pool close
  with configurable grace period.
- **12-factor configuration** — every value loaded from environment;
  validated with Zod at startup; fails fast on invalid config.
- **Docker** — multi-stage `Dockerfile` with distroless `nodejs22-debian12:nonroot`
  final stage. ~80 MB image, no shell, non-root.
- **Migrations** — `node-pg-migrate` reads `src/db/migrations/*.sql`. Idempotent
  initial migration creates tenants + capabilities + mfe_remotes + catalog_audit
  with appropriate indexes, RLS policies, and an `updated_at` trigger.
- **60 unit + integration tests** — capability + MFE + audit repos against
  pg-mem (in-memory Postgres), JWT verifier against a tiny in-process JWKS
  server, route integration tests through the full Hono pipeline.

### Tech stack

- TypeScript + Node 22+
- Hono (HTTP framework)
- Postgres 14+ with RLS
- `jose` for JWT/JWKS
- `pino` for logging
- `zod` for runtime validation
- `vitest` + `pg-mem` for tests

### Out of scope (deferred)

- SSE endpoint for live federation updates → v0.2
- GraphQL gateway → v0.3+ (when client diversity justifies)
- Ops Console UI → M2 C6 (separate package)
- IAM service surface (role mapping editor UI) → M2 C3 expansion
- Integration tests against real Postgres + RLS — needs testcontainers harness;
  currently the operator's responsibility for production verification

### Related

- [ADR-015 — Catalog server design](../../docs/adr/0015-catalog-server-design.md)
- [ADR-014 — Governance hooks](../../docs/adr/0014-governance-hooks.md) — runtime
  side of the metadata fields this server persists
- [docs/plans/platform-evolution-plan.md](../../docs/plans/platform-evolution-plan.md)
  §10 M2 C1 — milestone this server lives under
