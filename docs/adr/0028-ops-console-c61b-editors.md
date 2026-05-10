# ADR-028 · Ops Console C6.1b — MFE + role-mapping editors

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-019](./0019-ops-console-design.md) · [ADR-023](./0023-ops-console-editor-surfaces.md)

---

## Context

C6.1 ([ADR-023](./0023-ops-console-editor-surfaces.md)) shipped
editor surfaces for the two highest-traffic resources (tenants +
capabilities) and explicitly deferred MFE remotes + role mappings to
"a later slice if ops feedback shows demand."

Two months in:

- **MFE remotes** — Federation manifest entries are operator-rare
  but the live demo's user flow exposes the gap. Adopters
  registering a new MFE remote today still reach for `curl`.
- **Role mappings** — When AUTH_MODE=oidc is wired, role mappings
  drive every login. Configuration drift is a real failure mode,
  and every operator we've talked to wants UI-driven create / edit
  / disable for them. The protected-personas guard
  ([ADR-016](./0016-iam-role-mapping.md) §D4) still applies — non-
  admins POSTing to `lead-counsel` get a 403, surfaced in the
  modal's error area.

This ADR closes both gaps using the same modal + confirm patterns
ADR-023 established. No new architectural surface — pure
application of an existing pattern to two more resources.

---

## Decision

### D1 — Same modal + confirm-dialog pattern as C6.1

Each page gets:

- **`+ Register` / `+ Add` button** in the header → opens an inline
  create modal.
- **Per-row Edit button** → opens the same modal in edit mode
  (immutable fields shown but read-only).
- **Per-row Delete button** → confirm dialog before mutation.

Reuse `ConfirmDialogComponent` from ADR-023; the create/edit modals
remain inline per-page (forms diverge enough that a generic
abstraction would be more code than just inlining each).

### D2 — Role-mappings: dedicated enable/disable toggle, not lifecycle

Role mappings have a binary `enabled` flag, not a 4-state lifecycle
like capabilities. So instead of an in-row dropdown
([ADR-023](./0023-ops-console-editor-surfaces.md) §D4), the row
gets a single **Enable / Disable** button. Reasons:

- **High frequency.** Operators commonly toggle a mapping off
  during a security review or to pause a tenant; toggling back
  on is one click.
- **No accidental promotion.** Toggling enabled doesn't change
  *which* persona the rule grants — just whether the rule fires.
  The privilege-escalation guard sits on `runtimePersona` changes
  ([ADR-016](./0016-iam-role-mapping.md) §D4); enable/disable is
  safe.
- **Audit captures it.** Every toggle appends a row to
  `catalog_audit` per ADR-017; ops dashboards can show which
  operator paused which rule and why.

The full edit flow (priority, persona, description) goes through
the modal where the user has space to write a meaningful diff.

### D3 — MFE create vs edit: name is immutable

Like tenant id ([ADR-020](./0020-tenant-lifecycle.md) §D2), MFE
remote `name` is the FK target other catalog tables key on. Edit
shows it as static text; only `manifestUrl`, `version`,
`requiredHostVersion`, `exposes` are editable. Renaming an MFE is
clone-and-deprecate.

### D4 — `exposes` is JSON-text in the modal

The catalog stores `exposes` as JSONB
(`{"tools": ["bookFlight"], "widgets": [...]}`). The modal accepts
a JSON-text textarea + parses on submit. Reasons:

- **Future-proof.** New `exposes` keys (`actions`, `forms`, etc.)
  don't require modal changes.
- **Power-user friendly.** Operators copy-pasting from another
  remote's manifest get exact fidelity.
- **Same trade-off** as capability `body` JSON in ADR-023.

If real operators struggle with hand-writing the JSON, we'll add
key-pickers as a future enhancement. v1 keeps it simple.

### D5 — No new ADR for the patterns; this ADR just records the
extension

Every design decision here was already made in ADR-023 (modals
inline; reuse `ConfirmDialogComponent`; refresh on success;
client-side validation as sanity check; server is the truth). We
record this slice for traceability against the plan v3 milestone
("Ops Console becomes production-usable for self-hosters" — M4),
not because it introduces new architecture.

---

## Consequences

### Positive

- **Console is now editor-complete for catalog resources.** Every
  resource that has a CRUD endpoint has UI-driven create / edit /
  delete: tenants ✅ capabilities ✅ MFEs ✅ role mappings ✅. Audit
  + usage stay read-only by design (audit is append-only; usage
  events come from the runtime, not operators).
- **Unblocks production-usable ops console claim** in the v3 plan
  M4 milestone description.
- **6 new client-mutation tests** + a working build at 50/50
  ops-console pass rate (was 44).

### Negative / risks

- **No bulk surface in UI.** Bulk MFE / role-mapping import still
  needs `mvk` CLI or curl. Adopters with 100+ rules hand-roll;
  acceptable v1, fits the ADR-023 "scripted ops use the CLI"
  guidance.
- **JSON-text for exposes.** Beginner-hostile. Mitigated by
  copy-paste-from-other-remote workflow + the catalog's RFC 7807
  validation surfacing field-level errors in the modal.

### Out of scope (deferred)

- **Per-resource history panels.** Show audit-chain entries for a
  single MFE / role-mapping. The audit page already does
  tenant-wide views; per-entity timeline lands in C6.2 or
  alongside SSE-driven activity feeds.
- **Bulk import UI.** "Drop a JSONL file, hit upload." Useful;
  defer until adopter feedback shows demand. The CLI already
  handles bulk import for capabilities.
- **Schema-aware exposes editor.** Key-picker with autocomplete
  + per-key array editor. Defer.

---

## Implementation summary

`platform/agentic-ops-console/src/app/services/catalog-client.service.ts`
— 6 new mutation methods:

| Method | HTTP |
|---|---|
| `createMfe(input)` | `POST /v1/catalogs/{tenant}/mfes` |
| `patchMfe(name, patch)` | `PATCH /v1/catalogs/{tenant}/mfes/{name}` |
| `deleteMfe(name)` | `DELETE /v1/catalogs/{tenant}/mfes/{name}` |
| `createRoleMapping(input)` | `POST /v1/catalogs/{tenant}/role-mappings` |
| `patchRoleMapping(id, patch)` | `PATCH /v1/catalogs/{tenant}/role-mappings/{id}` |
| `deleteRoleMapping(id)` | `DELETE /v1/catalogs/{tenant}/role-mappings/{id}` |

`mfes.component.ts` — adds register button, create/edit modal, per-
row edit + delete actions, confirm dialog for destructive ops.

`role-mappings.component.ts` — adds add button, create/edit modal,
per-row enable/disable toggle, edit + delete actions, confirm
dialog.

Tests:
- 6 new client-mutation tests using `provideHttpClientTesting`.
- Existing ops-console tests untouched.

Total: ops-console 50/50, platform 636/636.
