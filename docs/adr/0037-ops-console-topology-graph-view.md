# ADR-037 · Ops console topology graph view (OpenShift-style)

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-036](./0036-ops-console-topology-view.md) (tree view) · [ADR-027](./0027-catalog-sse-stream.md) · [Plan §TG](../plans/semantic-search-agent-registry-opa-plan.md#slice-tg--topology-view-visual-graph-upgrade-openshift-style)

---

## Context

[ADR-036](./0036-ops-console-topology-view.md) shipped the topology view as a **tree of nested `<details>` blocks** — fast to ship, zero new dependencies, scan-friendly. The ADR called it out: *"Force-directed can layer on later as a route variant if adopters surface a real 'I need to see edge density' use case."*

That ask landed within hours: *"need visual graphs like OpenShift not only text."* The reference is OpenShift's developer-perspective topology page — colored shapes for services, compound containers grouping related workloads, force-directed layout, click-to-drill-down side panel.

This ADR adds the visual view **alongside** the tree view (not replacing it), per the post-audit follow-ups [§TG](../plans/semantic-search-agent-registry-opa-plan.md#slice-tg--topology-view-visual-graph-upgrade-openshift-style).

---

## Decision

### D1 — Cytoscape.js, not vis-network or D3-force

Three viable libraries:

| Library | Bundle | Why we considered it | Why rejected |
|---|---|---|---|
| **vis-network** | ~120 KB | Mature, simple API | No SVG; canvas-only. Compound nodes work but feel bolted-on. |
| **D3-force + custom render** | ~50 KB | Smallest | Have to write everything (drag, zoom, hover, side panel, clustering). |
| **Cytoscape.js** | ~150 KB + cose-bilkent ~15 KB | First-class **compound nodes**, SVG, mature in graph-data-viz space (used by OpenShift's Cilium Hubble integration), `cose-bilkent` layout matches the OpenShift look-and-feel | +30 KB over vis-network is worth the cleaner API |

We pick **Cytoscape.js + cytoscape-cose-bilkent**. Compound nodes (visual containers around grouped children) is exactly the OpenShift "group of related workloads" pattern, and `cose-bilkent` is the layout that respects compound boundaries best.

The chunk is **lazy-loaded** — only fetched when an operator navigates to `/topology/graph`. Initial bundle unchanged from pre-S1.

### D2 — Both views coexist; tree stays as the default `/topology`

- `/topology` — existing tree view (ADR-036). Default. Fast to scan when looking up a specific name.
- `/topology/graph` — new graph view. Toggle button on each route to swap.

The tree view loads ~3 KB; the graph view loads ~166 KB. Operators who want a quick name lookup don't pay the graph cost.

### D3 — Cytoscape compound nodes for source-grouping

Each capability becomes a child node of a compound parent:

- `Host-direct` compound (always present when filter=all) — children are `body.source: 'host'` capabilities.
- One compound per registered MFE remote — children are matching-source capabilities.
- `Orphan: <source>` compound — children are capabilities whose source matches no registered MFE.

Compound nodes render as bordered boxes around their children; cose-bilkent respects them (children stay inside; layout is compound-aware).

### D4 — Visual encoding

| Field | Encoding |
|---|---|
| Lifecycle | Node fill color: published green / draft amber / deprecated grey / disabled red. Same palette as the tree-view dots. |
| Kind | Node shape: tool=ellipse, component=hexagon, form=diamond, action=rectangle, datasource=octagon, others=tag. |
| MFE status | Compound border color: active=green, degraded=amber, inactive=red. |
| Capability source missing | Falls back to `host` (per ADR-036 D3 — legacy seed compatibility). |

Color palette and dot/chip definitions match the tree view exactly so the same operator's visual vocabulary works on both.

### D5 — Layout: cose-bilkent default; auto-fallback for large graphs

Cose-bilkent is force-directed with compound-node support — visually closest to OpenShift. For graphs above 200 nodes, the force-directed layout slows to ~1 s per recomputation. We auto-fall-back to `concentric` (rings) above that threshold. Users can also click "⟳ Relayout" to recompute manually.

Animation is enabled below 100 nodes (looks polished); disabled above (avoids stutter).

### D6 — Live updates via the existing `CatalogStreamService`

Same SSE consumer the tree view uses (and the activity feed). On every `mutation` event, the shared `TopologyDataService` re-fetches; the graph component's `effect()` watches the elements computed from that data and rebuilds the cy instance. Re-layout fires automatically.

`TopologyDataService` was extracted in this slice from the tree view's `refresh()` so both views share one paginated fetch.

### D7 — Side panel for selected node

Click a node → side panel slides in from the right with full metadata:

- **Capability**: kind, lifecycle (with dot), owner, tags, source, created-at + a "Edit in capabilities page" button (deep-link via `?focus=<id>`).
- **MFE remote** (group): kind, status (chip), version, manifest URL + an "Edit in MFEs page" button.
- **Host-direct group**: explanation text.
- **Orphan group**: explanation + a warning to register the missing remote or delete the rows.

Clicking the close button (×) clears the selection. Clicking another node replaces the panel content.

### D8 — Mobile not supported in this slice

Force-directed graphs on <768 px viewports are hostile (pinch-zoom + drag fights with browser scroll). For now, the tree view is the right default for mobile. A media-query redirect from `/topology/graph` to `/topology` on narrow viewports is a small follow-up.

### D9 — Test seam: `buildGraphElements` is a pure function

The hardest-to-mock piece (cytoscape canvas + DOM + ResizeObserver) doesn't need testing — Cytoscape itself is tested upstream. What we test is **our data → element mapping**: `buildGraphElements(capabilities, mfes, filter): ElementDefinition[]`. Pure function, exported, 8 unit tests covering grouping, lifecycle/kind encoding, filter, orphan handling, status colors, NodeMeta preservation.

---

## Consequences

### Positive

- **Visual answer to "what's the shape?"** — operators see the topology, not a flat list.
- **OpenShift-grade compound grouping** — host-direct + per-MFE compounds show ownership at a glance.
- **No initial-bundle impact** — graph chunk lazy-loaded; tree view stays the default.
- **Reuses existing infrastructure** — same `TopologyDataService`, same `CatalogStreamService` for live updates, same color palette as the tree view.
- **Pure-function test seam** — the data-mapping logic is easy to test without a DOM.

### Trade-offs

- **+165 KB lazy chunk** — material for the `/topology/graph` route only. Tree view unaffected.
- **CommonJS `cytoscape-cose-bilkent`** — adds a `allowedCommonJsDependencies` entry to `angular.json`. Minor bundle-optimization warning silenced.
- **Cose-bilkent slows above 200 nodes** — concentric fallback handles it, but interactivity degrades. Mitigation: at adopter scale beyond 200 capabilities, ship layered/dagre layout as a third option.
- **Mobile still not supported** — same as the tree view. Follow-up.

### Out-of-scope

- **Persona scope view + dependency view** — same as ADR-036's out-of-scope list. Future axis-toggles.
- **Mobile-friendly redirect** — small follow-up; not blocking.
- **Visual-regression tests** — heavy infra; would need playwright + screenshot pipeline. Defer.
- **Edge labels** — currently all edges are simple parent-child compound containment. If/when we add cross-compound edges (e.g. "tool T uses data source D"), labels become useful.

---

## Verification

- [`platform/agentic-ops-console/src/app/pages/topology-graph.component.ts`](../../platform/agentic-ops-console/src/app/pages/topology-graph.component.ts) — the route component (~370 LOC including styles + `buildGraphElements`).
- [`topology-graph.component.spec.ts`](../../platform/agentic-ops-console/src/app/pages/topology-graph.component.spec.ts) — 8 unit tests on the pure `buildGraphElements` helper.
- [`topology-data.service.ts`](../../platform/agentic-ops-console/src/app/services/topology-data.service.ts) — extracted shared data layer; tree view refactored to consume it.
- Route: `/topology/graph` (tree view at `/topology` keeps the default).
- Production build clean; lazy chunk ≈ 165 KB.

## Status snapshot

- ops-console tests: 63 → 71 (+8 graph)
- catalog tests: 165 (unchanged)
- lib tests: 453 (unchanged)
- mvk-cli tests: 53 (unchanged)
- **Total: 742/742 passing**
- New deps: `cytoscape ^3.33`, `cytoscape-cose-bilkent ^4.1`. Zero impact on the runtime FESM (ops-console only).
