# ADR-036 · Ops console capability topology view

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-019](./0019-ops-console-design.md) · [ADR-027](./0027-catalog-sse-stream.md) · [ADR-030](./0030-ops-console-activity-feed.md) · [ADR-032](./0032-catalog-capability-registrar.md) · [ADR-035](./0035-runtime-sse-stream.md) · [Post-audit follow-ups plan §S1](../plans/post-audit-followups-plan.md#slice-s1--capability-graph-ops-console-topology-view)

---

## Context

The ops console gives operators per-entity views — capabilities table, MFE remotes table, role-mappings table, audit chain, usage aggregate, activity feed. Each table answers a single-entity question well. None answers the **cross-entity** question operators kept asking:

> "What's running where? Which MFE remote contributes which capability? Which capabilities are host-direct vs federated? Are any capabilities orphaned (in the catalog but no MFE owns them)?"

Today operators answer this by toggling between the capabilities and MFEs pages, mentally joining `body.source` to `mfes[].name`. With 50+ capabilities across 4+ remotes (the eDiscovery flagship's actual shape), that's tedious; with the planned 100+ tools across the ediscovery + future demos, it doesn't scale.

The post-audit follow-ups plan ([§S1](../plans/post-audit-followups-plan.md#slice-s1--capability-graph-ops-console-topology-view)) called for a "capability graph" — explicitly clarified during planning to mean a UI topology view in the ops console, not a programmatic graph API.

---

## Decision

### D1 — Tree view, not force-directed graph

The plan's S1 §Open questions called out vis-network vs. d3-force as the leading candidates. We ship a **tree view** instead — nested HTML `<details>` blocks, no graph library, ~0 KB of new dependencies.

Rationale:

- **The data is hierarchical**, not arbitrary. Tenant has-many MFEs and host-direct; each has-many capabilities by kind. A flat force-directed graph would visualize the same hierarchy with more pixels and less scannability.
- **Operators primarily ask "find this capability under this remote,"** not "show me the connectivity structure." A tree-view's depth-first scan answers the first question optimally; a force-directed view answers the second and is overkill for the first.
- **Bundle**: vis-network ≈ 120 KB. The tree view adds ~3 KB to ops-console.
- **Live updates trivially compose** with a tree (recompute the joined model on each event, signal swaps the view).
- **Force-directed can layer on later** as a route variant if adopters surface a real "I need to see edge density" use case. The data model in this slice doesn't constrain that.

### D2 — Three-level hierarchy: `tenant → group → kind → capability`

The render hierarchy:

1. **Tenant header** (single row showing tenant id + summary chips: total capabilities, total MFEs, host-direct count).
2. **Groups** — one per origin:
   - `Host-direct` (always first; capabilities with `body.source === 'host'`).
   - One per registered MFE remote (capabilities matching `body.source === mfe.name`).
   - `Orphan: <source>` for capabilities whose `body.source` doesn't match any registered MFE — surfaced explicitly so operators notice + can decide.
3. **Kind sub-blocks** within each group — `tool`, `component`, `form`, `action`, etc. — sorted alphabetically.
4. **Capability rows** — colored lifecycle dot (published/draft/deprecated/disabled), capability name (clickable → existing capabilities page with focus query param), tags, owner.

Each group is a `<details open>` so operators can collapse remotes they don't care about; state is per-page-load (no persistence — would be feature creep for slice 1).

### D3 — Source field defaults to `'host'` when missing (legacy seed compatibility)

Pre-ADR-032 seed rows didn't carry `body.source`. The component falls back to `'host'` when the field is absent so legacy seed entries land in the host-direct group instead of an empty "undefined" group. Tested explicitly.

### D4 — Live updates via existing `CatalogStreamService`

The component subscribes to `CatalogStreamService.onMutation` (the ops-console's existing SSE consumer, ADR-027) via the `autoStream` helper. Every catalog mutation triggers a full recompute via `refresh()`.

Rationale: the topology is small (current eDiscovery: 52 capabilities + 3 MFEs = 55 nodes). Recompute-everything is fast (<5 ms in measurements). Differential updates would be premature optimization with no measured benefit at current scale.

### D5 — Lifecycle filter as a signal — reactivity via `computed()`

The lifecycle filter is a signal, not a plain field. The `topology()` computed signal reads `lifecycleFilter()` so changing the filter automatically recomputes the rendered tree.

`[ngModel]` doesn't directly two-way bind to signals in Angular 21 (yet); we use `[ngModel]="lifecycleFilter()" (ngModelChange)="lifecycleFilter.set($event)"`. Once Angular ships proper signal-aware `ngModel`, this can simplify.

### D6 — Click capability → existing capabilities page with focus query param

Capability rows link to `/capabilities` with `queryParams: { focus: cap.id }`. The capabilities page can highlight the focused row + auto-scroll on mount.

(Honoring the focus param is a separate small enhancement to the capabilities page; this ADR doesn't ship it. Even without honoring, the link provides navigation; with honoring, navigation + visual continuity.)

### D7 — Catalog list cap raised to 1000 for the topology view

The catalog list endpoints default to `limit: 100`. For the topology view, operators want **all** capabilities so the tree is complete. We pass `limit: 1000` explicitly.

If a tenant exceeds 1000 capabilities, pagination kicks back in. The tree view degrades to "first 1000" with a warning chip — out-of-scope for slice 1; not seen at any current adopter scale.

---

## Consequences

### Positive

- **Single visual answer to "what's running where."** Operators replace mental joins across 2–3 tabs with one scrollable view.
- **Orphan detection.** Capabilities whose `source` doesn't match any registered MFE land in an `Orphan: <source>` group, surfacing seed/registration mistakes that previously were invisible.
- **Live updates for free.** Reuses `CatalogStreamService` from ADR-030 — no new SSE infrastructure on the ops-console side.
- **Zero new dependencies.** Tree-view rendering is plain HTML/CSS + Angular signals.
- **Cheap to extend.** Adding persona-scope or dependency views later means an axis-toggle, not a new viz library.

### Trade-offs

- **No edge visualization** between capabilities (e.g. a tool that references a data source). Tree-view can't show those relationships. If/when adopters need that view (for "what breaks if I remove X"), a separate route can ship a force-directed view sharing the same data fetch.
- **No layout persistence** — every page-load shows all groups expanded. Acceptable for slice 1; sticky open-state via localStorage is a 5-line follow-up if anyone asks.
- **Lifecycle filter is binary at top level** — capability lifecycle, but not "show me only `tags: ['eDiscovery']`" or "show me only `owner: legal-platform-team`." Filter chips per-tag are obvious next steps; current scope is single-axis.

### Out-of-scope

- **Persona scope view** (capabilities × personas via role mappings). Plan §S1 noted this as a follow-up; the data is in `RoleMappings` already, so a future axis toggle is mechanical.
- **Dependency view** (tools → data sources, components → declared dataSources). Same — separate axis-toggle slice.
- **Force-directed alternative** as a route variant. Plan §S1 vis-network discussion — defer until edge-density visualization becomes a real ask.
- **Honoring the `?focus=<id>` query param on the capabilities page.** Small enhancement; ships separately.
- **Orphan auto-cleanup** — operators see orphans but the tree only shows them. PATCH/DELETE happens through the existing capabilities page.

---

## Verification

- [`platform/agentic-ops-console/src/app/pages/topology.component.ts`](../../platform/agentic-ops-console/src/app/pages/topology.component.ts) — the route component (~370 LOC including styles).
- [`topology.component.spec.ts`](../../platform/agentic-ops-console/src/app/pages/topology.component.spec.ts) — 4 unit tests:
  - Host + per-MFE grouping with kind sub-grouping.
  - Orphan capability surfacing (source not matching any MFE).
  - Lifecycle filter narrows the visible set.
  - Legacy seed rows (no `body.source`) fall back to host-direct.
- Route registered at `/topology`; nav item added to the shell sidebar.

## Status snapshot

- ops-console tests: 59 → 63 (+4)
- catalog tests: 165 (unchanged)
- lib tests: 453 (unchanged)
- mvk-cli tests: 53 (unchanged)
- **Total: 734/734 passing**
- ops-console production build: clean.
