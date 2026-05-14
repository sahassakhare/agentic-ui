import { inject, Injectable, signal } from '@angular/core';
import { DashboardRegistry, PersistenceRegistry, type DashboardDef } from '@infra-tools/agentic-ui';

const COMMITTED_KEY = 'ediscovery.committed-dashboards';

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
 *   joins the persisted picker AND writes a copy to
 *   `PersistenceRegistry` so the entry survives reload. On next
 *   boot, `rehydrateCommittedDashboards()` reads the persisted set
 *   back in and re-registers them.
 * - **Dismiss** — clears the proposal; the banner disappears.
 *
 * Single-slot store (only one proposal pending at a time). A new
 * `proposeDashboard` call replaces the previous proposal.
 */
@Injectable({ providedIn: 'root' })
export class ProposedDashboardStore {
  private readonly registry = inject(DashboardRegistry);
  private readonly persistence = inject(PersistenceRegistry);

  private readonly adapter = this.persistence.get('localStorage') ?? this.persistence.get('memory');

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
   * reads from) + persist it so the entry survives reload. Tagged with
   * `source: 'user'` so it sits alongside the host (`'host'`) and
   * MFE-contributed (`'remote:<name>'`) entries — adopters can later
   * `removeBySource('user')` to wipe all user commits without touching
   * the seeded ones.
   */
  commit(): DashboardDef | null {
    const def = this._proposal();
    if (!def) return null;
    const stamped: DashboardDef = { ...def, source: 'user' };
    this.registry.register(stamped);
    void this.persistCommitted(stamped).catch(() => { /* swallow — runtime registry still has it */ });
    this._proposal.set(null);
    return stamped;
  }

  /**
   * Add a single committed def to the persisted list. Reads the
   * existing list, dedups by name (most-recent wins), writes back.
   */
  private async persistCommitted(def: DashboardDef): Promise<void> {
    if (!this.adapter) return;
    const raw = (await this.adapter.read(COMMITTED_KEY)) as DashboardDef[] | undefined;
    const existing = Array.isArray(raw) ? raw : [];
    const next = [...existing.filter((d) => d.name !== def.name), def];
    await this.adapter.write(COMMITTED_KEY, next);
  }

  /**
   * Boot-time hook. Reads the persisted set + re-registers each entry
   * into DashboardRegistry with `source: 'user'`. Called once from
   * `bootAgenticCapabilities()` AFTER host-side registrations + BEFORE
   * the picker first reads — so the user's saved dashboards appear in
   * the same render pass.
   */
  async rehydrateCommittedDashboards(): Promise<void> {
    if (!this.adapter) return;
    const raw = (await this.adapter.read(COMMITTED_KEY)) as DashboardDef[] | undefined;
    if (!Array.isArray(raw)) return;
    for (const def of raw) {
      try {
        const stamped: DashboardDef = def.source === 'user' ? def : { ...def, source: 'user' };
        this.registry.register(stamped);
      } catch { /* dup */ }
    }
  }

  /** Test/admin helper — wipe all user-committed dashboards. */
  async clearCommittedDashboards(): Promise<void> {
    if (!this.adapter) return;
    await this.adapter.remove(COMMITTED_KEY).catch(() => { /* noop */ });
    this.registry.removeBySource('user');
  }
}
