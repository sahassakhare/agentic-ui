# Changelog

All notable changes to `@maverick/agentic-catalog-server` are recorded here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

M2 C3 + M3 (audit chain + usage meter) + M4 C7 (tenant lifecycle) +
M2 C9 (self-managed packaging) + AUTH_MODE escape hatch + SSE stream.
Design rationale in
[ADR-016](../../docs/adr/0016-iam-role-mapping.md),
[ADR-017](../../docs/adr/0017-audit-chain.md),
[ADR-018](../../docs/adr/0018-usage-meter.md),
[ADR-020](../../docs/adr/0020-tenant-lifecycle.md),
[ADR-021](../../docs/adr/0021-self-managed-packaging.md),
[ADR-022](../../docs/adr/0022-auth-disabled-mode.md),
[ADR-027](../../docs/adr/0027-catalog-sse-stream.md).

### Added (catalog SSE — ADR-027)

- **`GET /v1/catalogs/{tenant}/stream`** Server-Sent Events endpoint.
  Long-lived connection; `event: open` first, `event: mutation`
  per catalog write, `event: ping` every 25s as heartbeat. Per-
  tenant filtering at the route handler.
- **`CatalogEventBus`** in-process EventEmitter. Every mutation
  route (capabilities, mfes, role-mappings, tenants, usage) calls
  `catalogBus.emit(...)` after the write. Payload is a minimal
  hint (`kind`, `name`, etc.) — not the full row.
- **9 new tests.** Single-replica scope; multi-replica via
  Postgres `LISTEN/NOTIFY` is the documented next slice.

### Added (AUTH_MODE escape hatch)

- **`AUTH_MODE` env var** (`oidc` default | `disabled`). When
  disabled, the bearerAuth middleware admits unauthenticated
  requests and synthesises a platform-admin principal scoped to
  the URL path's tenant. Demo / trusted-network only — see
  [ADR-022](../../docs/adr/0022-auth-disabled-mode.md).
- **Loud signalling** when disabled: startup warning log;
  `/healthz` + `/readyz` echo `authMode` so monitoring can flag
  accidental deployments.
- **Audit-actor stamp** — every row written under disabled auth
  carries `actor = 'anonymous@auth-disabled'` so compliance
  reviews see them immediately.
- **`Dockerfile.render`** — shell-bearing slim image for Render's
  preDeployCommand compatibility (production keeps the strict
  distroless `Dockerfile`).
- **7 new tests** covering admit-without-auth, URL-path tenant
  scope, platform-admin synthesis, audit-actor, healthz mode
  reporting, and Zod still firing on bad input.

### Added (M2 C9 — self-managed packaging)

- **`platform/docker-compose.yml`** — one-command local stack
  (Postgres + dev-JWKS + catalog + ops-console + auto-migrations).
- **`platform/helm/agentic-platform/`** — Helm chart for production
  k8s deployment. Catalog Deployment + Service + Ingress;
  ops-console Deployment + Service + Ingress; bundled Postgres
  StatefulSet (opt-out for prod); migrations Job as
  pre-install/pre-upgrade hook. `helm lint` + `helm template`
  clean for both bundled-PG and external-PG modes.
- **Ops-console Dockerfile** — `nginx:1.27-alpine` serving the
  Angular SPA bundle, with envsubst-able config that
  reverse-proxies `/v1/*` to the catalog. ~30 MB image.
- **Local-dev fixture** — `platform/local-dev/mint-dev-key.mjs`
  + `mint-token.mjs` for OIDC-compliant JWT minting against the
  dev-JWKS container without weakening catalog auth.
- **Production hardening checklist** in `platform/helm/.../README.md`
  (external Postgres, BYPASSRLS role, TLS, audit retention,
  network policy, resource tuning).

### Added (M4 C7 — tenant lifecycle)

- **`/v1/tenants` platform-admin API.** List / create / read / patch /
  suspend / activate / soft-delete. Tenant id is immutable; status
  transitions go through dedicated `/suspend` (with reason) +
  `/activate` endpoints so the audit chain captures actor + reason.
- **Per-tenant quotas.** New `quotas` JSONB column carries
  operator-set policy (`monthlyTokens`, `monthlyToolInvocations`,
  `maxCapabilities`, `maxMfeRemotes`). Recorded but **not enforced**
  by the catalog — hosts read these and apply policy at the runtime
  / gateway boundary.
- **Soft-delete preserves audit history.** `DELETE /v1/tenants/:id`
  flips `status='deleted'` and stamps `deleted_at` rather than
  cascading; tenant-scoped data sits in place during the retention
  window. True purges remain a documented psql operation.
- **Audit rows scoped to the affected tenant.** Every tenant mutation
  writes to `catalog_audit` under the affected tenant's id, so per-
  tenant audit queries surface lifecycle events alongside capability
  changes.
- **Migration** — `005_tenant_lifecycle.sql` extends `tenants` with
  `quotas`, `onboarded_by`, `onboarded_at`, `suspended_*`, `deleted_at`.
- **OpenAPI** — 5 new path entries + 4 new schemas (`Tenant`,
  `TenantCreate`, `TenantUpdate`, `TenantSuspend`).
- **22 new tests** — 10 repo + 12 routes integration.

### Added (M3 — audit chain + usage meter)

- **Hash-linked audit chain.** New columns on `catalog_audit`:
  `chain_position`, `prev_hash`, `entry_hash`. Each row's hash is
  `sha256(prev_hash || canonical_row)`; the chain is per-tenant
  with a fixed genesis sentinel for the first row. Tampering with
  any auditable field breaks the chain at that position. See
  [ADR-017](../../docs/adr/0017-audit-chain.md).
- **`GET /v1/catalogs/{tenant}/audit/export`** — JSONL stream of
  audit rows, suitable for SIEM ingest (Splunk, Datadog, ELK).
  Per-line shape includes the chain columns so external verifiers
  can re-walk without DB access.
- **`GET /v1/catalogs/{tenant}/audit/verify`** — server-side
  chain re-walk. Returns `{valid, checkedRows, chainHead, brokenAt}`;
  ops dashboards page oncall on `brokenAt != null`.
- **Per-tenant usage meter.** New `usage_events` table.
  `POST /v1/catalogs/{tenant}/usage` appends, with optional
  `idempotencyKey` for safe retry. `GET /usage` aggregates by
  `kind` over `?from&to&kind`. `GET /usage/recent` returns the
  newest N events. Catalog stores units only (pricing is a host
  concern). See [ADR-018](../../docs/adr/0018-usage-meter.md).
- **Migrations** — `003_audit_chain.sql`, `004_usage_meter.sql`.
- **OpenAPI** — six new path entries + five new schemas
  (`AuditRow`, `AuditVerifyResult`, `UsageEvent`, `UsageEventCreate`,
  `UsageAggregate`).
- **29 new tests** — 7 audit-chain repo + 5 audit-routes integration
  + 7 usage repo + 10 usage routes integration.

### Added (M2 C3 — IAM role mapping)

- **Role mapping CRUD** — REST endpoints under
  `/v1/catalogs/{tenant}/role-mappings` (list / read / create / patch /
  delete). Per-tenant, RLS-isolated.
- **Persona resolution endpoint** —
  `POST /v1/catalogs/{tenant}/role-mappings/resolve` accepts a claim path
  + a list of claim values (typically the JWT `groups` array) and returns
  the highest-priority enabled mapping. Ties broken deterministically by
  `created_at ASC`. Returns `runtimePersona = null` when no mapping
  matches; hosts decide on a fallback.
- **Privilege-escalation guard** — mappings whose `runtimePersona` is in
  the configured *protected* set (default `platform-admin`,
  `lead-counsel`; CSV-overridable via `CATALOG_PROTECTED_PERSONAS` env)
  may only be created or patched by callers holding the `platform-admin`
  role. Prevents tenant admins from promoting their own users to
  privileged personas by editing the mapping table.
- **Audit trail** — every create / update / delete on `role_mappings`
  appends to `catalog_audit` in the same transaction.
- **Migration** — `002_role_mappings.sql` creates the table with
  `(tenant_id, claim_path, claim_value)` unique constraint, priority +
  enabled indices, RLS policy + ownership trigger, and `BYPASSRLS` for
  the platform-admin role.
- **OpenAPI** — `/v1/openapi.json` updated with `RoleMapping`,
  `RoleMappingCreate`, `RoleMappingUpdate`, `ResolveRequest`,
  `ResolveResponse` schemas and the four new path entries.
- **29 new tests** — repository unit tests against pg-mem (14) +
  routes integration tests through the full pipeline (15) covering
  auth, tenant scope, escalation guard, resolution semantics, and
  audit propagation.

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
