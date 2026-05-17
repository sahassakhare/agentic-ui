import { inject, Injectable, signal } from '@angular/core';
import { DashboardRegistry, PersistenceRegistry, type DashboardDef } from '@infra-tools/agentic-ui';

const COMMITTED_KEY = 'ediscovery.committed-dashboards';

/**
 * Parse `vN` → numeric N for sort/compare. Returns 0 for unset or
 * unparseable strings — un-versioned legacy entries thus sort below
 * `v1`, which is the intended ordering (a re-commit of an un-versioned
 * entry becomes `v1`, not `v?`).
 */
function versionNum(v: string | undefined): number {
  if (!v) return 0;
  const m = /^v(\d+)$/.exec(v);
  return m ? parseInt(m[1], 10) : 0;
}

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

  /**
   * Full version chain of every user-committed dashboard, keyed by
   * `def.name`. Phase B keeps the entire history (not just the latest)
   * so adopters can show a "v3 of 5 — see previous versions" affordance
   * on the dashboards picker. Newest version last in each array.
   */
  private readonly _history = signal<Record<string, DashboardDef[]>>({});
  readonly history = this._history.asReadonly();

  /** Convenience — version chain for a specific dashboard name. Oldest first. */
  historyFor(name: string): readonly DashboardDef[] {
    return this._history()[name] ?? [];
  }

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
    // Phase B — auto-bump version on re-commit of the same name. The
    // proposing tool stamps `v1` by default; if a user-committed entry
    // already exists under this name, we override that to the next
    // version + chain `parentVersion` to the previous tip.
    const chain = this.historyFor(def.name);
    const previousTip = chain[chain.length - 1];
    const nextVersion = `v${versionNum(previousTip?.version) + 1}`;
    const stamped: DashboardDef = {
      ...def,
      source: 'user',
      version: nextVersion,
      parentVersion: previousTip?.version,
    };
    this.registry.register(stamped);
    // Update in-memory history signal in the same tick so consumers
    // (e.g. a "v2 of 2" badge in the picker) re-render synchronously.
    this._history.update((h) => ({ ...h, [stamped.name]: [...chain, stamped] }));
    void this.persistCommitted(stamped).catch(() => { /* swallow — runtime registry still has it */ });
    this._proposal.set(null);
    return stamped;
  }

  /**
   * Append a committed def to the persisted list. Phase B keeps the
   * FULL chain (every version) rather than dedup-by-name — that's how
   * we can later restore the version-edit history. Read-modify-write
   * race is acceptable here: commits are user-driven (one at a time).
   */
  private async persistCommitted(def: DashboardDef): Promise<void> {
    if (!this.adapter) return;
    const raw = (await this.adapter.read(COMMITTED_KEY)) as DashboardDef[] | undefined;
    const existing = Array.isArray(raw) ? raw : [];
    const next = [...existing, def];
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
    // Phase B — the persisted list is the FULL version chain (every
    // commit, all versions). Group by name + sort ascending so the
    // last entry per name is the highest version, then register that
    // one (the picker shows latest). The in-memory `_history` signal
    // captures the full chain so a "v3 of 5" affordance has the data
    // to show prior versions.
    const grouped = new Map<string, DashboardDef[]>();
    for (const def of raw) {
      const stamped: DashboardDef = def.source === 'user' ? def : { ...def, source: 'user' };
      const list = grouped.get(stamped.name) ?? [];
      list.push(stamped);
      grouped.set(stamped.name, list);
    }
    const historySnapshot: Record<string, DashboardDef[]> = {};
    for (const [name, list] of grouped) {
      list.sort((a, b) => versionNum(a.version) - versionNum(b.version));
      historySnapshot[name] = list;
      const latest = list[list.length - 1];
      try {
        this.registry.register(latest);
      } catch { /* dup — replace policy means this can't actually throw, but be defensive */ }
    }
    this._history.set(historySnapshot);
  }

  /** Test/admin helper — wipe all user-committed dashboards. */
  async clearCommittedDashboards(): Promise<void> {
    if (!this.adapter) return;
    await this.adapter.remove(COMMITTED_KEY).catch(() => { /* noop */ });
    this.registry.removeBySource('user');
    this._history.set({});
  }
}
