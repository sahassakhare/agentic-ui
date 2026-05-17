# User-built, persona-scoped, federated dashboards

> **Status:** ships in v1.2.x (P3.A of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **ADR:** [0044](../adr/0044-dashboard-registry.md) · **Pattern:** §3 Pillar 3

A dashboard in this lib isn't a pre-computed report or a SQL-against-a-warehouse view. **Every tile is a tool call** (or a `DataSource` query, or static props) — and that means every dashboard inherits persona scope, the audit chain, MFE federation, ops-console listing, and explainability for free. None of those properties exist in Tableau / PowerBI / Looker, because none of them have a tool-call substrate underneath.

This cookbook walks the canonical flow: register a dashboard → drop the canvas onto a route → wire drill-down and explain handlers → ship an MFE-contributed template.

## 1. Register a dashboard

```ts
import { inject } from '@angular/core';
import { DashboardRegistry } from '@infra-tools/agentic-ui';

const dashboards = inject(DashboardRegistry);

dashboards.register({
  name: 'matter-health',
  title: 'Matter health',
  description: 'Daily snapshot of open holds, production status, and audit integrity',
  layout: 'two-col',                               // looked up in LayoutRegistry

  tiles: [
    {
      id: 'open-holds',
      slot: 'primary',
      title: 'Open holds',
      component: 'countTile',                       // a registered widget
      invocation: { kind: 'tool', tool: 'countOpenHolds', args: { matterId: 'M-117' } },
      refreshOn: 'event',
      drilldown: { route: '/holds?status=open' },
      explainable: true,
    },
    {
      id: 'production-stage',
      slot: 'primary',
      title: 'Production stage',
      component: 'lifecycleTile',
      invocation: { kind: 'tool', tool: 'currentProductionStage', args: { matterId: 'M-117' } },
    },
    {
      id: 'audit-integrity',
      slot: 'sidebar',
      title: 'Audit integrity',
      component: 'integrityTile',
      invocation: { kind: 'tool', tool: 'auditIntegrityScore', args: { matterId: 'M-117' } },
      drilldown: { route: '/audit' },
      explainable: true,
    },
  ],

  filters: [
    { id: 'matter', argKey: 'matterId', value: 'M-117', label: 'Matter' },
  ],

  schedule: 'hourly-dashboard-refresh',           // a registered TriggerDef
  version: 'v1',
  owner: 'paralegal-team',
  lifecycle: 'published',
});
```

The registry handles the rest — `setScopePolicy` filters per persona, `removeBySource` reaps it when its origin unloads, the catalog registrar auto-POSTs it to the ops console.

## 2. Drop the canvas on a route

```ts
import { Component, computed, inject } from '@angular/core';
import {
  DashboardCanvasComponent,
  DashboardRegistry,
  type CanvasTileDrilldown,
  type CanvasTileExplain,
} from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-matter-health-page',
  imports: [DashboardCanvasComponent],
  template: `
    <mvk-dashboard-canvas
      [dashboard]="dashboard()"
      (drilldown)="onDrilldown($event)"
      (explain)="onExplain($event)" />
  `,
})
export class MatterHealthPage {
  private readonly registry = inject(DashboardRegistry);
  private readonly router = inject(Router);
  private readonly chat = injectAgenticChat();

  readonly dashboard = computed(() => this.registry.get('matter-health') ?? null);

  onDrilldown(ev: CanvasTileDrilldown): void {
    if (ev.target.route) {
      this.router.navigateByUrl(ev.target.route);
    } else if (ev.target.tool) {
      this.chat.sendMessage(`Run ${ev.target.tool} for ${JSON.stringify(ev.target)}`);
    }
  }

  onExplain(ev: CanvasTileExplain): void {
    // The agent already knows which tile the value came from — pipe it as context.
    this.chat.sendMessage(
      `Explain the "${ev.tileId}" tile on the matter-health dashboard. ` +
      `Current value: ${JSON.stringify(ev.value)}`,
    );
  }
}
```

That's it. The canvas:

- Resolves the `LayoutDef` from `LayoutRegistry` (or uses the inline value).
- Renders one `.slot` per declared slot of the layout, in declared order.
- Pins each tile into its declared slot (multiple tiles stack inside a slot).
- Routes tiles whose `slot` isn't in the layout to a clearly-marked fallback group — typos in `TileDef.slot` never break the whole dashboard.
- Threads `filters[i].value` into every `kind: 'tool'` tile's args at invocation time (per `FilterDef.argKey`).
- Bubbles drilldown + explain events from each tile up to the route.

## 3. Persona scope is automatic

Each `<mvk-dashboard-tile>` reads from `ToolRegistry.get(tile.tool)` for tool tiles and `ComponentRegistry.get(tile.component)` for the renderer. Both apply `setScopePolicy`. The unauthorised stub — *"Unavailable for your role"* — replaces the tile in-place, preserving the layout grid.

That means **one dashboard, six personas, six legitimately different views** — no admin work, no template forks, no per-persona dashboard catalogs.

```ts
// Junior reviewer's setup
provideActivePersona({ id: 'junior-reviewer' });
tools.setScopePolicy((tool) =>
  tool.scopes?.includes('junior-reviewer') ?? true,
);
// → 'auditIntegrityScore' tile renders as "Unavailable"
// → 'countOpenHolds' tile renders with the count
// → 'currentProductionStage' tile renders the stage widget
```

## 4. Three invocation kinds

The plan ([§3 Pillar 3 D3](../plans/post-chat-surfaces-plan.md)) keeps the tile shape deliberately boring — every tile is *one of three*:

| `invocation.kind` | Use when | Audit |
|---|---|---|
| `tool` | The value comes from invoking a registered tool. Re-fired on refresh. | Chain-hashed each call. |
| `data` | The value comes from a registered `DataSourceDef`. Re-queried on refresh. | No audit-chain entry per re-query (DataSources aren't chain-hashed; use `tool` when audit matters). |
| `static` | The tile renders props verbatim — headers, blurbs, non-data context. | None. |

Adding a new tile kind = registering a new widget. No bespoke tile component zoo.

## 5. Refresh strategies

Each tile picks one:

| `refreshOn` | Fires on... |
|---|---|
| `'load'` *(default)* | First render |
| `'manual'` | The tile's Refresh button, or programmatic `componentRef.refresh()` |
| `'interval'` | First render + every `cacheTtlMs` |
| `'event'` | First render + every change to the canvas's `refreshTick` (via the "Refresh" button at the top, or via the parent route signalling) |

The canvas's "↻ Refresh" button increments the shared tick — so a dashboard built from a mix of `event` tiles all reload together.

## 6. Filters thread automatically

`DashboardDef.filters` is the cross-cutting "global params" surface. A `matterId` filter writes into every tool tile's args under the key `argKey`. Tile-level args win on collision, so a tile can override the dashboard filter for its own concerns without forking.

```ts
filters: [
  { id: 'matter', argKey: 'matterId', value: 'M-117', label: 'Matter' },
  { id: 'window', argKey: 'days', value: 30, label: 'Window' },
],
```

The chips render in the canvas header so users see which filters are active. Filter mutation is host-controlled (hosts wire chip click → update the `DashboardDef.filters` array → re-register the new version).

## 7. MFE remotes contribute templates

A `production` MFE remote can register `DashboardDef`s alongside its tools and widgets in its capability module:

```ts
// in the production MFE remote
defineCapabilityModule({
  name: 'production',
  tools: [createProductionTool, ...],
  widgets: [throughputChartWidget, ...],
  // Custom slot: extension point for MFE-contributed dashboard templates
  install(host) {
    host.inject(DashboardRegistry).register({
      name: 'production-throughput',
      title: 'Production throughput',
      source: 'remote:production',
      layout: 'two-col',
      tiles: [
        { id: 'weekly', slot: 'primary', title: 'Weekly throughput',
          component: 'throughputChartWidget',
          invocation: { kind: 'tool', tool: 'weeklyThroughput', args: {} } },
        { id: 'qc-bottleneck', slot: 'sidebar', title: 'QC bottleneck',
          component: 'qcBottleneckCard',
          invocation: { kind: 'tool', tool: 'qcBottleneckReport', args: {} } },
      ],
    });
  },
});
```

On host boot the remote loads, registers its tools + widgets + dashboard. On unload, `removeBySource('remote:production')` reaps all three symmetrically — same teardown mechanism as the existing 16 registries.

## 8. Optional: bind a cron schedule

```ts
import { TriggerRegistry } from '@infra-tools/agentic-ui';

inject(TriggerRegistry).register({
  name: 'hourly-dashboard-refresh',
  description: 'Refresh dashboards every hour during business hours',
  kind: 'cron',
  spec: { kind: 'cron', expression: 'every 60 minutes' },
  target: { kind: 'action', action: 'refresh-canvas' },
  runAs: 'paralegal',
});
```

Wire `provideTriggerRunner({ onAction })` to forward the action → call the canvas's `refreshAll()` (e.g., via a route-level signal that the canvas binds to `[refreshTick]` indirectly through `refreshOn: 'event'`). The dashboard then refreshes on schedule + on manual click.

## 9. What this version of dashboards does NOT do

Per [ADR-044 §"Out of scope"](../adr/0044-dashboard-registry.md#neutral--out-of-scope):

- **Drag-resize, drag-reorder.** Slated for P3.A.2 polish — uses CDK drag-drop and `PersistenceRegistry` layout-overrides to persist; not in this slice.
- **Conversational composition** (`proposeDashboard(intent)` LLM tool). Lands as P3.B.
- **Tile-level cache TTL across instances.** Each tile maintains its own cache; cross-instance dedupe is a P3.C concern.
- **Multi-user collaborative editing.** Out of scope. The catalog server handles versioning; two simultaneous edits create branching versions, not a conflict-resolution UI.
- **Exports** (PDF, image snapshot). Adopters wire them as Actions; not a registry concern.
- **Public / link-shared dashboards.** Out of scope; would require tenant-isolation-aware persona resolution that doesn't exist in the runtime today.

## 10. Reference

- **ADR:** [0044 — DashboardRegistry](../adr/0044-dashboard-registry.md)
- **Registry:** `DashboardRegistry` (17th registry; standard `register / list / signal / removeBySource / setScopePolicy`)
- **Types:** `DashboardDef`, `TileDef`, `TileInvocation`, `TileRefreshTrigger`, `TileDrilldown`, `FilterDef`
- **Components:**
  - `<mvk-dashboard-tile [tile] [refreshTick] (drilldown) (explain) />` — one-tile renderer with loading/error/persona-blocked states
  - `<mvk-dashboard-canvas [dashboard] (drilldown) (explain) />` — full dashboard, composes tiles into the resolved layout's slots, threads filters, exposes refresh-all
- **Tests:** 4 registry specs + 15 tile specs + 14 canvas specs (33 P3.A specs in total)
- **Plan:** [post-chat-surfaces-plan §3 Pillar 3](../plans/post-chat-surfaces-plan.md#pillar-3--user-defined-dashboards-dashboardregistry)
- **Related:**
  - [Agent-directed workspace layouts (ADR-043)](./agent-directed-workspace-layouts.md) — the slot machinery the canvas reuses
  - [Proactive triggers + Inbox](./proactive-triggers-and-inbox.md) — `DashboardDef.schedule` binds a `TriggerDef`
