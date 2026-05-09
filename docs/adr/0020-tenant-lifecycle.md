# ADR-020 · Tenant lifecycle — onboard / suspend / off-board via API

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-010](./0010-platform-principles-and-license.md) · [ADR-015](./0015-catalog-server-design.md) · [ADR-016](./0016-iam-role-mapping.md) · [ADR-017](./0017-audit-chain.md)

---

## Context

The v0.1 catalog had a `tenants` table but no lifecycle API — operators
seeded tenants via psql at deployment time and stayed there. That
worked for early adopters bringing up a single instance.

Real adoption immediately surfaced the gaps:

1. **Onboarding requires a DB credential.** Every new tenant
   onboarding becomes a ticket to the database admin.
2. **Suspension has no audit story.** Operators want to suspend a
   tenant for non-payment, compliance hold, or incident response —
   and have a defensible record of *who* suspended *why*.
3. **Quotas live nowhere.** Hosts that want chargeback caps or
   rate limits have no per-tenant policy hook.
4. **Off-boarding is brittle.** Hard `DELETE` cascades through
   capabilities, mfes, role-mappings, usage, audit. Operators want
   a soft-delete path that preserves audit history through the
   retention window.

This ADR codifies M4 C7's tenant lifecycle API and the platform-admin
boundary that gates it.

---

## Decision

### D1 — `/v1/tenants/*` is platform-level, not per-tenant

The route mounts at `/v1/tenants/*`, **outside** the tenant-scope
middleware that guards `/v1/catalogs/{tenant}/*`. Reasons:

- **Operations across tenants.** Listing tenants is by definition
  cross-tenant; the tenant-scope guard would make it impossible.
- **Platform-admin boundary is explicit.** Every route checks
  `isPlatformAdmin(principal)` before doing anything else; no
  ambiguity about who can call.
- **Mounted before the tenant-scope middleware.** Registration
  order matters — if `/v1/tenants/*` were mounted under
  `/v1/catalogs/:tenant/*` the guard would reject any caller whose
  JWT tenant didn't match a tenant id in the path, which is
  exactly wrong here.

### D2 — Tenant id is immutable

Once created, a tenant id is the durable handle that
`capabilities.tenant_id`, `mfe_remotes.tenant_id`,
`role_mappings.tenant_id`, `usage_events.tenant_id`,
`catalog_audit.tenant_id` all FK against. Renaming would require a
multi-table cascade and break in-flight JWT-issued tokens. Operators
who need a "rename" run **clone-and-deprecate**: create the new id,
migrate data through application code, soft-delete the old id.

### D3 — Status transitions go through dedicated endpoints

`POST /v1/tenants/:id/suspend` (with `reason`) and
`POST /v1/tenants/:id/activate` exist instead of letting `PATCH`
write `status`. Reasons:

- **Audit clarity.** The audit row's `diff` carries the reason
  alongside `before` / `after`; a generic PATCH would let an
  operator silently flip status without recording why.
- **Idempotency story per-transition.** Repeating `/suspend`
  updates the reason but preserves the original `suspended_at`
  timestamp — that's the moment that matters for compliance.
  Repeating `/activate` is a no-op.
- **No accidental status flip.** A PATCH that includes both
  `displayName` and `status` couldn't atomically capture the
  transition's audit metadata.

### D4 — Quotas are recorded but **not enforced** by the catalog

The `quotas` JSONB column carries operator-set policy:
`monthlyTokens`, `monthlyToolInvocations`, `maxCapabilities`,
`maxMfeRemotes`. The catalog server records these and exposes them
through the tenant API; it does not check them on capability or
usage writes.

Why not enforce:

- **Pricing model is host-domain.** Different operators bill
  differently — some hard-cap, some soft-cap with overage, some
  ignore the meter entirely. Encoding one policy in the catalog
  forces every operator to override.
- **Quota enforcement at the catalog wrong layer.** The right
  enforcement point is the runtime adapter (where the LLM call
  happens) or the operator's API gateway. Either of those reads
  `GET /v1/tenants/:id` to load policy and applies it locally.
- **No silent failure mode.** "Catalog enforces quota" sounds nice
  until the rate-limit fires mid-flow with no UX hook.

### D5 — Soft-delete preserves data; hard-delete is psql-only

`DELETE /v1/tenants/:id` sets `status='deleted'` and stamps
`deleted_at`. The cascade FK to `capabilities`,
`mfe_remotes`, etc. is `ON DELETE CASCADE` — but the catalog
issues an `UPDATE`, not a `DELETE`, so cascading does *not* fire.
Tenant-scoped data sits in place during the retention window.

For a true purge (retention expired, GDPR right-to-be-forgotten),
operators connect via psql with the BYPASSRLS role and run
`DELETE FROM tenants WHERE id = '...'`. That fires the cascade
and is irreversible — intentionally out of the API because:

- It's a one-way operation; an accidental click would be
  unrecoverable.
- GDPR purges already require a documented manual approval at
  most organisations; surfacing them via API would skip that
  gate.
- The audit chain (ADR-017) cannot be cleanly purged for one
  tenant without breaking the chain integrity for that tenant —
  operators handle this with scheduled batch jobs that snapshot
  the chain and then delete, not with click-of-a-button UI flows.

### D6 — Audit rows for tenant lifecycle are scoped to the affected tenant

Every tenant mutation appends a row to `catalog_audit`:

```jsonc
{
  tenant_id: "<affected tenant>",   // not the platform-admin's tenant
  entity_type: "tenant",
  entity_id: "<affected tenant>",
  operation: "create" | "update" | "delete" | "restore",
  diff: { ...before, ...after, reason? }
}
```

The audit table is RLS-isolated per `tenant_id` (ADR-017). The
route handler temporarily sets `app.tenant_id` to the affected
tenant's id for the audit insert, then resets it. This means:

- **Per-tenant audit trails contain their own lifecycle events.**
  When a customer asks "show me everything that happened to my
  tenant," the answer is `SELECT * FROM catalog_audit WHERE
  tenant_id = '<theirs>'` — including the lifecycle transitions.
- **Hash chain extends across mutation types.** The same chain
  that links `capabilities.create` to `role_mapping.update` also
  links `tenant.suspend`. One end-to-end verifiable history per
  tenant.

### D7 — `withPlatformScope` for cross-tenant transactions

A new helper alongside `withTenantScope`. Identical shape (open
transaction, commit/rollback, release) but **no GUC set up
front**. Tenant CRUD reads/writes the tenants table (no RLS) plus
optionally writes audit rows (RLS-scoped, GUC set inline for
that specific INSERT). Keeps the two scopes' invariants visibly
distinct.

---

## Consequences

### Positive

- **Onboarding via API.** A new tenant is a single
  `POST /v1/tenants`, not a DB ticket.
- **Defensible suspension.** `who + when + why` lives in the
  audit chain.
- **Quota policy point.** Hosts read per-tenant quotas from one
  place and enforce in their own gateway.
- **Soft-delete with retention.** Tenants leave without their
  audit history disappearing.
- **Composable with ADR-016.** Role mappings already key on
  `tenant_id`; suspending a tenant doesn't invalidate its
  mappings, so reactivation is clean.

### Negative / risks

- **No quota enforcement out of the box.** Operators must wire
  it themselves at the runtime / gateway. Documented as a
  feature, not a bug.
- **Suspended tenants can still read.** The catalog admits
  reads regardless of `status`; hosts that want to lock a
  suspended tenant out of the runtime check
  `GET /v1/tenants/:id` and act on `status` themselves.
  This separation is intentional (audit access during
  suspension is a feature) but documented loudly so operators
  don't assume the catalog gates traffic.
- **Hard-delete-from-API is missing.** Acceptable for v0.1;
  GDPR-grade purges remain a manual escalation.

### Out of scope (deferred)

- **Webhook on lifecycle events.** Hosts that want to react to
  `tenant.suspended` (revoke active sessions, drain queues)
  must poll for now. SSE-based push lands with the broader
  catalog SSE work (ADR-015 §D-future).
- **Bulk ops.** No `POST /v1/tenants/bulk-suspend`. Operators
  loop client-side; volumes don't justify a server primitive.
- **Tenant clone (for a quick env duplicate).** Useful but
  out of M4 scope; will land alongside the deploy/promotion
  editor (M2 C8).
- **Per-tenant maintenance windows / TTL.** Time-bounded
  suspension with auto-reactivation. Useful for trial tenants;
  deferred until concrete demand.

---

## Implementation summary

- Migration: `platform/agentic-catalog-server/src/db/migrations/005_tenant_lifecycle.sql`
- Domain: `platform/agentic-catalog-server/src/domain/tenant.ts`
- Repository: `platform/agentic-catalog-server/src/repository/tenant-repo.ts`
  — `createTenant`, `listTenants`, `findTenantById`, `updateTenant`,
  `suspendTenant`, `activateTenant`, `softDeleteTenant`
- Routes: `platform/agentic-catalog-server/src/routes/tenants.ts`
- Pool helper: `withPlatformScope` added to `db/pool.ts`
- OpenAPI: 5 new path entries (`/tenants`, `/tenants/{id}`,
  `/tenants/{id}/suspend`, `/tenants/{id}/activate`) + 4 new schemas.
- Tests:
  - 10 repository unit tests
  - 12 routes integration tests (auth, admin gating, lifecycle
    transitions, audit propagation)
- Catalog total now: 140/140 passing.
