# ADR-044 — `DashboardRegistry` for user-built, governed, federated dashboards

**Status:** Proposed · **Date:** 2026-05-13 · **Decider:** sahas
**Supersedes:** none · **Related:** ADR-002 (Layered registry system), ADR-008 (Registry scope policy), ADR-010 (Platform principles — no dashboards in the runtime by themselves), ADR-014 (Governance hooks: lifecycle / requiredHostVersion / tags / owner), [ADR-043](./0043-layout-registry-promotion.md) (LayoutRegistry promotion — supplies the LayoutDef this registry references), [ADR-045](./0045-trigger-registry.md) (TriggerRegistry — supplies the optional `DashboardDef.schedule` refresh), [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md) (P3 + Pillar 3)

## Context

The chat shell + the four P1 surfaces ([cmd-k palette](../cookbook/cmd-k-palette.md), [smart cells](../cookbook/smart-cell.md), [row action menus](../cookbook/row-action-menu.md), [bulk toolbars](../cookbook/bulk-toolbar.md), [assist panel](../cookbook/assist-panel.md)) cover *one* shape of agentic UI: the user works *with* a single record or list, the agent suggests or computes. They don't cover the *aggregate* surface — *"show me production throughput by week for the last quarter, broken down by reviewer, with chain-of-custody integrity"*.

That's a **dashboard**. And specifically a dashboard whose **tiles are tool calls** — not a precomputed report that goes stale, not a SQL query against a copy of the data, but the same tools the chat shell invokes, just rendered as cards on a grid.

Three things motivate making this a **first-class registry** instead of localStorage JSON or an app-specific feature:

- **The tile-as-tool-call property gives properties no dashboarding product can match.** Drill-down is a tool's drill-down arg. *"Why is this number high?"* is a tool's explainability. Time-travel ("show this dashboard as of last Friday") is the audit chain's replay. Persona scope filters tiles per-user without admin work. Tile updates from `<mvk-bulk-toolbar>` actions surface automatically. None of these exist in Tableau / PowerBI / Looker because none of them have a tool-call substrate underneath.
- **MFE remotes need to contribute dashboard templates** the same way they contribute tools and widgets today. A `production` MFE ships its `production-throughput` template alongside its tools; `removeBySource` symmetry holds. That requires registry mechanics, not JSON-in-a-bucket.
- **Governance comes for free.** [ADR-008](./0008-registry-scope-policy.md) persona scope, [ADR-014](./0014-governance-hooks.md) lifecycle / owner / tags, [ADR-032](./0032-catalog-capability-registrar.md) auto-registration, [ADR-033](./0033-catalog-capability-authorizer.md) catalog deny-list — all of those mechanics already work for `Registry<TDef>` entries. Promoting dashboards to a registry inherits them without per-feature reinvention.

The constraint: [ADR-010 D4](./0010-platform-principles-and-license.md) holds. The registry is purely additive; existing 16 registries (15 + `TriggerRegistry` from [ADR-045](./0045-trigger-registry.md)) see no diff. Apps that don't import `DashboardRegistry` pay nothing.

## Decision

Seven decisions. Together they add a 17th registry in the Extended tier, define the dashboard + tile shapes, layer MFE-contributed templates onto the existing federation seam, wire optional cron-driven refresh through `TriggerRegistry`, and stage the three flavour-deliverables of P3.

### D1 — `DashboardRegistry` is a 17th `RegistryBase<DashboardDef>` in the Extended tier

It joins `Action / Intent / Form / DataSource / Approval / Operation / Trigger` in the Extended tier ([ADR-002](./0002-layered-registry-system.md)). All standard machinery flows through — `register / list / signal / removeBySource / setScopePolicy` uniform with the other 16 registries. ~30 LOC of base-class extension.

The count goes 16 → 17. Adopters who don't import `DashboardRegistry` pay nothing — `providedIn: 'root'` factory ships as a tree-shakeable singleton.

### D2 — `DashboardDef` references LayoutDef + carries tiles + filters + schedule + source

```ts
interface DashboardDef extends RegistryEntry {
  readonly title: string;                       // user-visible
  readonly description?: string;
  readonly layout: LayoutDef | string;          // from LayoutRegistry — slot map
  readonly tiles: readonly TileDef[];           // ordered, indexed by slot
  readonly filters?: readonly FilterDef[];      // global params applied to every tile
  readonly schedule?: TriggerDef | string;      // optional refresh — TriggerRegistry entry
  readonly version?: string;                    // 'v3' — semver-ish
  readonly parentVersion?: string;              // chain to prior version
  readonly source?: 'user' | 'team' | string;   // user / team:<id> / mfe:<remote>
  // RegistryEntry inherits: name + scopes + lifecycle + tags + owner + requiredHostVersion
}
```

Three concerns separated: **layout** (where the tiles go), **tiles** (what's in each slot), **filters** (global parameters threaded through every tile call). The fourth concern — **schedule** — is optional and binds an ADR-045 `TriggerDef` so the dashboard refreshes on cron/webhook/queue. The fifth — **source** — drives sharing (D5) and `removeBySource` (D6).

`layout` can be either an inline `LayoutDef` ([ADR-043 D1](./0043-layout-registry-promotion.md#d1--layoutdef-extends-to-slot-based-composition)) or a string name resolved through `LayoutRegistry.get(name)`. Apps that ship reusable dashboard shapes register them as `LayoutDef`s; one-off compositions inline the layout.

### D3 — `TileDef` invocation is tool / data / static — one of three

```ts
interface TileDef {
  readonly id: string;
  readonly slot: string;                        // which LayoutDef slot
  readonly title: string;
  readonly component: string;                   // ComponentRegistry name
  readonly invocation:
    | { kind: 'tool';   tool: string;   args: Record<string, unknown> }
    | { kind: 'data';   source: string; query: Record<string, unknown> }
    | { kind: 'static'; props: unknown };
  readonly refreshOn?: 'load' | 'interval' | 'event' | 'manual';
  readonly drilldown?: { tool?: string; route?: string };
  readonly explainable?: boolean;
}
```

Deliberately boring. Every tile is *either* a tool call, *or* a data-source query, *or* static. Rendering is whatever component the registry maps. **Adding a new tile kind = registering a new widget in `ComponentRegistry`. That's it.** No bespoke tile component zoo; the existing `<mvk-widget-container>` mounts each tile after Zod-validating props against the component's schema.

The three kinds give clear semantics:

- **`tool`** — the tile re-invokes the tool on refresh. Chain-hashed each time. Persona scope applies via `ToolRegistry.get(tool)`. The natural drill-down target is a longer-form variant of the same tool.
- **`data`** — the tile re-queries the data source on refresh. No new audit-chain entry per re-query (DataSources aren't chain-hashed; tools are). Use this for plain reads where audit isn't load-bearing.
- **`static`** — the tile renders props verbatim. No refresh. The fallback for "headers", "context blurbs", non-data tiles in a layout.

### D4 — Persona scope filters tiles automatically; unauthorised tiles render explicit stubs, not 403s

Each tile's `component` goes through `ComponentRegistry.get()` and (for `kind: 'tool'`) the tile's `tool` goes through `ToolRegistry.get()`. Both apply `setScopePolicy`. If either returns `undefined`, the tile renders as a **`no-access` stub** ("This tile is unavailable for your role") — not a 403 error, not a silent disappear.

The stub is critical for the **shared-dashboard** experience: when GC shares their dashboard with a paralegal, tiles the paralegal can't see render as stubs *visible to the paralegal* — preserves the layout and signals to ask GC for access if needed. Silent-disappear would create confusing missing-tile gaps; 403s would treat a normal scope-filter event as an error.

### D5 — Sharing + versioning + governance through the `source` + `version` + `parentVersion` fields

Sharing a dashboard is sharing a `DashboardDef`. The `source` field carries the origin:

| `source` value | Semantics |
|---|---|
| `'user'` | The active user authored this dashboard. Stored in `PersistenceRegistry` under the user namespace. |
| `'team:<team-id>'` | A team-shared dashboard. Stored in the catalog server, propagated to every team member's `DashboardRegistry` at boot. |
| `'mfe:<remote-name>'` | An MFE-contributed template. Registered when the remote loads; unregistered when it unloads via `removeBySource` symmetry (D6). |

**Versioning** is `DashboardDef.version` + `parentVersion`. Edits create a new `DashboardDef` with the next version + a `parentVersion` link to the prior. The registry holds the version graph; rolling back is a registry write. This is the natural shape for a "playbook" subtype (P5 of the plan): a playbook is a versioned `DashboardDef` whose tiles are a sequence of tool invocations and the runtime fires them in order.

**Audit.** Every dashboard edit is a chain-hashed tool call: who added the "privilege-rate-by-reviewer" tile to the team dashboard, when, and what was its parent version. Same audit machinery as every other state mutation.

### D6 — MFE remotes contribute dashboard templates via `defineCapabilityModule`

A `production` MFE remote can register a `DashboardDef` alongside its tools and widgets:

```ts
// In the production remote's capability module
defineCapabilityModule({
  name: 'production',
  tools: [createProductionTool, ...],
  widgets: [throughputChartWidget, ...],
  dashboards: [
    {
      name: 'production-throughput',
      title: 'Production Throughput',
      source: 'mfe:production',
      layout: { name: 'dashboard-2col', ... },
      tiles: [
        { id: 'weekly', slot: 'primary', component: 'throughputChartWidget',
          invocation: { kind: 'tool', tool: 'weeklyThroughput', args: {} } },
        { id: 'qc-bottleneck', slot: 'sidebar', component: 'qcBottleneckCard',
          invocation: { kind: 'tool', tool: 'qcBottleneckReport', args: {} } },
      ],
    },
  ],
});
```

When the host loads this remote, the dashboard appears in *every user's* "Templates" list whose persona has access to the underlying tools. **No host-team PR.** Unload the remote and `removeBySource('mfe:production')` removes the dashboard with the tools — same symmetric teardown as today's 16 registries.

This is the architecturally interesting property: **dashboards become a federated capability**. Three teams ship three MFE remotes, each contributing its own dashboard templates. The host's `<mvk-dashboard-canvas>` sees them all.

### D7 — Optional cron refresh via `DashboardDef.schedule` binds to `TriggerRegistry`

`DashboardDef.schedule` is either an inline `TriggerDef` ([ADR-045 D2](./0045-trigger-registry.md#d2--triggerdef-carries-kind--spec--target--identity-attribution)) or a string name resolved through `TriggerRegistry.get(name)`. When set, the trigger fires on its schedule and the dashboard re-evaluates every `kind: 'tool'` tile.

Three properties from the trigger flow uniformly:

- The trigger's `runAs` ([ADR-045 D5](./0045-trigger-registry.md#d5--persona-attribution-via-triggerdefrunas)) determines the persona scope for the refresh. Different personas can have different schedules — a daily 9am refresh for the partner persona, hourly for the SRE persona.
- The audit chain captures the refresh as `origin: 'trigger'` ([ADR-045 D4](./0045-trigger-registry.md#d4--each-trigger-fire-is-a-chain-hashed-tool-call-with-origin-trigger)).
- Disable a refresh by setting the trigger's `lifecycle: 'disabled'`. The dashboard renders the latest cached values; users can manually re-run tiles individually.

For dashboards without `schedule`, tiles refresh on `refreshOn: 'load' | 'manual' | 'event'` per-tile.

## Consequences

### Positive

- **Dashboards become a first-class artefact with governance for free.** Persona scope, lifecycle toggles, MFE federation, audit chain — all inherited from `Registry<TDef>`. No per-dashboard admin surface to build.
- **Tile-as-tool-call gives properties no dashboarding product has.** Drill-down is a tool arg; explainability is a tool's explanation; time-travel is the audit chain's replay; cross-matter is the `filters` field threading through every tile.
- **MFE remotes ship dashboard templates as easily as they ship tools.** A new MFE remote means new tools + new widgets + new dashboards, all symmetrical via `removeBySource`.
- **Persona-aware automatically.** One `DashboardDef`, six personas, six legitimate views — partner sees the QC bottleneck tile; junior sees their queue stats; GC sees the audit integrity tile. Unauthorised tiles render as explicit stubs, not 403s.
- **The conversational flavour falls out cheaply.** `proposeDashboard(intent: string)` is one new tool (~100 LOC) that returns a `DashboardDef`. The LLM picks tiles + tools + data sources from already-registered entries. The user reviews + commits.
- **Playbooks reuse the same primitive.** A playbook is a versioned `DashboardDef` whose tiles are a sequence of tool calls. The runtime fires them in order, chain-hashing the playbook id as the parent. P5 lands as a `DashboardDef` subtype, not a new registry.
- **Catalog + ops console integration is free.** Same auto-registration ([ADR-032](./0032-catalog-capability-registrar.md)) and authorizer flow ([ADR-033](./0033-catalog-capability-authorizer.md)) as tools and widgets. The ops console shows every dashboard with its source, lifecycle, owner, and last edit.
- **Zero breaking changes.** Existing 16 registries see no diff. Apps without `DashboardRegistry` see no behaviour change. ADR-010 D4 held.

### Negative

- **Tile-as-tool-call is expensive when N tiles refresh together.** A dashboard with 12 tool tiles refreshing every minute = 12 tool calls per minute per concurrent user. Mitigation: tile-level `cacheTtlMs` on `TileDef.invocation` (P3.C ships this); `refreshOn: 'event'` for tiles that only update when a tool fires elsewhere.
- **Slot mismatches between `LayoutDef` and `TileDef.slot`.** A tile assigned to a slot the layout doesn't declare → silent drop or loud warning? **Decision (per the existing widget-container fail-soft pattern):** loud warning + render the tile in a fallback "unslotted" container at the bottom of the canvas. Matches the existing "unknown widget" fallback.
- **`source: 'team:<id>'` requires the catalog server**. Apps using `provideAgenticPlatform` get this for free. Apps without a catalog can still ship `user` + `mfe:*` dashboards — team sharing degrades gracefully to "you're alone with your dashboards".
- **Cross-matter filters' threading semantics need care.** `DashboardDef.filters.matterIds` should propagate into every `kind: 'tool'` tile's `args` automatically. Mitigation: an explicit `args.matterIds` merge step at tile invocation; documented in the cookbook so adopters know.
- **Edit-as-new-version explosion.** Heavy editors can produce hundreds of versions per dashboard per week. Mitigation: a `pruneOlderThan` lifecycle policy on the catalog side (out of scope for the runtime tier per ADR-010, lands in a separate server-side policy).

### Neutral / out of scope

- **Drag-resize, drag-reorder.** P3.A ships drag-place + resize using CDK drag-drop primitives. Resize gestures persist via `PersistenceRegistry` layout-overrides namespace ([ADR-043 D5](./0043-layout-registry-promotion.md#d5--user-overrides-land-in-persistenceregistry-under-a-layout-overrides-namespace)). Beyond that — snap grids, magnetic alignment, drag-shadow previews — is a P3 polish slice, not architecturally relevant.
- **Tableau-style "advanced calculations" tile.** Out of scope. Calculations happen in the tile's `tool` or `data` invocation; the registry holds the wiring, not the math.
- **Dashboard exports** (PDF, image snapshot). Adopters can wire them as Actions; not a registry concern.
- **Multi-user collaborative editing.** Two users editing the same `DashboardDef` simultaneously is a conflict-resolution story for the catalog server, not the runtime tier. P5 might revisit if playbook collaboration becomes a need.
- **Public / signed dashboard URLs.** Sharing-by-link with a JWT-scoped persona is a separate flow; lands in a future ADR if/when adopters ask for it.

## Alternatives considered

### A. localStorage JSON blobs

**Rejected.** Loses persona scope, audit chain, MFE federation, ops-console listing, catalog auto-registration. Every one of those would be reinvented per-app — at much higher cost than the ~30 LOC of base-class extension this ADR ships.

### B. Reuse `LayoutRegistry` for dashboards

**Rejected.** Layouts are *shapes*; dashboards are *content* in shapes. A `DashboardDef` references a `LayoutDef`, doesn't replace it. Conflating them would tie every dashboard to a unique layout (no shared-shape reuse) and overload `LayoutRegistry.list()` with two unrelated concerns.

### C. Tiles as a bespoke component type (not `ComponentRegistry` entries)

**Rejected.** Every tile is a widget; widgets are exactly what `ComponentRegistry` exists to register. Adding a separate `TileRegistry` would duplicate the persona scope machinery, the Zod prop validation, the MFE federation symmetry. The boring path — `tile.component` is a `ComponentRegistry` name — wins.

### D. No tile-level invocation; the tile's component fetches its own data

**Rejected.** Forecloses on the "tile-as-tool-call" properties (drill-down, explainability, audit replay). Pushes data-fetching into widget code where it can't be governed through the registry layer. Forces every tile widget to handle loading/error/stale state — boilerplate the registry knows how to do once.

### E. Per-tile schedule, no dashboard-level `schedule`

**Rejected for the common case.** Per-tile schedules force the adopter to repeat the same cron expression on every tile. Dashboard-level schedule keeps the simple case simple; per-tile `refreshOn: 'interval'` covers the few cases where tiles want different cadences than the dashboard's master refresh.

### F. Embed dashboard definitions in the LLM's system prompt

**Rejected.** Dashboards are governance artefacts (versioned, persona-scoped, MFE-contributed, audit-chained). Putting them in the system prompt loses every one of those properties. The LLM can *propose* a `DashboardDef` via the conversational flavour (P3.B) but the registered version goes through the same registry machinery as anything else.

## Implementation notes

Sequenced for P3 of the post-chat-surfaces plan (~3 weeks). Three flavour-slices land in order:

### P3.A — `DashboardRegistry` + drag-place builder (~1 week)

1. **`DashboardDef` + `TileDef` + `FilterDef` types** in `types/registry-defs.ts`. Mirror the `IntentTarget`-style discriminated union for `invocation`. ~120 LOC + Zod schemas.
2. **`DashboardRegistry` class** — ~30 LOC of base-class extension.
3. **`<mvk-dashboard-tile>` component** — wraps a `TileDef` in a slot, mounts via `<mvk-widget-container>`, handles loading + error + refresh button. ~150 LOC.
4. **`<mvk-dashboard-canvas>` component** — reads a `DashboardDef`, looks up its `LayoutDef`, renders tiles into slots via `<mvk-workspace-layout>` (from ADR-043). CDK drag-drop for resize + reorder. Resize persists via `PersistenceRegistry` `layout-overrides` namespace. ~400 LOC.
5. **`<mvk-dashboard-list>` component** — three sections (My / Team / Templates). ~120 LOC.
6. **Cookbook + Playwright.**

### P3.B — Conversational composition (~1 week)

1. **`proposeDashboard(intent: string)` tool** — agent-side. The LLM picks 3–6 tiles from `ComponentRegistry` (filtered by persona), wires each to a registered tool or data source, picks a `LayoutDef`. Returns a `DashboardDef`. ~100 LOC.
2. **Inline preview pane** — agent's draft renders in a preview before commit; edit-in-place. ~150 LOC.
3. **Commit-as-new-version flow** — the commit tool writes to `PersistenceRegistry` via `DashboardRegistry.register({ source: 'user', ...def })`.
4. **Cookbook.**

### P3.C — Live + queryable + drillable (~1 week)

1. **Tile drill-down + explain affordances.** Each tile carries `drilldown.tool` or `drilldown.route`. Click expands. Mostly free — chrome on `<mvk-dashboard-tile>`.
2. **Tile-level `cacheTtlMs`** on `TileDef.invocation`. ~80 LOC of cache + TTL machinery.
3. **Annotations** — right-click → "leave a note for the team". Note is a chain-hashed tool call. ~120 LOC.
4. **Time-travel** — replay a dashboard as of a past timestamp by replaying its `kind: 'tool'` invocations with the audit chain's frozen state. Server-side; not in the runtime ADR.
5. **MFE-contributed template demo** — one template per existing eDiscovery MFE (`production`, `review`, `search`). ~50 LOC each on the MFE side.

P3 exit criteria are §9 of the [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md#p3-dashboards--production-pipeline).

## Open questions

Decide before P3.A:

1. **Where do user-saved dashboards live by default?** `PersistenceRegistry` (browser localStorage) or via `provideAgenticPlatform` to the catalog? **Tentative:** localStorage for `source: 'user'`; catalog for `source: 'team:*'`. Apps without `provideAgenticPlatform` get localStorage-only dashboards; team sharing degrades gracefully.
2. **Tile cache invalidation.** When a tool fires (anywhere — chat, MCP, trigger, palette), should tiles whose `invocation.tool === firedToolName` invalidate their cache? **Tentative:** opt-in per-tile via `refreshOn: 'event'`; default `'interval'` or `'load'`.
3. **`proposeDashboard` LLM tool — sync or async?** The LLM round-trip is ~3–10s. **Tentative:** async with a streaming preview — tiles arrive one at a time as the LLM decides each.
4. **Dashboard versioning UI.** Show the version graph? **Tentative:** out of scope for P3; surface `version` + `parentVersion` in the ops console only.
5. **Tile-render persona stub copy.** *"This tile is unavailable for your role"* vs. *"Ask <owner> for access"* vs. silent omission. **Tentative:** the first; the second requires a request-access flow that's its own UX slice.
6. **Read-only dashboards (anonymous mode).** Public-share-with-anyone-who-has-the-link. **Out of scope** — would require a tenant-isolation-aware persona resolution that doesn't exist in the runtime today.
7. **Maximum tile count per dashboard.** Hard cap or soft warning? **Tentative:** soft warning at 30; hard cap none. Performance is the natural disincentive.

## Status

Proposed; awaiting ack on §1 plan goals + the open questions above. Once accepted, this ADR moves to `Status: Accepted (implementing)`. P3 implementation tracked in the post-chat-surfaces plan.

This closes the three-ADR set for the post-chat-surfaces program:

- [ADR-043 LayoutRegistry promotion](./0043-layout-registry-promotion.md) — Accepted (P0 library tier shipped)
- [ADR-045 TriggerRegistry](./0045-trigger-registry.md) — Proposed (P2 pre-req)
- **ADR-044 DashboardRegistry** — Proposed (P3 pre-req) — *this ADR*
