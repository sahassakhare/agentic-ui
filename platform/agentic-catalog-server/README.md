# @maverick/agentic-catalog-server

**Capability catalog server — control-plane T2 foundation.** Multi-tenant capability registry, federated identity (OIDC + JWT), audit trail, RFC 7807 error responses. Apache 2.0.

This is the system of record for **what capabilities exist, who owns them, what version they're at, what their lifecycle state is, and which tenants can see them**. The runtime tier (`@maverick/agentic-ui`) consumes it via `MFE_REGISTRY_SOURCE` adapters; ops consoles consume it via REST. See [ADR-015](../../docs/adr/0015-catalog-server-design.md) for the design rationale.

> **Heads up:** this package will be extracted to its own repo (`sahassakhare/agentic-platform-control-plane`) when M2 GAs, per [ADR-010](../../docs/adr/0010-platform-principles-and-license.md) D6. Until then, it lives inside the runtime monorepo so M1 R1–R5 + M2 C1 work ships in one PR boundary.

---

## Status

**M2 C1 + C3 + M3 C4/C5 + M4 C7 — catalog + IAM + audit chain + usage meter + tenant lifecycle.** v0.1.0 + Unreleased:

- Capability CRUD (REST) with soft-delete + lifecycle states
- MFE remote registry CRUD + health-record endpoint
- IAM role-mapping CRUD + persona resolution (`POST /role-mappings/resolve`)
  with privilege-escalation guard on protected personas
- **Hash-linked audit chain** — tamper-evident `catalog_audit`;
  `GET /audit/export` (JSONL) + `GET /audit/verify`
- **Usage meter** — `POST /usage` (idempotent), `GET /usage`
  (aggregate by kind over a window), `GET /usage/recent`
- **Tenant lifecycle** — `/v1/tenants/*` (platform-admin only):
  onboard / patch / suspend (with reason) / activate / soft-delete
- OIDC/JWT auth with tenant-scope guard + platform-admin override
- Postgres + RLS multi-tenancy (every read/write scoped to `current_setting('app.tenant_id')`)
- Append-only audit trail (now hash-linked)
- RFC 7807 error responses (`application/problem+json`)
- Structured logging (pino) + request id propagation
- Health probes (`/healthz` liveness, `/readyz` DB connectivity)
- OpenAPI 3.1 spec at `/v1/openapi.json`
- Graceful shutdown on SIGTERM/SIGINT
- Multi-stage distroless Docker image
- 140 unit + integration tests

Subsequent slices (NOT in this branch yet):

- SSE endpoint for live federation updates → v0.2
- GraphQL gateway → v0.3 (when client diversity justifies)
- Ops Console UI (separate package) → M2 C6
- Sigstore / external chain anchoring → M5 (alongside SOC 2 Type II)

---

## Quick start

### Local development

```bash
# 1. Spin up Postgres
docker run --rm -d --name catalog-pg -p 5432:5432 \
  -e POSTGRES_USER=catalog -e POSTGRES_PASSWORD=catalog \
  -e POSTGRES_DB=catalog postgres:16

# 2. Configure (copy + edit)
cp .env.example .env
# Edit OIDC_ISSUER + OIDC_AUDIENCE; for local dev with no real IdP,
# point OIDC_ISSUER at a local Keycloak / WorkOS dev / Auth0 free tier.

# 3. Install + run migrations + start
npm install
npm run migrate:up    # applies src/db/migrations/*.sql
npm run dev           # tsx-watch, hot reload
```

The server listens on `:8080` by default. Hit `/healthz` to confirm it's alive; `/v1/openapi.json` to see the API surface.

### Docker

```bash
docker build -t agentic-catalog-server:0.1.0 .

docker run --rm -p 8080:8080 \
  -e DATABASE_URL=postgres://catalog:catalog@host.docker.internal:5432/catalog \
  -e OIDC_ISSUER=https://your-idp.example.com \
  -e OIDC_AUDIENCE=agentic-catalog \
  agentic-catalog-server:0.1.0
```

The image is multi-stage distroless (~80 MB final), non-root user, no shell — minimal attack surface.

---

## Configuration

Every value documented in [`.env.example`](./.env.example). Validated with Zod at startup; invalid config fails fast with a clear error.

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `8080` | |
| `HOST` | no | `0.0.0.0` | |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `DATABASE_POOL_MAX` | no | `10` | |
| `DATABASE_IDLE_MS` | no | `30000` | |
| `DATABASE_STATEMENT_TIMEOUT_MS` | no | `5000` | |
| `AUTH_MODE` | no | `oidc` | `oidc` requires JWTs; `disabled` skips all auth (demo / trusted-network only — see [ADR-022](../../docs/adr/0022-auth-disabled-mode.md)) |
| `OIDC_ISSUER` | **yes** when `AUTH_MODE=oidc` | — | URL of your OIDC provider |
| `OIDC_AUDIENCE` | **yes** when `AUTH_MODE=oidc` | — | `aud` claim required on every JWT |
| `OIDC_JWKS_URI` | no | `${OIDC_ISSUER}/.well-known/jwks.json` | |
| `OIDC_TENANT_CLAIM` | no | `tenant_id` | JWT claim that carries the tenant id |
| `OIDC_ROLES_CLAIM` | no | `roles` | JWT claim that carries the role list |
| `LOG_LEVEL` | no | `info` | trace/debug/info/warn/error/fatal |
| `LOG_FORMAT` | no | `json` | json/pretty (pretty for dev only) |
| `SHUTDOWN_GRACE_MS` | no | `15000` | Drain timeout on SIGTERM |

---

## Authentication

Every authenticated route requires a Bearer JWT. The token must:

1. Be signed by a key advertised in the configured OIDC provider's JWKS.
2. Include `iss` matching `OIDC_ISSUER`.
3. Include `aud` matching `OIDC_AUDIENCE`.
4. Include the configured tenant claim (default: `tenant_id`).
5. Optionally include a roles claim (default: `roles`) — used to grant `platform-admin` and other elevated rights.

Tokens are validated with the [`jose`](https://github.com/panva/jose) library. JWKS are cached for 10 minutes and refreshed on `kid` miss; clock skew tolerance is 60 seconds.

### Example mint with Auth0

```js
// In your Auth0 rule / action:
api.idToken.setCustomClaim('tenant_id', user.app_metadata.tenant_id);
api.idToken.setCustomClaim('roles', user.app_metadata.roles ?? []);
```

### Tenant scope guard

Every `/v1/catalogs/{tenant}/...` route asserts `path.tenant === jwt.tenant_id` unless the principal has the `platform-admin` role. Cross-tenant operations are platform-admin only and audited.

---

## API surface

REST + JSON. Full OpenAPI 3.1 spec at `/v1/openapi.json`.

### Health (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Liveness — process is up |
| GET | `/readyz` | Readiness — DB reachable |

### Capabilities (auth + tenant scope)

| Method | Path | Purpose |
|---|---|---|
| GET    | `/v1/catalogs/{tenant}/capabilities` | List, filter by `kind` / `lifecycle` / `owner` / `tag` / free-text `q`; paginated |
| GET    | `/v1/catalogs/{tenant}/capabilities/{id}` | Read one |
| POST   | `/v1/catalogs/{tenant}/capabilities` | Create |
| PATCH  | `/v1/catalogs/{tenant}/capabilities/{id}` | Update lifecycle / body / metadata |
| DELETE | `/v1/catalogs/{tenant}/capabilities/{id}` | Soft-delete (sets `lifecycle='disabled'`) |

### MFE remotes (auth + tenant scope)

| Method | Path | Purpose |
|---|---|---|
| GET    | `/v1/catalogs/{tenant}/mfes` | List federation manifest entries |
| GET    | `/v1/catalogs/{tenant}/mfes/{name}` | Read one |
| POST   | `/v1/catalogs/{tenant}/mfes` | Register a new remote |
| PATCH  | `/v1/catalogs/{tenant}/mfes/{name}` | Update fields |
| DELETE | `/v1/catalogs/{tenant}/mfes/{name}` | Hard-delete (federation-manifest entries don't carry historical value) |
| POST   | `/v1/catalogs/{tenant}/mfes/{name}/health` | Record a health probe result |

### Role mappings (auth + tenant scope)

| Method | Path | Purpose |
|---|---|---|
| GET    | `/v1/catalogs/{tenant}/role-mappings` | List mappings (priority DESC, created_at ASC) |
| GET    | `/v1/catalogs/{tenant}/role-mappings/{id}` | Read one |
| POST   | `/v1/catalogs/{tenant}/role-mappings` | Create — protected personas require `platform-admin` role |
| PATCH  | `/v1/catalogs/{tenant}/role-mappings/{id}` | Update — escalation to a protected persona requires `platform-admin` |
| DELETE | `/v1/catalogs/{tenant}/role-mappings/{id}` | Delete |
| POST   | `/v1/catalogs/{tenant}/role-mappings/resolve` | Resolve claim values to a runtime persona (hot-path; runtime adapter calls this on login + persona refresh) |

The protected-persona set is `platform-admin`, `lead-counsel` by default;
extend via the `CATALOG_PROTECTED_PERSONAS` env var (CSV). Design rationale
in [ADR-016](../../docs/adr/0016-iam-role-mapping.md).

### Tenants (auth, **platform-admin only**)

| Method | Path | Purpose |
|---|---|---|
| GET    | `/v1/tenants` | List all tenants. `?includeDeleted=true` includes soft-deleted. |
| GET    | `/v1/tenants/{id}` | Read one |
| POST   | `/v1/tenants` | Onboard a new tenant. Tenant id is immutable. |
| PATCH  | `/v1/tenants/{id}` | Update displayName + quotas. |
| POST   | `/v1/tenants/{id}/suspend` | Suspend with `reason` (required) |
| POST   | `/v1/tenants/{id}/activate` | Resume a suspended tenant |
| DELETE | `/v1/tenants/{id}` | Soft-delete (data retained; purges via psql) |

Quotas are recorded but **not enforced** by the catalog — hosts read
them and apply policy at the runtime / gateway boundary. Design
rationale in [ADR-020](../../docs/adr/0020-tenant-lifecycle.md).

### Audit (auth + tenant scope)

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/catalogs/{tenant}/audit/export` | JSONL stream of audit rows (one per line). Optional `?from=ISO&to=ISO&limit=N`. SIEM-friendly. |
| GET | `/v1/catalogs/{tenant}/audit/verify` | Server-side chain re-walk; returns `{valid, checkedRows, chainHead, brokenAt}`. |

Every catalog mutation appends a hash-linked entry to `catalog_audit`.
External verifiers can re-derive `entry_hash` from the JSONL export
without DB access. Design rationale in [ADR-017](../../docs/adr/0017-audit-chain.md).

### Usage (auth + tenant scope)

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/catalogs/{tenant}/usage` | Append a usage event. Optional `idempotencyKey` for safe retry. |
| GET  | `/v1/catalogs/{tenant}/usage` | Aggregate `quantity` per `kind` over `?from&to&kind`. |
| GET  | `/v1/catalogs/{tenant}/usage/recent` | Newest N events for ops debugging (`?limit` 1–1000). |

Stores units, not currency — pricing is a host concern. Design rationale
in [ADR-018](../../docs/adr/0018-usage-meter.md).

### Errors

Every non-2xx response is RFC 7807 `application/problem+json`:

```json
{
  "type": "https://github.com/sahassakhare/agentic-ui/blob/main/platform/agentic-catalog-server/docs/problems/forbidden.md",
  "title": "Forbidden",
  "status": 403,
  "detail": "Tenant scope mismatch: token issued for tenant \"acme\", path requested \"zeta\"",
  "requestId": "8c4d5e6f-..."
}
```

Validation errors (422) include an `errors[]` array of `{path, message}`.

---

## Database schema

Five primary tables + one append-only audit:

- `tenants` — tenant directory
- `capabilities` — RLS-isolated capability blobs
- `mfe_remotes` — RLS-isolated federation manifest entries
- `role_mappings` — RLS-isolated IdP-claim → runtime-persona mappings
- `usage_events` — RLS-isolated per-tenant consumption stream (units, not currency)
- `catalog_audit` — append-only, hash-linked audit log

Every read/write goes through `withTenantScope(pool, principal, fn)` which (a) opens a transaction, (b) sets `app.tenant_id` to the principal's tenant, (c) runs the callback. RLS policies on every catalog table enforce `tenant_id = current_setting('app.tenant_id')`. Bypass is via the `BYPASSRLS` Postgres role (assign to platform-admin connections only).

Migrations live in [`src/db/migrations/`](./src/db/migrations/). Apply with `npm run migrate:up` (uses `node-pg-migrate`).

---

## Development

### Run tests

```bash
npm test          # one-shot
npm run test:watch
```

Tests use `pg-mem` for in-memory Postgres + a tiny JWKS HTTP server for JWT minting — no Docker needed for unit / integration tests. The `pg-mem` adapter does not implement RLS; integration tests against real Postgres + RLS are run via testcontainers in a separate harness (added in M2 C2 — currently the operator's responsibility for production verification).

### Build

```bash
npm run build     # tsc -p tsconfig.json
```

### Migrations

```bash
npm run migrate:up        # apply all pending migrations
npm run migrate:down      # roll back the last applied
```

Add a new migration: `src/db/migrations/00<N>_<short_name>.sql` with `-- Up Migration` / `-- Down Migration` sections.

---

## Observability

The server emits structured pino logs to stdout. Every request gets a log line with `requestId`, `method`, `path`, `status`, `durationMs`. Authorization headers + cookies are redacted automatically.

OpenTelemetry spans + metrics integration is on the v0.2 roadmap; until then, hosts wrap requests with their preferred OTel SDK at the load-balancer / sidecar layer.

---

## Production checklist

Before deploying:

- [ ] `DATABASE_URL` points at a managed Postgres with backups + point-in-time recovery
- [ ] OIDC_ISSUER + OIDC_AUDIENCE configured against your real IdP
- [ ] Migrations applied via your CI / deploy pipeline (NOT auto-on-boot in production)
- [ ] `LOG_FORMAT=json` (default; `pretty` is for local dev only)
- [ ] Liveness probe → `/healthz`, readiness probe → `/readyz`, with appropriate failure thresholds
- [ ] Network policy: only the load balancer can reach `:8080`; only the catalog server can reach `:5432`
- [ ] `BYPASSRLS` Postgres role is granted only to a platform-admin connection string used by ops tooling
- [ ] CORS_ORIGINS pinned to your ops console hostname (rather than the default `*`)
- [ ] Audit retention policy + sweeper job in place
- [ ] OpenTelemetry collector wired (or your equivalent observability pipeline)

See [ADR-015](../../docs/adr/0015-catalog-server-design.md) §D9 for the production-readiness baseline.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE).
