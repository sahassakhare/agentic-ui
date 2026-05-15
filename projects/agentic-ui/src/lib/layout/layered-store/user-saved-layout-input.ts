import {
  effect,
  inject,
  Injectable,
  InjectionToken,
  signal,
  type Signal,
} from '@angular/core';
import type { LayoutInput, LayoutInputSource, LayoutRule } from '../resolver/types';
import type { SlotMap } from '../types';
import { LayeredLayoutStore } from './layered-layout-store';

/**
 * Persisted shape of a user-saved layout. Mirrors the schema-versioned
 * envelope `LayoutMigratorChain` expects on read.
 */
export interface UserSavedLayoutEntry {
  readonly schemaVersion: number;
  readonly slots: SlotMap;
}

/**
 * Adopter-supplied factory returning a signal that resolves to the
 * **key** the resolver should look up in the user-saved tier on each
 * recompute. Typically the active route or a per-route + per-persona
 * key like `workspace:<personaId>`. When the signal returns null the
 * input emits no rules.
 *
 * Keeping it adopter-supplied means hosts decide their key strategy
 * (per-route, per-persona, per-matter, per-feature). The lib doesn't
 * impose a naming convention.
 */
export const USER_SAVED_LAYOUT_KEY = new InjectionToken<Signal<string | null>>(
  'USER_SAVED_LAYOUT_KEY',
  { factory: () => signal(null).asReadonly() },
);

/**
 * ADR-047 D4 / architecture-critique §2.1 — closes the loop on
 * "📌 Save as my preference". `LayeredLayoutStore.writeToTier('user-saved',
 * key, { schemaVersion, slots })` persists the user's pinned layout;
 * this input reads it back on resolver recompute.
 *
 * Without this input, the Save button is write-only — the entry sits
 * in the user-saved tier but no `LayoutRule` feeds it back to the
 * resolver. With it, saved preferences become a live precedence layer
 * (weight 800 by default, beating matter-default at 600).
 *
 * Read is async — the input maintains a small `signal<SlotMap | null>`
 * that an `effect()` populates whenever the key signal fires. The
 * resolver's `computed()` reads the latched signal synchronously; the
 * adapter read happens off the main thread.
 */
@Injectable({ providedIn: 'root' })
export class UserSavedLayoutInput implements LayoutInput {
  readonly id = 'user-saved';
  readonly source: LayoutInputSource = 'user-saved';

  private readonly store = inject(LayeredLayoutStore);
  private readonly keySignal = inject(USER_SAVED_LAYOUT_KEY);

  /**
   * Cached slots — populated by the effect below whenever the key
   * signal changes. `evaluate()` reads this synchronously. The
   * resolver's reactivity comes through this signal (effect updates
   * it → computed re-runs).
   */
  private readonly _slots = signal<SlotMap | null>(null);
  private lastKey: string | null = null;

  private readonly _watcher = effect(() => {
    const key = this.keySignal();
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (!key) {
      this._slots.set(null);
      return;
    }
    // Fire-and-forget the async read. The signal update at the end
    // triggers a resolver recompute when the value lands.
    void this.store
      .readFromTier('user-saved', key)
      .then((entry) => {
        if (this.lastKey !== key) return;  // key changed mid-flight
        const slots = (entry as UserSavedLayoutEntry | null | undefined)?.slots;
        this._slots.set(slots ?? null);
      })
      .catch(() => this._slots.set(null));
  });

  evaluate(): readonly LayoutRule[] {
    const slots = this._slots();
    if (!slots || Object.keys(slots).length === 0) return [];
    return [
      {
        id: `user-saved:${this.lastKey ?? 'unknown'}`,
        source: this.source,
        slots,
        reason: `user-saved layout for "${this.lastKey ?? 'unknown'}"`,
      },
    ];
  }
}
