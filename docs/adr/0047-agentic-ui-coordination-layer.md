# ADR-047 — Agentic-UI Coordination Layer: closing the self-serve ↔ agent gap

**Status:** Proposed · **Date:** 2026-05-15 · **Decider:** sahas
**Supersedes:** none · **Related:** ADR-046 (LayeredLayoutEngine), ADR-009 (Approval intercept), ADR-044 (DashboardRegistry), ADR-043 (LayoutRegistry promotion)

## Context

ADR-046 shipped the *infrastructure* — `LayoutResolver` precedence engine (D1), per-turn agent context block (D5), layered storage (D2+D3), audit chain (D4), template catalog (D6), schema migration (D7). The pieces are in the lib + wired in the eDiscovery flagship.

A gap analysis after PR4 surfaced a coordination problem: the lib has all the layers, but **the user and the agent can't fluidly hand off**. Either the agent drives (via `setWorkspaceLayout`) or the user accepts the default; there's no shared idiom for *"I like most of this but tweak the footer"* or *"apply the privilege-review template + my saved preference on top"*.

Concrete examples that fail today:

- A reviewer types *"add a chain-of-custody footer to my current workspace"*. The agent must re-emit the **whole** SlotMap — the user's pinned `sidebar` gets clobbered. There's no slot-level edit tool.
- A reviewer clicks "Save my layout" — there is no button. `WorkspaceLayoutStore.set()` writes on every change but only when the agent emits.
- The reviewer asks *"apply the privilege-review-v3 template"*. The agent doesn't know that template exists — `LayoutTemplateRegistry` is in the lib but not in the agent's tool surface.
- The reviewer clicks **Reset** — falls back to one level. They can't say *"reset to my saved pref but keep the org default"*.
- The reviewer sees *"Agent-driven layout active"* — but **when** did the agent set it? Who? The audit chain has attribution; the banner doesn't surface it.
- The agent emits a layout. The reviewer is currently dragging a tile (in a hypothetical future drag-builder). What wins? No conflict resolution.

The seven gap families surfaced during analysis:

| Family | Symptom | Impact |
|---|---|---|
| **A. User preference capture** | No "save this", no template "apply" button, no per-route prefs, single-level reset | User has to ask the agent for everything → friction |
| **B. Agent intervention depth** | Whole-map emit only, no template awareness, no slot edits, applies without approval | Agent is too coarse to coexist with user state |
| **C. Coordination + governance** | No attribution in UI, no undo, no diff, no conflict UX | Users can't trust what they see |
| **D. Context enrichment** | Agent sees route + persona + current-layout — missing selection, templates, override-stack, alerts, recent activity | Agent reasons in the dark |
| **E. Dashboard self-serve depth** | No tile builder, no cross-dashboard linking, no in-place tile add/remove | Dashboards lag layouts in flexibility |
| **F. Auditability surfacing** | Chain captures everything; UI shows almost nothing | D4 work invisible to end users |
| **G. Schema evolution UX** | Silent migrations | OK for now; revisit if migrations cause user confusion |

Constraint: ADR-010 D4 holds. Every change is additive — `setWorkspaceLayout` semantics preserved, existing user-saved entries continue to work.

## Decision

Eight decisions. Each one is its own seam — adopters can take any subset.

### D1 — Slot-level edit tools (replace `setWorkspaceLayout`-as-only-verb)

`setWorkspaceLayout` is preserved. Three new agent tools land alongside, each one operating on a single slot:

```ts
addLayoutSlot({ slot: 'footer', component: 'chainOfCustody', size?, props? })
removeLayoutSlot({ slot: 'sidebar' })
replaceLayoutSlot({ slot: 'primary', component: 'documentPreview', size?, props? })
```

Each reads the *current resolved layout*, applies the slot edit, and writes the modified SlotMap into the existing `WorkspaceLayoutStore` (the agent layer). Effect:

- *"Add a chain-of-custody footer"* → agent picks `addLayoutSlot({ slot: 'footer', component: 'chainOfCustody' })`. User's primary + sidebar untouched.
- *"Drop the audit panel"* → `removeLayoutSlot({ slot: 'audit' })`.

Implementation lives in the demo (tools are app-specific). The lib gains a small `SlotEditor` helper that wraps the read-modify-write pattern atomically so multiple tools share the logic.

### D2 — Template-aware tools

Two new agent tools:

```ts
listLayoutTemplates({ tags?, state? }) → [{ name, title, description, tags, parameters }]
applyLayoutTemplate({ name, params? }) → applies the template's body to WorkspaceLayoutStore
```

(Mirror tools for dashboards: `listDashboardTemplates` + `applyDashboardTemplate`.)

`listLayoutTemplates` only returns `approvalState === 'approved'` by default — same gate the user-facing picker uses. Lets the agent recommend (*"I see a privilege-review-v3 template — apply it?"*) without exposing unapproved templates.

### D3 — Context block enrichment

Five new built-in `ContextContributor`s in the lib, each opt-in via `provideAgentContext({ extraContributors: [...] })`:

```xml
<context>
  <route>/documents</route>
  <persona>lead-counsel</persona>
  <current-layout>...</current-layout>

  <!-- New in D3: -->
  <selection type="document" count="3">
    <doc id="..." privileged="candidate" />
  </selection>
  <available-templates>
    <template name="privilege-review-v3" tags="privilege" approval="approved" />
  </available-templates>
  <override-stack>
    <layer source="user-saved">...</layer>
    <layer source="matter-default">...</layer>
    <layer source="org-default">...</layer>
  </override-stack>
  <recent-tool-calls>
    <call timestamp="..." tool="tagDocuments" />
  </recent-tool-calls>
  <matter id="..." phase="review" />
</context>
```

- `SelectionContextContributor` reads from a new `SelectionStore` (D7 below).
- `AvailableTemplatesContextContributor` reads from `LayoutTemplateRegistry.approved()` + `DashboardTemplateRegistry.approved()`.
- `OverrideStackContextContributor` reads from `LayeredLayoutStore.readAll(name)` for the current named layout.
- `RecentToolCallsContextContributor` reads from an adopter-bound `RecentToolCallSignal` (limit ~10).
- `MatterContextContributor` reads from an adopter-bound `MatterContextSignal` (id + phase).

Half the agent-side gaps collapse once the context block carries this — the agent can recommend templates by name, preserve user overrides, context-switch on selection, anticipate workflow shifts.

### D4 — User-side affordances on `/workspace` and `/dashboards`

Three small UI additions, each surfacing infrastructure that already exists in the lib:

1. **"📌 Save as my preference"** button on the workspace agent-banner. Snapshots the current `LayoutResolver.active()` slots into the `user-saved` tier via `LayeredLayoutStore.writeToTier('user-saved', '<routeKey>', { schemaVersion, slots })`.
2. **"✨ Apply"** button on each approved template card on `/dashboards` (and `/workspace` if we add a template picker there). Opens a parameter form if the template has params, then either:
   - Layout templates → write the resolved SlotMap into `WorkspaceLayoutStore` (agent layer — gets surfaced as a user-driven layout the user can then save to user-saved tier).
   - Dashboard templates → register the materialized DashboardDef into `DashboardRegistry`.
3. **"Save as template"** affordance — promotes a user-saved layout to a draft `LayoutTemplate`. Goes through the approval workflow for tenant / matter visibility.

### D5 — Reset hierarchy

The single **Reset** button becomes a menu:

- *Reset to my saved* — clears the agent layer; resolver falls back to user-saved tier next.
- *Reset to matter default* — clears agent + user-saved tiers.
- *Reset to org default* — clears agent + user-saved + matter-default tiers.
- *Reset to lib default* — clears everything; falls back to the hardcoded route rule.

Each option is a discrete tier-clear via `LayeredLayoutStore.removeFromTier()`. Lib ships the helper; demo wires the menu.

### D6 — Change attribution banner

Replaces *"Agent-driven layout active"* with attribution-aware text:

```
✓ Set by Marcus Webb (lead-counsel) 12 min ago — via setWorkspaceLayout
✓ Saved by you 2 days ago — pinned to user-saved tier
✓ Org default published 2026-04-12 by Sarah Chen
```

Reads from `LayoutAuditTracker.chain()` — picks the latest event that *materially set* the current state. Attribution fields already captured in PR3 D4; banner just surfaces them.

### D7 — `SelectionStore` + `SelectionLayoutInput`

Selection — the user clicked a document, multi-selected three custodians, picked a hold — is a first-class signal in the resolver. Lib ships:

```ts
@Injectable({ providedIn: 'root' })
export class SelectionStore {
  readonly selection = signal<SelectionState | null>(null);
  set(selection: SelectionState | null): void;
  clear(): void;
}

export interface SelectionState {
  readonly kind: 'document' | 'custodian' | 'hold' | 'production' | string;
  readonly ids: readonly string[];
  readonly metadata?: Record<string, unknown>;
}
```

Plus a `SelectionLayoutInput` that fires `LayoutRule`s based on selection shape:

```ts
// In app.config
provideLayoutResolver({
  selectionRules: [
    { kind: 'document', minCount: 1, maxCount: 1, slots: { primary: 'documentPreview', sidebar: 'tagPanel' } },
    { kind: 'document', minCount: 2, slots: { primary: 'multiDocPreview', sidebar: 'bulkActions' } },
  ],
})
```

Adopters bind their selection-tracking code to `SelectionStore.set()` — clicking a row in the documents table calls it; clearing on navigation calls `clear()`.

This is the foundation that unblocks context-driven without-prompt switching (the canonical *"click a doc → workspace pivots to preview + tags"* flow).

### D8 — Approval gate for sensitive layout changes (deferred to a follow-up PR)

When a layout change touches matter-default or org-default tier (i.e. crosses the "publish for others" line), the change should route through `ApprovalRegistry` before applying. Deferred to a separate PR because:

- Reviewer + approver UI surface is non-trivial.
- The existing `ApprovalRegistry` semantics don't quite fit (it's per-tool-call; this is per-layout-write).
- The catalog approval workflow (PR4 D6) already provides this for templates — we may converge on that pattern rather than reinventing.

Documented here so the gap is named; implementation tracked separately.

## Consequences

**Adoption is still incremental.** Each decision is its own seam:
- Adopters who only want template tools take D2.
- Adopters who want full self-serve preference capture take D4 + D5 + D6.
- The full coordination story is D1+D2+D3+D4+D5+D6+D7.

**Lib surface grows ~30 KB.** Estimated breakdown: D1 ~50 LOC (SlotEditor helper), D2 0 (demo-side), D3 ~250 LOC (4 new contributors + SelectionStore), D7 ~150 LOC (store + input). Plus tests. Stays inside the 720 KB cap with current ~32 KB headroom.

**Existing demo wiring extends, doesn't replace.** PR1 wiring kept; new tools register alongside `setWorkspaceLayout` + `proposeDashboard`. The /workspace banner reuses the existing reset-button slot — menu replaces single button. /dashboards templates section gains an "Apply" button on each card.

**ADR-010 D4 holds.** All additions are net-new tools, signals, and UI affordances. Existing consumers see no diff.

## Alternatives considered

### A. Make `setWorkspaceLayout` accept a sparse SlotMap (slot-level edit via flag)

**Discarded.** The current Zod schema validates a complete SlotMap; relaxing it to allow `{ slot: 'footer', component: 'X', merge: true }` would conflate "set" with "edit" semantics. Three distinct tools (`addLayoutSlot` / `removeLayoutSlot` / `replaceLayoutSlot`) read better in the agent's tool catalog — clearer intent → fewer ambiguous calls.

### B. Auto-detect "save my preference" from a stable layout state

**Discarded.** "Has been the same for N seconds" is a fragile heuristic. Explicit user action (button click) keeps the intent unambiguous + auditable. The button is small UI work — not worth replacing with cleverness.

### C. Defer D7 SelectionStore — let adopters wire selection via `extraInputs`

**Discarded.** Selection is so central to *every* agentic-UI case (which docs the user picked, which custodians they multi-selected) that shipping a lib primitive saves every adopter from rolling their own. The `extraInputs` escape hatch stays available for app-specific signals.

### D. Combine D5 reset hierarchy into a single "Reset" with a long-press / right-click menu

**Discarded for UX consistency.** Long-press / right-click are platform-inconsistent (mobile / desktop / accessibility). A visible button → dropdown menu pattern matches the rest of the demo's controls.

### E. Surface attribution via tooltip on the existing banner

**Discarded for discoverability.** Tooltips hide info — for compliance contexts, the attribution should be visible on the banner itself.

## Implementation plan

Single PR closing the full set (D1–D7; D8 deferred). Sequenced:

1. **Lib** — `SelectionStore` + `SelectionLayoutInput` (D7).
2. **Lib** — Four new `ContextContributor`s + the tokens they read from (D3).
3. **Lib** — `SlotEditor` helper on the resolver (D1 server-side).
4. **Demo** — Three slot-edit tools + two template tools (D1 + D2 demo-side).
5. **Demo** — `/workspace` UI: Save button, Reset menu, Attribution banner (D4 + D5 + D6).
6. **Demo** — `/dashboards` UI: Apply button on template cards (D4 dashboard side).
7. **Tests** — Lib specs for SelectionStore + new contributors.
8. **Build + commit + push.**

## Open questions

1. **Selection lifetime** — when the user navigates away, does the selection clear? **Tentative:** yes — adopters explicitly call `selectionStore.clear()` on `NavigationEnd`. Cookbook documents.
2. **Template parameter UI shape** — modal form vs inline panel vs slide-over. **Tentative:** modal for v1 (smallest footprint), revisit if telemetry shows users dropping out at parameter step.
3. **Attribution staleness threshold** — when is an attribution "too old to surface"? **Tentative:** show always; cap the rendered string at "more than 30 days ago" → "older than a month".
4. **Save-as-template scope** — only user-tier promotion, or also matter-default → org-default? **Tentative:** v1 ships user → tenant (any approved template); matter-scoped promotion is a follow-up.

## Out of scope

Explicitly NOT in this ADR:

- D8 approval gate (documented above as deferred).
- Drag-and-drop tile builder (separate UI workstream).
- Multi-user co-presence on a workspace.
- Undo/redo for layout changes (chain is the data; UI is its own task).
- Version diff UI for templates / dashboards.
- Conflict resolution between concurrent agent and user edits (rare; LWW for v1).
- Cross-dashboard tile drilldown.

## Status

**Proposed.** Implementation tracked as a single PR sequence below this ADR.
