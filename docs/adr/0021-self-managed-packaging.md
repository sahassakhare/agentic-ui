# ADR-021 · Self-managed packaging — docker-compose + Helm

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-010](./0010-platform-principles-and-license.md) · [ADR-015](./0015-catalog-server-design.md) · [ADR-019](./0019-ops-console-design.md) · [ADR-020](./0020-tenant-lifecycle.md)

---

## Context

Plan v3 §10 calls for self-managed packaging as M2 C9: "operators can
take the OSS, install it on their own infra, and run it without our
help." The platform now has enough surface (catalog API, ops console,
audit chain, usage meter, tenant lifecycle) that "self-managed" needs
a real packaging story — not just `git clone`-and-good-luck.

Two distinct audiences:

1. **Local developers** want one command that brings up everything
   on a laptop so they can poke at the catalog REST API, see the ops
   console talk to it, and validate their integration.
2. **Production operators** want a Kubernetes-native deployment
   that's recognisable to the cluster's existing tooling (helm
   diff, ArgoCD, Flux, helm-secrets).

This ADR codifies what we ship for both.

---

## Decision

### D1 — Two artifacts: docker-compose for local, Helm for prod

`platform/docker-compose.yml` brings up the full stack
(Postgres + dev-JWKS + catalog + ops console + migrations) in a
single command. `platform/helm/agentic-platform/` is a Helm chart
for production deployment.

We deliberately **do not ship**:

- Kustomize overlays. Helm covers most needs; Kustomize-on-top is
  a community-contributed pattern operators can layer themselves
  if they want.
- Operator framework. A Kubernetes Operator implies CRDs +
  reconciliation logic for "Tenant" / "Capability" custom
  resources. Useful at scale; overkill at v0.1. Defer to a later
  milestone if real demand surfaces.
- Terraform module. Adopters with strong Terraform shops will
  wrap Helm with `helm_release`; ditto Pulumi. Owning a TF module
  is a treadmill we'd rather not start.

### D2 — Bundled Postgres is opt-out, not opt-in

The chart defaults to a single-pod Postgres StatefulSet so a
fresh `helm install` Just Works. The README screams in red letters
that this is **not** for production; `database.bundled.enabled=false`
+ `database.external.enabled=true` is the production path.

Why the default is bundled:

- **First-time experience matters.** A `helm install` that fails
  with "you forgot to provide a DATABASE_URL" is a worse first
  impression than "Postgres is bundled by default."
- **The README has a hardening checklist** that walks operators
  through swapping to managed PG before going live. Better to
  surface the trade-off in docs than to make installation
  ceremonial.

### D3 — Ops console is nginx + envsubst, not Node

The ops console build output is static assets. We ship it as
`nginx:1.27-alpine` with an envsubst-able config that proxies
`/v1/*` to the catalog. Reasons:

- **30 MB image.** A Node-based static-server image (`@infra-tools/ops-console`
  running an Express + serve-static stack) would be 200 MB.
- **Same-origin catalog API.** Browser hits `/v1/...` on the ops
  console host; nginx reverse-proxies to the catalog. No CORS
  pre-flight, no browser-side cross-origin Authorization-header
  leakage.
- **No Node attack surface in the user-facing path.** The catalog
  has node + npm + zod; the ops console pod has nginx static.

### D4 — Migrations as a Helm pre-install/pre-upgrade hook

`node-pg-migrate up` runs as a Job before the catalog Deployment is
created/upgraded. Reasons:

- **Atomicity.** Migrations either complete (catalog rolls forward)
  or fail (helm aborts the upgrade). Operators can't end up with
  pods running against a half-migrated schema.
- **Idempotency by design.** `node-pg-migrate` tracks applied
  migrations in `pg_migrations` and skips already-applied ones.
- **Operator opt-out.** `migrations.enabled=false` lets CI-owned
  pipelines run them externally. Common pattern in mature shops.

The catalog server **also** ships `npm run migrate:up` for
operators who don't use Helm (compose-only deployments,
monolithic VM installs). Same script, two delivery vectors.

### D5 — Local-dev OIDC fixture: a tiny static-key JWKS server

`platform/local-dev/` has a `mint-dev-key.mjs` script that produces
an RSA key pair, an `dev-private.pem` (gitignored), and writes the
public key to `dev-jwks/.well-known/jwks.json`. The compose stack
mounts that dir into an nginx container at `http://dev-jwks/` and
the catalog is configured to treat it as a real OIDC issuer.

This means **no weakening of catalog security in dev**. The catalog
still validates JWT signatures, audience, issuer, expiry. The only
thing different from prod is *who issued the key*.

`mint-token.mjs` is a 30-line script that signs tokens with the
local-dev key. Operators paste them into the ops console login or
pipe to `curl --header 'Authorization: Bearer ...'`.

### D6 — Distroless catalog, alpine ops-console, alpine Postgres

Catalog server: `gcr.io/distroless/nodejs22-debian12:nonroot`. No
shell, non-root, ~80 MB. Already established in ADR-015.

Ops console: `nginx:1.27-alpine`. Static-asset serving doesn't
need a sophisticated runtime; alpine-nginx is the canonical
choice.

Bundled Postgres: `postgres:16-alpine`. Smallest official PG
image; we don't tune internals.

All workloads carry a strict `securityContext`:
`runAsNonRoot: true`, `allowPrivilegeEscalation: false`,
`capabilities.drop: ["ALL"]`, `readOnlyRootFilesystem: true`
(except the ops console whose nginx writes to /var/run).

### D7 — Single chart, two services

Originally considered shipping `agentic-catalog` and
`agentic-ops-console` as separate charts so operators could swap
the console for an in-house alternative. Decided against:

- **The two are co-deployed in 95% of cases.** Operators who want
  to disable the console set `opsConsole.enabled=false` in values.
- **Charts don't scale well at v1.** Two charts mean two
  Chart.yaml + two README + two CI release pipelines. The chart-
  per-service split makes more sense at M5+ when other components
  (audit-retention CronJob, metrics scraper) join.
- **Sub-charts are an option later** if independent versioning
  becomes a real need.

---

## Consequences

### Positive

- **`docker compose up` ships a working platform.** First-day
  experience is a real first-day experience.
- **`helm install` for production.** Operators with existing
  k8s tooling get a recognisable artifact.
- **Reproducible local OIDC.** Same security checks as prod;
  difference is just *which* IdP signed the token.
- **Production hardening checklist** is explicit about the
  trade-offs, so operators know exactly what to swap before
  going live.
- **Zero new runtime dependencies.** Everything packaged is
  already what the catalog and ops console run; no new libraries.

### Negative / risks

- **Bundled Postgres is foot-gun-shaped.** Defaulting it on means
  a fast first-install but operators who skip the README ship to
  prod with a single-pod data-loss-risk PG. Mitigated by the
  big red warning in NOTES.txt + README. Will revisit defaults
  if production-by-accident becomes a pattern.
- **Manual JWKS bootstrap in local dev.** `mint-dev-key.mjs` is a
  one-time gesture; new contributors will hit "the catalog rejects
  my token" once and have to read the README. We could
  pre-generate a key pair and ship it, but committing a private
  key to git creates a worse footgun: it WILL show up on someone's
  prod by mistake.
- **Helm chart grows over time.** Each new service (audit-retention
  CronJob, future C8 deploy editor, etc.) adds templates. We'll
  hit the chart-vs-subcharts boundary by M5+; deferred.

### Out of scope (deferred)

- **Operator framework / CRDs.** `kind: Tenant`, `kind: Capability`
  custom resources reconciled by an in-cluster operator. Useful at
  scale; defer until adoption justifies the maintenance cost.
- **Terraform module.** Adopters wrap Helm with `helm_release`;
  shipping a TF module is a maintenance treadmill.
- **Air-gapped install bundle.** Tarball-with-images for
  customers without registry access. Useful for F500 / public
  sector; defer until concrete demand.
- **Multi-cluster federation.** Catalog deployed cross-cluster
  with read replicas. Deferred to M5+; needs SSE first (ADR-015
  §D-future).
- **Fluxv2 / ArgoCD app-of-apps templates.** Trivial to add but
  adopter-specific; we'll publish examples in a `examples/k8s/`
  directory rather than locking them into the chart.

---

## Implementation summary

- `platform/docker-compose.yml` — local-dev one-command stack
- `platform/local-dev/` — JWKS fixture + mint scripts
- `platform/agentic-ops-console/Dockerfile` — nginx-alpine static
- `platform/agentic-ops-console/nginx.conf.template` — SPA + reverse-proxy
- `platform/helm/agentic-platform/Chart.yaml` — chart metadata
- `platform/helm/agentic-platform/values.yaml` — full values surface
- `platform/helm/agentic-platform/templates/*.yaml`:
  - `_helpers.tpl` — labels, image refs, DATABASE_URL builder
  - `serviceaccount.yaml`, `catalog-secret.yaml`
  - `catalog-deployment.yaml`, `catalog-service.yaml`, `catalog-ingress.yaml`
  - `ops-console-deployment.yaml`, `ops-console-service.yaml`, `ops-console-ingress.yaml`
  - `postgres.yaml` — bundled StatefulSet + Service (opt-out)
  - `migrations-job.yaml` — pre-install/pre-upgrade hook
  - `NOTES.txt` — post-install operator guidance
- `platform/helm/agentic-platform/README.md` — install + hardening
  checklist + common ops recipes
