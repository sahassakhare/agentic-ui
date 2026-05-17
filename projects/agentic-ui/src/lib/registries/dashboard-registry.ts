import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { DashboardDef } from '../types/registry-defs';

/**
 * Registry of first-class dashboards — `DashboardDef` entries with
 * tiles, layout reference, optional global filters, and optional
 * cron-driven refresh.
 *
 * Joins the Extended tier alongside `TriggerRegistry`, `ActionRegistry`,
 * `IntentRegistry`, etc. Same `register / list / signal /
 * removeBySource / setScopePolicy` machinery as the other 16 registries
 * — ~30 LOC of base-class extension.
 *
 * Three things this registry mechanic gives you for free that
 * localStorage-JSON would not:
 *
 * - **Persona scope** via `setScopePolicy`. Junior reviewer's tile-
 *   filter results in fewer tiles visible; same scope policy the chat-
 *   shell tool list honours.
 * - **MFE-contributed templates** via `removeBySource`. A `production`
 *   remote registers its `production-throughput` template; unloads —
 *   `removeBySource('remote:production')` reaps it with the tools.
 * - **Ops-console listing** via the catalog registrar
 *   ([ADR-032](../../../../docs/adr/0032-catalog-capability-registrar.md)) —
 *   shows every dashboard alongside tools + widgets + triggers, with
 *   the same `lifecycle: 'disabled'` deny-list toggle.
 *
 * @see [ADR-044 — DashboardRegistry](../../../../docs/adr/0044-dashboard-registry.md)
 */
@Injectable({ providedIn: 'root' })
export class DashboardRegistry extends RegistryBase<DashboardDef> {
  protected readonly registryName = 'dashboard';
}
