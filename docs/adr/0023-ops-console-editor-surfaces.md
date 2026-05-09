# ADR-023 · Ops Console editor surfaces (M2 C6.1)

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-019](./0019-ops-console-design.md) · [ADR-020](./0020-tenant-lifecycle.md) · [ADR-022](./0022-auth-disabled-mode.md)

---

## Context

C6 v0 ([ADR-019](./0019-ops-console-design.md)) shipped a **read-only**
ops console — every page rendered, none of them mutated. The trade-off
was deliberate: validate the read-side surfaces against real operator
workflows before locking in mutation flows.

Two months in, the read surfaces are stable. Every adopter who's spun
up the platform has hit the same friction:

- "I want to onboard a tenant" → `curl POST /v1/tenants` (the Render
  demo deployment in particular makes this painful: anyone clicking
  through the URL has to reach for terminal + `curl`).
- "I want to register a capability" → `curl` again.
- "I want to deprecate this capability" → `curl PATCH /capabilities/{id}`.
- "I want to suspend this tenant" → `curl POST /tenants/{id}/suspend`.

The endpoints are all there. The UI just doesn't expose them yet.

This ADR codifies C6.1 — adding mutation flows to the highest-traffic
surfaces (tenants + capabilities) without disturbing the existing
read surfaces.

---

## Decision

### D1 — Tenants and capabilities first; role-mappings + MFEs later

Two surfaces get editors in this slice:

- **Tenants** — onboard, suspend (with reason), activate, soft-delete.
- **Capabilities** — register, change lifecycle (in-row dropdown),
  soft-delete.

Three surfaces stay read-only for now:

- **MFE remotes** — registration is operator-rare; usually wired
  once at deploy time. Ship the editor when ops feedback shows
  in-UI registration as a pain point.
- **Role mappings** — only relevant when AUTH_MODE=oidc; the
  Render demo path doesn't exercise them. Adopters wiring real
  IdPs configure mappings via API + their config-as-code pipelines.
- **Audit chain + Usage** — these are read-only by definition.
  Audit is append-only ([ADR-017](./0017-audit-chain.md));
  usage events are written by the runtime, not by operators.

Order of value: tenants > capabilities > role-mappings > MFEs.
Doing the top two as one slice covers the demo flow end-to-end.

### D2 — Modal + confirm-dialog primitives, no design-system import

Two new shared components:

- **Inline create modal** — a `<dialog>`-style overlay with form
  inputs, owned by the page that triggers it. Each page (tenants,
  capabilities) has its own; the markup is small and the forms
  diverge enough that a generic "create modal" abstraction would
  require generic field configs that are more code than just
  inlining the form.
- **`<ops-confirm-dialog>`** — reusable for destructive / lifecycle
  actions (suspend, delete). Supports a `requireReason` mode that
  forces an audit-trail reason before the confirm button enables.
  Used by tenant suspend; capability delete uses the `destructive`
  variant without a reason.

We deliberately do **not** import a UI library (Angular Material,
PrimeNG, etc.) for these. Reasons:

- The console aesthetic is monochrome ops-tool, not customer-facing
  product. A design system would impose a theme we'd need to
  override.
- Adding a UI library doubles the install size and creates a
  cross-cutting dependency we'd carry forever.
- Two well-styled dialogs are ~100 lines each. The maintenance
  cost is lower than the maintenance cost of "now we own the
  Material → custom-theme upgrade cycle."

Hosts that want a design-system look can replace the components
without touching the catalog-client; the boundary is clean.

### D3 — Optimistic refresh, not optimistic UI

After every mutation, the page calls `refresh()` to re-fetch the
list. We do **not** optimistically update local state and roll back
on error.

Reasons:

- **Server is the source of truth.** Lifecycle transitions can
  cascade (suspend tenant → audit row appended → updated_at
  bumps). Round-tripping shows the operator exactly what landed.
- **Latency is acceptable.** Catalog endpoints respond in
  10–50ms locally + 100–300ms cross-region. The user clicks a
  button and the table refreshes within a render frame; that's
  on the right side of the "should I re-render?" boundary.
- **Less code.** Optimistic-rollback machinery is ~3× the code
  of "fire request, refresh on response" and the user-visible
  win is small at this scale.

If a future high-volume editor surface (bulk capability update,
say) shows latency wins from optimistic UI, we'll bring it in
locally at that page; this ADR doesn't lock us in.

### D4 — Capability lifecycle is an in-row dropdown, not a modal

Capability `lifecycle` (draft / published / deprecated / disabled)
changes via a `<select>` in the row, not a confirm modal. Reasons:

- **High-frequency.** "Promote draft to published" or "deprecate
  this old version" is a routine ops action; modal-and-confirm
  every time becomes friction.
- **Reversible.** Deprecating a capability doesn't delete data;
  flipping it back is one click.
- **Audit captures it.** Every transition appends an audit row
  with before+after, so an accidental click is recoverable AND
  visible in audit history.

Capability **delete**, on the other hand, gets a confirmation
dialog — same destructive-action pattern as tenant delete.

### D5 — Tenant suspend requires a reason, audited

The confirm dialog for suspend has `requireReason: true`. The
catalog server already requires it ([ADR-020](./0020-tenant-lifecycle.md)
§D3); the dialog enforces it client-side too with a disabled
confirm button until the reason input has content.

The reason flows into the audit-trail diff so a compliance review
months later can answer "why was this tenant suspended on March
4th?" by querying the audit log.

### D6 — Validation duplicated client-side, kept loose

Client-side validation is only the bare-minimum sanity check:

- Tenant id matches `[a-zA-Z0-9_.-]+` (mirrors
  [ADR-020](./0020-tenant-lifecycle.md) §D2).
- Capability name matches `[A-Za-z0-9_./:@-]+` (mirrors the
  catalog's Zod schema).
- JSON fields parse as JSON.

The server's Zod schema is the **authoritative** validator; the
client just keeps users from submitting obvious typos. We
deliberately don't replicate the full Zod schema in the client
because that creates a drift target — server tightens validation,
client doesn't notice for a release.

---

## Consequences

### Positive

- **Demo flow works without curl.** Anyone landing on the Render
  demo URL can onboard a tenant + register a capability in 30
  seconds.
- **Lifecycle transitions auditable from UI.** Suspend with reason
  + activate + soft-delete all flow through the same audit chain
  ([ADR-017](./0017-audit-chain.md)) as direct API calls.
- **Read surfaces unchanged.** No regression risk on the v0 paths.
- **31/31 tests** including 7 new client mutation tests + 5 new
  tenants-component flow tests.

### Negative / risks

- **Dialog primitives are home-grown.** If the console grows beyond
  2–3 modals we'll feel the missing accessibility / focus-trap
  / keyboard-nav scaffolding that a UI library provides. Mitigated
  by keeping dialogs simple; if the cost climbs, we'll switch to
  Angular CDK's `Dialog` (no theme imposed) before introducing
  a full design system.
- **Client validation can drift from server.** The Zod schema
  on the catalog can tighten without the client noticing.
  Mitigated by the server returning RFC 7807 problem+json with
  field-level errors; the client surfaces them in the dialog
  error area. So the user always sees the truth, even when the
  client's own check would have let it through.
- **In-row lifecycle dropdown can fire accidentally.** A click
  in the wrong cell on a touchscreen could promote a draft to
  published. Acceptable because: (a) audit trail captures it,
  (b) flipping it back is one click. If real operators report
  this we'll add a "did you mean to?" toast.

### Out of scope (deferred)

- **Editor surfaces for MFE remotes + role mappings.** Doable
  with the same pattern; deferred until ops feedback shows
  demand.
- **Bulk operations.** "Suspend all tenants matching a tag,"
  "deprecate all capabilities of a kind." Useful at scale; v0.1
  is single-row only.
- **Inline editing for fields beyond lifecycle.** Editing a
  capability's `body` JSON in the UI would need a JSON editor
  with schema validation — that's its own design surface.
- **History panel.** Shows the audit chain entries for a single
  tenant / capability. The /audit page already has tenant-wide
  views; per-entity timeline is a v0.2 feature.

---

## Implementation summary

### Catalog client

`platform/agentic-ops-console/src/app/services/catalog-client.service.ts`
gains 6 new mutation methods:

| Method | HTTP |
|---|---|
| `createCapability(input)` | `POST /v1/catalogs/{tenant}/capabilities` |
| `patchCapability(id, patch)` | `PATCH /v1/catalogs/{tenant}/capabilities/{id}` |
| `deleteCapability(id)` | `DELETE /v1/catalogs/{tenant}/capabilities/{id}` |
| `createTenant(input)` | `POST /v1/tenants` |
| `suspendTenant(id, reason)` | `POST /v1/tenants/{id}/suspend` |
| `activateTenant(id)` | `POST /v1/tenants/{id}/activate` |
| `deleteTenant(id)` | `DELETE /v1/tenants/{id}` |

### Components

- `src/app/components/confirm-dialog.component.ts` — reusable
  confirmation dialog with optional reason input.
- `src/app/pages/tenants.component.ts` — adds + Onboard tenant
  button, create modal, per-row Suspend / Activate / Delete
  actions wired through the confirm dialog.
- `src/app/pages/capabilities.component.ts` — adds + Register
  capability button, create modal, in-row lifecycle dropdown,
  per-row Delete action.

### Tests

12 new tests:

- 7 client-mutation tests (`catalog-client.service.spec.ts`).
- 5 component-flow tests (`tenants.component.spec.ts`):
  non-admin notice, list-on-init, regex validation, create
  round-trip, suspend execution.

Total ops-console: 31/31. Catalog + lib unchanged.
