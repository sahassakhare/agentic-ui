# Render deployment

Two ways to land the platform on [Render](https://render.com):

1. **One-click demo** — `platform/render.yaml` blueprint provisions
   Postgres + catalog + ops-console with `AUTH_MODE=disabled`.
   Anyone with the URL has full read+write across every tenant.
   Use for quick demos / personal sandboxes.
2. **Production** — same shape but with a real OIDC provider wired
   in. Defer to the Helm chart at `platform/helm/agentic-platform/`
   for proper k8s deployment; Render's blueprint is demo-grade.

---

## One-click demo deploy

Prerequisites:

- A Render account (free tier works for the database; web services
  need at least the `starter` plan to avoid sleep-on-idle).
- Your fork of this repo on GitHub / GitLab / Bitbucket connected
  to Render.

Steps:

1. In Render, click **New +** → **Blueprint** → connect the repo.
2. When asked for the blueprint file path, enter
   `platform/render.yaml`. (The repo root has a different blueprint
   for the eDiscovery demo; if you take Render's default, you'll
   deploy that instead.)
3. Render reads the blueprint and provisions:
   - `agentic-catalog-db` — managed Postgres 16 (free plan)
   - `agentic-catalog-server` — Hono API on `:8080`, `AUTH_MODE=disabled`
   - `agentic-ops-console` — nginx-served Angular SPA, reverse-proxies
     `/v1/*` to the catalog over Render's internal network.
4. First deploy takes ~5 min while the images build.
5. Open the ops-console URL Render shows. The login screen prompts
   for a tenant id (no JWT — `AUTH_MODE=disabled` synthesises a
   platform-admin principal client-side). Type `demo` (or any
   `[a-zA-Z0-9_.-]+`) and you're in.
6. **Onboard the tenant** before doing anything tenant-scoped:
   click **Tenants** in the sidebar → there's no UI for create yet
   (read-only console v0), so curl it:
   ```bash
   curl -X POST https://<your-catalog>.onrender.com/v1/tenants \
     -H 'Content-Type: application/json' \
     -d '{"id":"demo","displayName":"Demo Tenant"}'
   ```
   The catalog admits this with no auth. Now `Capabilities`,
   `Audit chain`, etc. all work.

### Banner check

Every page in the ops console shows an **AUTH_MODE=disabled**
warning banner. The catalog's `/healthz` reports
`{"authMode":"disabled"}` so external uptime monitoring also sees
the trust mode.

### Bringing it down

Render Blueprint deletes cleanly: dashboard → environment →
**Delete environment**. The Postgres database is destroyed too
(this is why the blueprint is *demo-grade*).

---

## Production deploy

Don't use this blueprint for production. Reasons:

- `AUTH_MODE=disabled` means *no auth*. Anyone reaching the URL
  has admin access to every tenant.
- Render's free Postgres is single-AZ, no PITR.
- The catalog Dockerfile used here (`Dockerfile.render`) is the
  shell-bearing slim image; the production `Dockerfile`
  (distroless) has a smaller attack surface.

For real deployments use the [Helm chart](./helm/agentic-platform/README.md)
with:

- An external OIDC provider (Auth0 / Clerk / WorkOS / Keycloak / Okta).
- Managed Postgres with backups + PITR.
- TLS on every Ingress.
- The hardening checklist in the chart's README.

You *can* run the platform on Render in production-shape with a
real IdP — drop `AUTH_MODE=disabled` from `platform/render.yaml`
and add `OIDC_ISSUER` + `OIDC_AUDIENCE` env vars. But the Helm
chart gives you finer control + multi-AZ Postgres.

---

## What lives where

| Artifact | Used by | Notes |
|---|---|---|
| `platform/render.yaml` | Render blueprint | Demo deployment |
| `platform/agentic-catalog-server/Dockerfile` | Helm + compose | Distroless, ~80 MB |
| `platform/agentic-catalog-server/Dockerfile.render` | Render only | Slim with shell, ~150 MB |
| `platform/agentic-ops-console/Dockerfile` | Helm + compose | nginx-alpine, `authMode='oidc'` |
| `platform/agentic-ops-console/Dockerfile.render` | Render only | nginx-alpine, patches to `authMode='disabled'` |

The two `.render` Dockerfiles exist so the production deployment
shape stays strict (distroless catalog + proper OIDC ops console)
while the Render demo path can use shell-friendly tooling.

See [ADR-022](../docs/adr/0022-auth-disabled-mode.md) for the
trade-offs codified in `AUTH_MODE=disabled`.
