# @maverick/agentic-ops-console

**Read-only ops console over the agentic catalog server.** M2 C6 v0
from the [platform-evolution plan](../../docs/plans/platform-evolution-plan.md).
Apache 2.0.

This is the operator's view into a running catalog deployment:
capabilities, MFE remotes, IAM role mappings, audit-chain status,
usage. v0 is **read-only on purpose** — editing comes in C6.1 once
the read-side flows are validated against real adopters.

> Heads up: like the catalog server, this package will be extracted
> to its own repo (`sahassakhare/agentic-platform-control-plane`)
> when M2 GAs. Until then it lives in the runtime monorepo.

---

## Status

**M2 C6 v0 — read-only console.** Bundled views:

| View | Surface |
|---|---|
| **Capabilities** | List, kind / lifecycle filters |
| **MFE remotes** | List with health status |
| **Role mappings** | List ordered by priority; enabled / disabled badges |
| **Audit chain** | Live verification status; one-click JSONL download |
| **Usage** | Aggregate by kind + recent events |

Editing surfaces (create/patch/delete) ship in C6.1.

---

## Quick start

```bash
# 1. Run the catalog server somewhere (see ../agentic-catalog-server/README.md)
# 2. Point the console at it (defaults to http://localhost:8080)
npx ng serve agentic-ops-console
# → http://localhost:4500/login
```

> Port 4500 by convention. The 4300–4304 band is reserved for the
> eDiscovery demo (`demo-ediscovery-shell` runs on :4300, federated
> remotes on :4302–:4304).

Paste a JWT issued by your OIDC provider. The console parses tenant +
roles from the token's `tenant_id` and `roles` claims; cross-tenant
queries require `roles: ['platform-admin']`.

For production, build with:

```bash
npx ng build agentic-ops-console
# → dist/agentic-ops-console/
```

Serve `dist/agentic-ops-console/` from any static host. In production
the default `catalogBaseUrl` is `''` (same-origin) — point a reverse
proxy's `/v1/*` route at the catalog server.

---

## Architecture

```
src/
├── app/
│   ├── app.component.ts               # Bootstrap shell
│   ├── app.config.ts                  # ApplicationConfig (router + http)
│   ├── app.routes.ts                  # Lazy-loaded routes
│   ├── components/
│   │   └── shell.component.ts         # Sidebar + tenant/role badge
│   ├── guards/
│   │   └── auth.guard.ts              # Redirects to /login when unauth'd
│   ├── interceptors/
│   │   └── auth.interceptor.ts        # Adds Bearer; bounces on 401
│   ├── pages/
│   │   ├── login.component.ts         # JWT paste-in
│   │   ├── capabilities.component.ts
│   │   ├── mfes.component.ts
│   │   ├── role-mappings.component.ts
│   │   ├── audit.component.ts         # Verify + JSONL download
│   │   └── usage.component.ts         # By-kind aggregate + recent
│   └── services/
│       ├── auth.service.ts            # JWT parse, principal signal
│       └── catalog-client.service.ts  # Typed REST wrappers
└── environments/
    ├── environment.ts                 # localhost:8080 catalog
    └── environment.prod.ts            # same-origin (reverse-proxy pattern)
```

### Auth model

The console is for **operators**, not end-users. v0 trades convenience
for transparency: the operator pastes a JWT into the login screen.
The console owns nothing more than "what's in this token" — the
catalog server validates the signature and enforces the tenant-scope
guard.

Why not a full OIDC redirect today: the redirect-flow UX target
(in-browser PKCE vs. server-mediated) is a non-trivial decision we'd
rather make in C6.1 once we see real-operator workflows. The
paste-in flow lets us ship the read-side surfaces today.

### Read-side first

Every page is read-only. Mutations happen via the catalog REST API
directly (or via `psql` for ops). This is intentional — the C6 v0
purpose is to give operators **visibility**, and visibility is the
prerequisite for trusting the underlying machinery.

Editing forms (create capability, edit role mapping, etc.) come in
C6.1, gated on confidence that the read-side surfaces match what
operators actually need.

---

## Tests

```bash
npx ng test agentic-ops-console --watch=false
```

19 unit tests covering:
- `decodePrincipal` (JWT shapes)
- `AuthService` (signal updates + storage)
- `CatalogClientService` (URL routing for every endpoint)
- `LoginComponent` (validation + token storage)

---

## License

Apache 2.0 — see [LICENSE](../../LICENSE).
