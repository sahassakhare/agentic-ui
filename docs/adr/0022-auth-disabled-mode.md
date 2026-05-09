# ADR-022 · `AUTH_MODE=disabled` — escape hatch for demo deployments

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-015](./0015-catalog-server-design.md) · [ADR-016](./0016-iam-role-mapping.md) · [ADR-019](./0019-ops-console-design.md) · [ADR-020](./0020-tenant-lifecycle.md) · [ADR-021](./0021-self-managed-packaging.md)

---

## Context

The catalog server requires a real OIDC provider out of the box.
That's the right default — the alternative is a security hole in
production. But it has a sharp edge: every adopter who wants to
**try** the platform has to spin up Auth0 / Keycloak / Clerk first,
and that's a 30-minute detour before the demo even starts.

Concrete pain:

1. **Render demo deploys.** Render is a popular one-click target.
   Adopters paste the repo URL, hit deploy, and… get 401s
   everywhere because there's no IdP.
2. **Internal-network deployments.** Some operators run on a
   trusted VPN with network-ACL boundaries doing the trust work.
   Layering OIDC on top is belt-and-braces but adds operational
   complexity without changing the threat model.
3. **First-day exploration.** A senior engineer evaluating the
   platform shouldn't need to integrate an IdP just to see what
   the API surface looks like.

This ADR codifies an opt-in escape hatch that addresses these
three cases without weakening the production path.

---

## Decision

### D1 — `AUTH_MODE` env var, default `'oidc'`

The catalog server reads `AUTH_MODE` from the environment. Two
values:

- **`'oidc'`** (default) — every request must carry a JWT validated
  against `OIDC_ISSUER`'s JWKS. The behaviour from v0.1.
- **`'disabled'`** — every request is admitted without
  authentication. The middleware synthesises a platform-admin
  principal scoped to the URL path's tenant.

Defaulting to `'oidc'` means an operator who deploys without
reading the docs gets the secure shape. Opting in to `'disabled'`
requires an explicit `AUTH_MODE=disabled` env var — there's no
config file or implicit "if no IDP set, disable auth" inference.

### D2 — Synthetic principal: platform-admin, tenant from URL

When auth is disabled, the bearerAuth middleware constructs:

```ts
{
  subject: 'anonymous',
  tenantId: <parsed from /v1/catalogs/{tenant}/...>,
  roles: ['platform-admin'],
  displayName: 'anonymous (auth disabled)',
  issuer: 'auth-disabled',
}
```

`subject = 'anonymous'` deliberately — the audit trail records the
trust boundary. Anyone reviewing audit history sees
`actor = 'anonymous@auth-disabled'` and immediately knows the row
came from a no-auth deployment.

`roles = ['platform-admin']` because the privilege guards in the
route handlers (`ensureNotEscalating`, `ensurePlatformAdmin`) all
key on this role. Synthesising platform-admin keeps the route
handlers untouched between modes.

`tenantId` comes from the URL path, parsed via regex from
`c.req.path` (NOT `c.req.param('tenant')` — Hono binds path
params after middleware runs, so the param accessor is undefined
at bearerAuth time). For platform routes (`/v1/tenants/*`) the
tenantId falls back to the sentinel `_anonymous`, which is fine
because those routes don't FK against the tenants table.

### D3 — Loud signalling: startup log + healthz reports authMode

When `AUTH_MODE=disabled`, the server logs at startup:

```
WARN: AUTH_MODE=disabled — JWT verification is OFF. Every request
is treated as platform-admin. Demo / trusted-network only. See
ADR-022.
```

`/healthz` returns `{"status":"ok","authMode":"disabled"}`. External
uptime / monitoring tools (Pingdom, Updown, Datadog HTTP checks)
that already poll `/healthz` immediately see the trust mode. An
operator who set up a deployment three months ago and forgot can
spot it from monitoring.

The ops console mirrors this — when it's built with
`environment.authMode === 'disabled'`, the shell shows an
**AUTH_MODE=disabled** banner on every page and the login screen
explains the trade-off.

### D4 — Two Dockerfiles per service

The production `Dockerfile` for the catalog uses
`gcr.io/distroless/nodejs22-debian12:nonroot` (no shell, ~80 MB,
strict attack surface). The Render blueprint uses
`Dockerfile.render` (node-bookworm-slim with a shell, ~150 MB)
because Render's `preDeployCommand` invokes through `/bin/sh -c`
and distroless has no shell.

This is a deliberate split:

- **Production deployments** (Helm, docker-compose) keep the
  strict distroless image.
- **Demo deployments** (Render) get the slightly larger
  shell-bearing image so migrations Just Work without operators
  needing to drop into Render's web shell to run them manually.

The same logic applies to the ops console: `Dockerfile` builds
with `authMode: 'oidc'`; `Dockerfile.render` patches the
environment file to `authMode: 'disabled'` before the Angular
build.

### D5 — Ops console mode is build-time

`environment.authMode` is a TypeScript constant, baked into the
bundle at compile time. There is no runtime toggle. Reasons:

- **Bundle determinism.** Operators inspecting the bundle see
  exactly which mode it was built with — no guessing about
  whether a runtime override fired.
- **Smaller surface area.** Runtime mode-switching would require
  fetching config from the catalog at boot, then re-rendering
  the login screen. That's complexity for an opt-in escape
  hatch.
- **Match the Dockerfile split.** Each Render image is built once
  with the right mode; production images stay strict.

Trade-off: operators who want to flip modes need to rebuild the
console. Acceptable for a config that's tied to *whether the
catalog has auth at all*; that's not a switch you flip casually.

### D6 — Tenant id is the only client-side input in disabled mode

The disabled-mode login screen accepts a tenant id (matching
`[a-zA-Z0-9_.-]+`, the same regex as
[ADR-020](./0020-tenant-lifecycle.md) §D2). The console
synthesises a principal client-side; the catalog admits the
request without auth.

Operators switch tenants any time via the sidebar's tenant
switcher — same input, persisted in localStorage, triggers a
route refresh so the open page re-fetches against the new
tenant.

No other identity inputs. No "anonymous user name" field, no
roles toggle. Keeping the input surface tiny means the disabled
mode isn't *almost* an auth system — it's an explicit absence
of auth.

### D7 — Pre-existing tests run unchanged

The 141 tests written before this ADR all assume `AUTH_MODE=oidc`
and use the JWT-minting `buildIntegrationHarness`. They still
pass — the change is purely additive. A separate
`buildDisabledAuthHarness` covers the new path.

---

## Consequences

### Positive

- **One-click Render demos work.** Adopters explore the platform
  in 5 minutes instead of 30.
- **Internal-network deployments don't pay OIDC tax.** Operators
  on locked-down networks can use ACLs as the trust boundary.
- **Production stays strict.** The default is still OIDC; nothing
  about the v0.1 production path changed.
- **Audit trail honest.** Every row written under disabled auth
  carries `actor = 'anonymous@auth-disabled'`. A compliance review
  surfaces them immediately.
- **Monitoring honest.** `/healthz` reports `authMode`; uptime
  checkers learn about accidental disabled-auth deployments
  before someone notices the bill.

### Negative / risks

- **Footgun by design.** Operators who set
  `AUTH_MODE=disabled` and put the URL on the public internet
  hand admin access to every passer-by. Mitigated by:
  loud-startup-log, banner-everywhere, healthz-tells-the-truth,
  README-screams-DEMO-ONLY. Not mitigated by: refusing to start
  unless the env says "I really mean it" — that would defeat
  the one-click value.
- **Two Dockerfiles per service.** Drift risk over time. Mitigated
  by keeping the `.render` files diff-minimal against the
  defaults; if drift becomes painful we'll generate them from a
  single template.
- **No partial-trust mode.** Either full OIDC or no auth. Hosts
  who want "anyone can read, only admins can write" need an
  upstream gateway that does the gating; this isn't it.
- **Audit-actor uniqueness lost.** All disabled-mode writes share
  `actor = 'anonymous@auth-disabled'`. Operators who want
  attribution beyond that need OIDC.

### Out of scope (deferred)

- **Static-token mode.** A pre-shared key option in addition to
  OIDC + disabled. Useful for service-to-service traffic.
  Deferred until concrete demand — the current options are wide
  enough.
- **Read-only disabled mode.** Disabled auth that admits GETs but
  rejects mutations. Useful for "show off the API but don't let
  anyone modify state" demos. Considered; the simpler mental
  model of "fully on or fully off" wins for v0.1.
- **Telemetry on disabled-mode deployments.** Anonymous beacon
  pings home with "this deployment is in disabled mode" so we
  can size adoption. Defer; privacy implications.

---

## Implementation summary

### Catalog server

- `src/config.ts` — `AUTH_MODE` Zod field; cross-field validator
  ensures OIDC fields exist when `AUTH_MODE=oidc`.
- `src/auth/middleware.ts` — `bearerAuth(verifier, { disabled })`
  optional second arg; `extractPathTenant()` regex parser; new
  `anonymousPrincipal()` builder.
- `src/app.ts` — `authMode` plumbed through `AppDeps`; startup
  warning when disabled; verifier optional when disabled.
- `src/server.ts` — wires `config.AUTH_MODE` into `buildApp`.
- `src/routes/health.ts` — `/healthz` + `/readyz` echo
  `authMode` so monitoring can flag accidental disabled
  deployments.
- `src/test-helpers/integration.ts` — new
  `buildDisabledAuthHarness()` for tests.
- `src/auth/middleware.spec.ts` — 7 tests covering admit-without-
  auth, URL-path tenant scope, platform-admin synthesis, audit-
  actor stamping, healthz reporting, Zod still firing on bad
  input.
- `Dockerfile.render` — slim base image (shell-bearing) for
  Render's preDeployCommand to work.

### Ops console

- `src/environments/environment.ts` + `.prod.ts` — `authMode`
  field added.
- `src/app/services/auth.service.ts` — disabled-mode branch
  synthesises a platform-admin principal from a tenant-id
  signal stored in localStorage.
- `src/app/pages/login.component.ts` — forks UI on `authMode`:
  tenant-id input vs. JWT paste-in.
- `src/app/components/shell.component.ts` — tenant switcher
  in the sidebar footer, AUTH_MODE=disabled banner.
- `Dockerfile.render` — patches `environment.prod.ts` to flip
  `authMode` to `'disabled'` before `ng build`.

### Render blueprint

- `platform/render.yaml` — Postgres + catalog + ops-console.
  Catalog uses `AUTH_MODE=disabled`; ops-console image is the
  `Dockerfile.render` variant; `preDeployCommand` runs migrations
  via `node-pg-migrate up`.
- `platform/RENDER.md` — operator-facing how-to; mode-by-mode
  table of which Dockerfile is used where; production guidance.

### Tests

- 7 new disabled-auth tests; all 147 previous catalog tests
  unchanged.
- 19 ops-console tests still pass with `authMode='oidc'` default.
