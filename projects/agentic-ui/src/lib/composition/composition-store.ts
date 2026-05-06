import { Injectable, InjectionToken, signal, type Signal } from '@angular/core';

/**
 * Injection token carrying the **composition slot key** for a section
 * widget mounted by `<mvk-form-renderer>` in composition mode.
 *
 * Section widgets that participate in the AC-F1-2 contract inject this
 * via `inject(COMPOSITION_SLOT, { optional: true })` and use the value as
 * their key into the {@link CompositionStore}. Widgets that ignore the
 * token render normally — the renderer never asks them about their slot.
 */
export const COMPOSITION_SLOT = new InjectionToken<string>('COMPOSITION_SLOT');

/**
 * Per-form-renderer value store for composition mode (Capability F1).
 *
 * The store keys values by **widget slot** (the `widget` field of a
 * `CompositionEntry`). Section widgets opt in by reading and writing
 * through the store under their slot key. Because state lives here —
 * not in the widget component — values survive section unmount and
 * remount when predicates toggle (AC-F1-2).
 *
 * The form renderer provides one instance per `<mvk-form-renderer>` via
 * `providers: [CompositionStore]`. Sibling instances do not share state.
 *
 * @remarks
 * Per AC-F1-2, when a predicate flips visible→hidden and a slot is
 * "dirty" (non-empty per {@link isDirty}), the renderer interrupts the
 * unmount and prompts the user to either drop the value or keep the
 * section visible. The store provides the dirty check + drop primitive;
 * the visibility logic lives in `<mvk-form-renderer>`.
 */
@Injectable()
export class CompositionStore {
  private readonly state = signal<Readonly<Record<string, unknown>>>({});

  /** Reactive view of the full snapshot. */
  readonly values: Signal<Readonly<Record<string, unknown>>> = this.state.asReadonly();

  /** Read the current value for a slot, or `undefined` if unset. */
  read(slot: string): unknown {
    return this.state()[slot];
  }

  /** Write a value for a slot, replacing any prior entry. */
  write(slot: string, value: unknown): void {
    this.state.update((s) => ({ ...s, [slot]: value }));
  }

  /** Drop a slot's value. */
  drop(slot: string): void {
    this.state.update((s) => {
      if (!(slot in s)) return s;
      const next = { ...s };
      delete next[slot];
      return next;
    });
  }

  /**
   * `true` when the slot holds a non-empty value, by these rules:
   *   - `undefined` / `null` → clean
   *   - empty string → clean
   *   - boolean `false` → clean (matches checkbox "default" expectations);
   *     `true` is dirty
   *   - empty array → clean
   *   - empty plain object → clean
   *   - `Set` / `Map` of size 0 → clean
   *   - any other primitive (incl. `0`, `NaN`) → dirty
   *
   * Drives the AC-F1-2 confirmation prompt: the renderer only interrupts
   * a section's unmount when its slot reports dirty.
   */
  isDirty(slot: string): boolean {
    const v = this.state()[slot];
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.length > 0;
    if (typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.length > 0;
    if (v instanceof Set || v instanceof Map) return v.size > 0;
    if (typeof v === 'object') return Object.keys(v as object).length > 0;
    return true;
  }

  /** Immutable snapshot of all slot values. Stable reference per write. */
  snapshot(): Readonly<Record<string, unknown>> {
    return this.state();
  }

  /** Reset all slots — used when the renderer remounts onto a different form. */
  clear(): void {
    this.state.set({});
  }
}
