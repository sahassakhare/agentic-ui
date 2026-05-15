import { inject, Injectable } from '@angular/core';
import { PersistenceRegistry } from '../../registries/persistence-registry';
import { LayoutMigratorChain } from '../migration';
import type { VersionedEntry } from '../migration/types';
import {
  LAYOUT_TIER,
  type LayeredReadResult,
  type LayoutTier,
} from './types';

/**
 * ADR-046 D2 + D3 — durable, precedence-aware multi-tier storage for
 * layout / dashboard entries. Wraps the `PersistenceRegistry` adapter
 * machinery (Phase A/B/C) with:
 *
 *  - **Tier resolution.** Reading walks tiers in declared order;
 *    the first hit wins for that tier-precedence query. `readAll(name)`
 *    returns one result per tier that has the entry, letting callers
 *    inspect override stacks ("org has v1, user has v3 — let me see
 *    both").
 *  - **Schema migration.** Every read passes through
 *    `LayoutMigratorChain.migrate()` (D7) so old persisted entries
 *    surface at the lib's current schema.
 *  - **Write gating.** A tier's optional `canWrite()` predicate gates
 *    persistence — useful for "user can't write to org-default tier"
 *    semantics.
 *  - **Scoped keys.** Tiers with a `scope()` discriminator fold the
 *    current scope value into the storage key, so per-user / per-
 *    matter / per-tenant entries don't collide.
 *
 * Lives at the *store* layer — `LayoutResolver` inputs read from
 * this store to surface their layer's contribution. The audit chain
 * (D4) reads `tier.id` from `LayeredReadResult` for attribution.
 */
@Injectable({ providedIn: 'root' })
export class LayeredLayoutStore {
  private readonly persistence = inject(PersistenceRegistry);
  private readonly tiers = inject(LAYOUT_TIER);
  private readonly migrator = inject(LayoutMigratorChain);

  /** Tiers in registration order — useful for debug / audit. */
  listTiers(): readonly LayoutTier[] {
    return this.tiers;
  }

  /**
   * Read the entry from the highest-precedence tier that has it.
   * Returns null if no tier carries it. The result includes the
   * source tier so consumers know which layer answered.
   *
   * Precedence here is *declaration order* — the host's
   * `provideLayoutTiers([...])` array decides the lookup priority.
   * Typical wiring: user-saved → matter-default → org-default.
   */
  async read<T extends VersionedEntry>(name: string): Promise<LayeredReadResult<T> | null> {
    for (const tier of this.tiers) {
      const found = await this.readTier<T>(tier, name);
      if (found !== null) return { value: found, tier };
    }
    return null;
  }

  /**
   * Read the entry from every tier that has it. Order matches
   * `listTiers()` — highest-precedence first.
   */
  async readAll<T extends VersionedEntry>(name: string): Promise<readonly LayeredReadResult<T>[]> {
    const results: LayeredReadResult<T>[] = [];
    for (const tier of this.tiers) {
      const found = await this.readTier<T>(tier, name);
      if (found !== null) results.push({ value: found, tier });
    }
    return results;
  }

  /**
   * Read from a single named tier. Returns null if the tier has no
   * adapter registered or no entry at that key.
   */
  async readFromTier<T extends VersionedEntry>(tierId: string, name: string): Promise<T | null> {
    const tier = this.tiers.find((t) => t.id === tierId);
    if (!tier) return null;
    return this.readTier<T>(tier, name);
  }

  /**
   * Write the entry to the named tier. Throws when the tier's
   * `canWrite()` predicate denies, or when the named adapter isn't
   * registered (which usually indicates a wiring bug — surface it
   * rather than silently swallow).
   */
  async writeToTier(tierId: string, name: string, value: VersionedEntry): Promise<void> {
    const tier = this.tiers.find((t) => t.id === tierId);
    if (!tier) {
      throw new Error(`[LayeredLayoutStore] tier "${tierId}" is not registered.`);
    }
    if (tier.canWrite && !tier.canWrite()) {
      throw new Error(`[LayeredLayoutStore] tier "${tierId}" is read-only for the current scope.`);
    }
    const adapter = this.persistence.get(tier.adapterName);
    if (!adapter) {
      throw new Error(
        `[LayeredLayoutStore] tier "${tierId}" requests adapter "${tier.adapterName}" ` +
        `but PersistenceRegistry has no adapter with that name.`,
      );
    }
    await adapter.write(this.keyFor(tier, name), value);
  }

  /** Remove the entry from one tier. No-op if missing. */
  async removeFromTier(tierId: string, name: string): Promise<void> {
    const tier = this.tiers.find((t) => t.id === tierId);
    if (!tier) return;
    if (tier.canWrite && !tier.canWrite()) {
      throw new Error(`[LayeredLayoutStore] tier "${tierId}" is read-only for the current scope.`);
    }
    const adapter = this.persistence.get(tier.adapterName);
    if (!adapter) return;
    await adapter.remove(this.keyFor(tier, name));
  }

  // ── internals ──

  private async readTier<T extends VersionedEntry>(tier: LayoutTier, name: string): Promise<T | null> {
    const adapter = this.persistence.get(tier.adapterName);
    if (!adapter) return null;
    const raw = await adapter.read(this.keyFor(tier, name));
    if (raw === undefined || raw === null) return null;
    return this.migrator.migrate(raw as VersionedEntry) as T;
  }

  private keyFor(tier: LayoutTier, name: string): string {
    const scope = tier.scope ? tier.scope() : null;
    if (scope) return `${tier.namespace}:${scope}:${name}`;
    return `${tier.namespace}:${name}`;
  }
}
