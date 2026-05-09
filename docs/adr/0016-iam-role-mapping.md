# ADR-016 · IAM role mapping — IdP claims → runtime personas

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-010](./0010-platform-principles-and-license.md) · [ADR-014](./0014-governance-hooks.md) · [ADR-015](./0015-catalog-server-design.md)

---

## Context

The runtime tier (`@maverick/agentic-ui`) ships a `PersonaService` that
gates which capabilities, supervisor predicates, and prompts are visible
to the active user. Today the active persona is selected by the host
application via constructor input, dev-tools, or hard-coded defaults.

That works for demos. It does not work for an enterprise deployment,
where personas must be derived from **federated identity** — the user's
JWT claims as issued by Auth0, Keycloak, Okta, Azure AD, etc. The
recurring asks from operators are:

1. *"Map our `groups` claim to your runtime personas without forking
   the runtime."*
2. *"Give me an audit trail of who changed which mapping and when —
   I'll be asked by SOC 2 / ISO 27001."*
3. *"Make sure tenant A's admin can't promote their users to a
   privileged persona by editing the mapping table."*
4. *"Be tolerant of misconfiguration — fall back, don't crash."*

This ADR codifies the design of the role-mapping service that lives in
the catalog server (T2) and the runtime adapter that consumes it (T1).

---

## Decision

### D1 — Mapping is a T2 concern

Mappings live in the **catalog server**, persisted in Postgres with
RLS isolation per tenant. The runtime tier does not own mapping state.

Reasons:

- **Single source of truth across a fleet.** Multiple host processes
  must resolve identical inputs to identical personas.
- **Audit trail.** Mutations need to land in the same `catalog_audit`
  table as capability/MFE changes; tenants want one query, not five.
- **Editor surface.** The Ops Console (M2 C6) renders the same CRUD
  surface as for capabilities and MFEs.
- **Privilege boundary.** Mapping changes are exactly the kind of change
  that needs platform-admin oversight — and platform-admin context
  lives in T2, not in a runtime that may be running on every host.

The runtime tier consumes the *resolution* result. It does not see, edit,
or cache the mapping table itself.

### D2 — Schema: `(tenant_id, claim_path, claim_value) → runtime_persona`

```sql
CREATE TABLE role_mappings (
  id              UUID PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_path      TEXT NOT NULL DEFAULT 'groups',
  claim_value     TEXT NOT NULL,
  runtime_persona TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 100,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  description     TEXT NULL,
  …
  UNIQUE (tenant_id, claim_path, claim_value)
);
```

Resolution input: a `claim_path` (typically `groups`) plus a list of
`claim_values` extracted from the JWT.

Resolution output: the **highest-priority enabled** mapping whose
`claim_value` appears in the input list. Ties are broken
deterministically by `created_at ASC` (older mapping wins).

The unique constraint on `(tenant_id, claim_path, claim_value)` rules
out the obvious bulk-import mistake — same value mapped to two
different personas at the same priority.

`priority` is an integer 0–10 000 to leave room for explicit "this
mapping comes after that one" ordering without renumbering, and to
let the editor surface bands ("admin", "default", "override").

`claim_path` defaults to `groups` because that is the overwhelmingly
common case in real deployments. Auth0's namespaced claims
(`https://my.domain/claims.groups`) and other dotted paths are
supported as opaque strings — the server matches the path literally
against a top-level claim. Deeply nested traversal is **explicitly out
of scope** for v0.1; if it's needed, hosts should use an adapter that
flattens the claim before posting.

### D3 — Resolution is a hot-path REST endpoint, not a batch job

`POST /v1/catalogs/{tenant}/role-mappings/resolve` accepts the claim
input and returns:

```jsonc
{
  "runtimePersona":      "lead-counsel",
  "matchedClaimValues":  ["legal-counsel", "executive"],
  "mappingId":           "8c…",
  "priority":            100
}
```

The endpoint is intentionally cheap: a single
`SELECT … WHERE claim_path = $1 AND enabled AND claim_value = ANY($2)
ORDER BY priority DESC, created_at ASC`. The repository returns
*all* matching rows and the application picks the winner — that's
what lets `matchedClaimValues` carry the diagnostic set ("these are
the groups that granted this persona") without a second query.

`runtimePersona` is `null` when no enabled mapping matched. The
server does not invent a default — that decision belongs to the host
(`provideCatalogActivePersona({ defaultPersona })` in the adapter).

### D4 — Privilege-escalation guard

A protected-persona set
(`['platform-admin', 'lead-counsel']` by default; CSV-overridable via
`CATALOG_PROTECTED_PERSONAS`) gates create + update operations.
A non-platform-admin creating or patching a mapping whose
`runtimePersona` is in that set receives 403.

Rationale: in a multi-tenant deployment, the per-tenant admin is
trusted to manage their own users — but that trust does not extend
to silently promoting users to a *cross-tenant* role like
`platform-admin`. The guard makes that escalation explicit — only
the platform operator (carrying the `platform-admin` JWT role) can
do it, and the action is audited.

The guard is enforced at the route layer, not the repository, so
that internal bootstrap scripts running with elevated context
(seeding default mappings, migrating from a legacy table) can bypass
it without going through HTTP.

### D5 — Audit row in the same transaction as the mutation

Every create / update / delete on `role_mappings` writes a matching
row to `catalog_audit` in the same DB transaction. Atomic by
construction — no "the data changed but the audit didn't" gap.

The audit row's `entity_type` is `role_mapping`. The audit table is
already RLS-scoped, so per-tenant queries Just Work.

### D6 — Runtime adapter: `provideCatalogActivePersona({ catalogUrl, claimPath, defaultPersona })`

The runtime adapter ships in `@maverick/agentic-ui` and:

1. Reads the user's JWT claims from the configured `tokenSource`.
2. Posts the relevant claim values to
   `/v1/catalogs/{tenant}/role-mappings/resolve`.
3. Sets `personaService.active(result.runtimePersona ?? defaultPersona)`.
4. Re-resolves on token refresh.

This is the **only** runtime API surface that talks to the role-mapping
table. Hosts that don't run a catalog server can keep using the
existing static `personaService.active.set(...)` path; they simply
don't import the adapter.

The adapter is robust to:

- Catalog server unreachable → log + fall back to `defaultPersona`.
- 5xx from `resolve` → fall back, retry on next refresh.
- Schema drift → strict Zod validation rejects malformed responses;
  fall back.

The fallback **does not crash the runtime**. A misconfigured mapping
service must not lock the user out.

### D7 — No client-side caching of mappings

The runtime adapter calls `resolve` on login + on token refresh. It
does not cache mapping rows locally. A host that wants caching
should put a CDN / load-balancer cache in front of the catalog
server with a short TTL (≤ 60 s) — the catalog server emits no cache
headers itself because the mapping table can change at any moment,
and stale persona resolution is a security concern, not just a
performance one.

This decision can be revisited in v0.2 with an explicit
invalidation channel (SSE / WebSocket) if profile data shows
resolution latency dominates login time.

---

## Consequences

### Positive

- **Federated-identity ready out of the box.** Operators wire their
  IdP, declare a few mappings, and personas Just Work across the
  fleet.
- **Auditable.** Every change to who-can-be-what is in `catalog_audit`,
  per tenant, indexed by `entity_type = 'role_mapping'`.
- **Privilege boundary preserved.** A tenant admin cannot escalate
  their own users to a platform role.
- **Deterministic.** `priority DESC, created_at ASC` makes the
  resolution result reproducible across replays — important for
  debugging session-mismatch bugs.
- **Falls back, doesn't crash.** Catalog outage degrades the user to
  the default persona; the runtime stays alive.

### Negative / risks

- **One more network hop on login.** Mitigated by D7's cache hint
  (op may put a CDN in front).
- **Misconfiguration is silent.** A typo in the IdP's `groups` claim
  produces "no match → default persona" with only an info log — the
  operator has to look at telemetry to notice. The Ops Console (M2
  C6) will surface the resolution stats prominently.
- **Resolution does not deeply traverse JSON.** If a host's IdP
  packages groups under `https://my.domain/claims/groups.list`, the
  adapter must flatten before posting. Documented in the runtime
  adapter docs.

### Out of scope (deferred)

- **Group hierarchies.** No support for "if the user is in
  `engineering`, also grant `paralegal`". Hosts can express this as
  multiple mappings today; transitive group membership is a v0.3
  concern if real demand surfaces.
- **Dynamic mapping evaluation (e.g. CEL / OPA expressions).** v0.1
  is exact-match-only. The schema leaves room for a future
  `match_expression` column if the static-table approach hits a wall.
- **Per-environment overrides** (`staging` vs `prod` mapping a claim
  to different personas). Operators run separate catalog deployments
  per environment today, which is the recommended pattern.

---

## Implementation summary

- Migration: `platform/agentic-catalog-server/src/db/migrations/002_role_mappings.sql`
- Domain: `platform/agentic-catalog-server/src/domain/role-mapping.ts`
- Repository: `platform/agentic-catalog-server/src/repository/role-mapping-repo.ts`
- Routes: `platform/agentic-catalog-server/src/routes/role-mappings.ts`
- OpenAPI: `platform/agentic-catalog-server/src/routes/openapi.ts` (RoleMapping + Resolve schemas, four path entries)
- Runtime adapter: `projects/agentic-ui/src/lib/iam/provide-catalog-active-persona.ts`
- Tests:
  - 14 repository unit tests against pg-mem
  - 15 route integration tests through the full Hono pipeline
- Audit: `entity_type = 'role_mapping'` rows on every mutation,
  per existing `catalog_audit` table.
