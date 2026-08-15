/**
 * Dashboard host kit for the Experience Hub.
 *
 * Mirrors how workflows work: the catalog Experience does NOT embed the tile
 * graph — it flags itself `tags: ['dashboard']` and `requires` the tile
 * components + datasources (so the ExperiencePlanner validates + access-gates
 * them). The concrete `DashboardDef` (layout + tiles) is host-shipped here and
 * looked up by `experience.name`. Register at boot via `registerDashboards()`.
 *
 * Local datasources are stub adapters returning canned data so the grid renders
 * out of the box; production swaps in real `DataSourceDef`s of the same name.
 */
import { Component, inject } from '@angular/core';
import { z } from 'zod';
import {
  agenticWidget,
  DashboardRegistry, LayoutRegistry, DataSourceRegistry,
  type ComponentDef, type DashboardDef, type LayoutDef, type DataSourceDef,
} from '@infra-tools/agentic-ui';
import { KpiStatWidget, BarChartWidget, DataTableWidget } from './dashboard-widgets';

// ── Tile widgets registered into ComponentRegistry (seeded via provideAgenticUi) ──
const tileProps = z.object({}).passthrough(); // tiles pass `{ value }`; keep it verbatim
const w = (name: string, component: unknown): ComponentDef =>
  agenticWidget({ name, component: component as never, propsSchema: tileProps });

/** Dashboard tile widgets — pass alongside the journey widgets to provideAgenticUi. */
export const dashboardWidgets: readonly ComponentDef[] = [
  w('kpi-stat', KpiStatWidget),
  w('bar-chart', BarChartWidget),
  w('data-table', DataTableWidget),
];

// ── Layout ────────────────────────────────────────────────────────────────
// `<mvk-dashboard-canvas>` reads only `LayoutDef.slots` (it renders one
// `<mvk-dashboard-tile>` per slot). `component` is required by the type but
// never mounted by the canvas — a 1-line placeholder satisfies it.
@Component({ selector: 'hub-grid-slots', template: '<ng-content />' })
export class GridSlotsLayout {}

const opsGridLayout: LayoutDef = {
  name: 'ops-overview-grid',
  description: 'Responsive KPI / chart / table grid',
  slots: ['kpis', 'charts', 'table'],
  component: GridSlotsLayout,
};

// ── Stub datasources (local canned data) ────────────────────────────────────
const userDirectory: DataSourceDef = {
  name: 'user-directory',
  kind: 'rest',
  adapter: (query: unknown) => {
    const q = (query ?? {}) as { metric?: string; groupBy?: string };
    if (q.groupBy === 'team') {
      return [
        { label: 'Engineering', value: 128 },
        { label: 'Sales', value: 74 },
        { label: 'Support', value: 41 },
        { label: 'Finance', value: 22 },
        { label: 'People', value: 16 },
      ];
    }
    // default: a KPI count
    return { label: 'Active users', value: 281, delta: 4.2 };
  },
};

const expensePolicy: DataSourceDef = {
  name: 'expense-policy',
  kind: 'rest',
  adapter: (query: unknown) => {
    const q = (query ?? {}) as { recent?: number; metric?: string };
    if (q.metric === 'pending') return { label: 'Pending approvals', value: 12, delta: -8 };
    return {
      columns: ['Employee', 'Amount', 'Category', 'Status'],
      rows: [
        { Employee: 'A. Rivera', Amount: '$1,240', Category: 'Travel', Status: 'Approved' },
        { Employee: 'J. Chen', Amount: '$86', Category: 'Meals', Status: 'Pending' },
        { Employee: 'M. Okafor', Amount: '$540', Category: 'Software', Status: 'Approved' },
        { Employee: 'S. Patel', Amount: '$2,110', Category: 'Travel', Status: 'Review' },
        { Employee: 'L. Novak', Amount: '$300', Category: 'Training', Status: 'Approved' },
      ].slice(0, q.recent ?? 20),
    };
  },
};

const dataSourceDefs: readonly DataSourceDef[] = [userDirectory, expensePolicy];

// ── Dashboards (name === experience.name) ────────────────────────────────────
const opsOverview: DashboardDef = {
  name: 'ops-overview',
  title: 'Operations Overview',
  description: 'Live tenant operations at a glance',
  layout: 'ops-overview-grid',
  tiles: [
    { id: 'active-users', slot: 'kpis', title: 'Active Users', component: 'kpi-stat',
      invocation: { kind: 'data', source: 'user-directory', query: { metric: 'count' } },
      refreshOn: 'interval', cacheTtlMs: 30000 },
    { id: 'pending-expenses', slot: 'kpis', title: 'Pending Approvals', component: 'kpi-stat',
      invocation: { kind: 'data', source: 'expense-policy', query: { metric: 'pending' } } },
    { id: 'users-by-team', slot: 'charts', title: 'Users by Team', component: 'bar-chart',
      invocation: { kind: 'data', source: 'user-directory', query: { groupBy: 'team' } } },
    { id: 'recent-expenses', slot: 'table', title: 'Recent Expenses', component: 'data-table',
      invocation: { kind: 'data', source: 'expense-policy', query: { recent: 20 } }, explainable: true },
  ],
};

const dashboardDefs: readonly DashboardDef[] = [opsOverview];

/**
 * Register the dashboard host kit into the root registries. Mirrors
 * `registerCatalog()` — called from an `provideAppInitializer` at boot.
 * (`LayoutRegistry` / `DashboardRegistry` / `DataSourceRegistry` are
 * `providedIn: 'root'`; there is no provideXxx factory for them.)
 */
export function registerDashboards(): void {
  const layouts = inject(LayoutRegistry);
  const dashboards = inject(DashboardRegistry);
  const sources = inject(DataSourceRegistry);
  layouts.register(opsGridLayout);
  for (const ds of dataSourceDefs) sources.register(ds);
  for (const d of dashboardDefs) dashboards.register(d);
}
