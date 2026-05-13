import { inject, Injectable, signal } from '@angular/core';
import { DashboardRegistry, type DashboardDef } from '@infra-tools/agentic-ui';

/**
 * Signal-backed store for an agent-proposed `DashboardDef` pending
 * user review. The `proposeDashboard` tool the LLM picks builds a
 * draft `DashboardDef` and pushes it here; the /dashboards page
 * surfaces a banner with **Preview** / **Commit** / **Dismiss**
 * actions.
 *
 * - **Preview** — the canvas renders the proposed def in-place
 *   without committing. The picker on the left rail keeps its
 *   current selection so the user can compare.
 * - **Commit** — registers the def into `DashboardRegistry` so it
 *   joins the persisted picker (and federates symmetrically with
 *   the host's other dashboards — same `removeBySource` semantics).
 * - **Dismiss** — clears the proposal; the banner disappears.
 *
 * Single-slot store (only one proposal pending at a time). A new
 * `proposeDashboard` call replaces the previous proposal.
 */
@Injectable({ providedIn: 'root' })
export class ProposedDashboardStore {
  private readonly registry = inject(DashboardRegistry);

  private readonly _proposal = signal<DashboardDef | null>(null);
  readonly proposal = this._proposal.asReadonly();

  /** Stash the agent's proposed dashboard. Overwrites any prior pending proposal. */
  propose(def: DashboardDef): void {
    this._proposal.set(def);
  }

  /** Drop the proposal without registering. */
  dismiss(): void {
    this._proposal.set(null);
  }

  /**
   * Register the proposal into `DashboardRegistry` (where the picker
   * reads from) and clear the pending state. The registered def
   * stays addressable by its `name` — the /dashboards picker shows
   * it alongside the host + MFE-contributed entries.
   */
  commit(): DashboardDef | null {
    const def = this._proposal();
    if (!def) return null;
    this.registry.register(def);
    this._proposal.set(null);
    return def;
  }
}
