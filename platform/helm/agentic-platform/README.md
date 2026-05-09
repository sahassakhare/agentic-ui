# agentic-platform — Helm chart

Self-managed deployment of the Maverick agentic platform.
**M2 C9 v0.1.0.** Apache 2.0.

The chart deploys:

- **Catalog server** (T2) — capability/MFE/role-mapping/audit/usage/tenant API.
- **Ops console** — read-only viewer (Angular SPA behind nginx).
- **Postgres** *(optional)* — bundled single-pod StatefulSet for dev /
  small self-hosters. Production should set `database.external.enabled=true`
  and point at managed Postgres.
- **Migrations Job** — pre-install/pre-upgrade hook running
  `node-pg-migrate up`.

Design rationale: [ADR-021](../../../docs/adr/0021-self-managed-packaging.md).

---

## Quick start (dev)

```bash
helm install platform platform/helm/agentic-platform \
    --namespace agentic --create-namespace \
    --set oidc.issuer=https://your-idp.example.com/ \
    --set oidc.audience=agentic-catalog \
    --set image.registry=ghcr.io/sahassakhare \
    --set catalogServer.image.tag=0.1.0 \
    --set opsConsole.image.tag=0.1.0
```

Bundled Postgres is on by default. Output `NOTES.txt` walks you through
port-forwards.

---

## Production install

```bash
helm install platform platform/helm/agentic-platform \
    --namespace agentic --create-namespace \
    --values values.production.yaml
```

A production `values.production.yaml`:

```yaml
image:
  registry: ghcr.io/your-org
  pullPolicy: IfNotPresent

catalogServer:
  replicaCount: 3
  ingress:
    enabled: true
    className: nginx
    host: catalog.your-org.com
    tls:
      enabled: true
      secretName: catalog-tls

opsConsole:
  replicaCount: 2
  ingress:
    enabled: true
    className: nginx
    host: ops.your-org.com
    tls:
      enabled: true
      secretName: ops-console-tls

oidc:
  issuer: https://idp.your-org.com/
  audience: agentic-catalog

database:
  bundled:
    enabled: false       # turn off bundled PG
  external:
    enabled: true
    existingSecret: catalog-db-credentials
    existingSecretKey: connection-string   # secret holds the full URL

migrations:
  enabled: true          # CI-driven? set false and run them yourself
```

---

## Production hardening checklist

Before going live, walk through this list:

- [ ] **External managed Postgres.** RDS / Cloud SQL / Aiven /
      Neon — *not* the bundled chart. Backups + PITR enabled.
- [ ] **`existingSecret` for the DB password.** Never set
      `database.external.password` directly in values; it ends up
      in `helm get values` output.
- [ ] **`BYPASSRLS` role.** Create a `catalog_admin` Postgres role
      with `BYPASSRLS` for ops tooling that needs to read across
      tenants. Never grant `BYPASSRLS` to the application's runtime
      role — RLS is the only thing isolating tenants.
- [ ] **TLS on every Ingress.** Both catalog and ops console.
- [ ] **CORS pinned.** The default catalog CORS allows `*` for dev
      simplicity. In production, set the origins via env or config
      override before exposing the catalog publicly.
- [ ] **OIDC validated against your real IdP.** `oidc.issuer` +
      `oidc.audience` must match what your IdP mints; the catalog
      rejects every request with a clean RFC 7807 problem+json
      otherwise.
- [ ] **Migrations strategy.** Either trust the bundled
      pre-install/pre-upgrade hook (default) or set
      `migrations.enabled=false` and run `node-pg-migrate up`
      from your CI pipeline. Never let two pods race on first boot.
- [ ] **Liveness / readiness probes.** Defaults wire `/healthz` +
      `/readyz`; raise the failure thresholds if your DB is on a
      slow network so flapping doesn't churn pods.
- [ ] **Audit-retention job.** The catalog appends-only to
      `catalog_audit`. Schedule a periodic prune
      (`pg_partman` or a CronJob with `DELETE WHERE occurred_at <
      now() - interval '<retention>'`) per your compliance policy.
- [ ] **Network policy.** Lock the catalog Service to traffic from
      the ops console + your runtime tier; lock Postgres to the
      catalog only.
- [ ] **Resource requests/limits.** Defaults are conservative; tune
      against load tests.
- [ ] **OpenTelemetry.** Wire your collector at the host
      (sidecar / DaemonSet); the catalog emits structured pino logs
      that work with Loki/ELK out of the box.

---

## Common operations

### Onboard a tenant

```bash
TOKEN=$(your-token-mint-script --tenant mgmt --roles platform-admin)
curl -X POST https://catalog.your-org.com/v1/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"acme","displayName":"Acme Corp","quotas":{"monthlyTokens":1000000}}'
```

### Suspend a tenant

```bash
curl -X POST https://catalog.your-org.com/v1/tenants/acme/suspend \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"overdue invoice"}'
```

### Verify the audit chain

```bash
TENANT_TOKEN=$(your-token-mint-script --tenant acme)
curl https://catalog.your-org.com/v1/catalogs/acme/audit/verify \
  -H "Authorization: Bearer $TENANT_TOKEN"
# → {"valid":true,"checkedRows":1234,"chainHead":{...},"brokenAt":null}
```

### Roll out a new catalog version

Migrations run automatically as a `helm upgrade` pre-hook:

```bash
helm upgrade platform platform/helm/agentic-platform \
    --namespace agentic \
    --reuse-values \
    --set catalogServer.image.tag=0.2.0
```

---

## Values reference

See [`values.yaml`](./values.yaml) for the full set with comments.

| Key | Default | Notes |
|---|---|---|
| `oidc.issuer` | `""` | **REQUIRED.** Catalog rejects all auth without it. |
| `oidc.audience` | `agentic-catalog` | `aud` claim to expect. |
| `catalogServer.replicaCount` | `2` | HA via multiple replicas + sticky session not required (stateless). |
| `database.external.enabled` | `false` | Set to `true` for production. |
| `database.bundled.enabled` | `true` | Disable for production. |
| `migrations.enabled` | `true` | Disable if your CI runs them. |
| `image.registry` | `ghcr.io/sahassakhare` | Override for private registries. |

---

## License

Apache 2.0. The chart is part of the runtime monorepo and will move
to `agentic-platform-control-plane` when M2 GAs (per ADR-010 D6).
