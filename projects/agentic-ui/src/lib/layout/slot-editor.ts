import type { SlotDef, SlotMap } from './types';

/**
 * ADR-047 D1 — pure-function slot-level edit helpers. Adopters build
 * tools like `addLayoutSlot` / `removeLayoutSlot` / `replaceLayoutSlot`
 * around these. Each function takes a current `SlotMap` (or `null` /
 * `undefined` for empty) and returns the edited copy — no DI, no
 * mutation.
 *
 * Why pure functions instead of a class:
 *   - Adopters apply edits against whatever signal-backed store they
 *     hold the active SlotMap in (the eDiscovery flagship uses
 *     `WorkspaceLayoutStore`, but adopters might persist via the
 *     `LayeredLayoutStore` user tier or a custom signal).
 *   - Easy to compose: `replace + add` is `slotEdits.add(slotEdits.replace(map, x), y)`.
 *   - Trivial to test — pass in SlotMap, get SlotMap back.
 */
export const slotEdits = Object.freeze({
  /**
   * Add a slot to the map. If the slot already exists, the existing
   * one is kept (use `replace` to overwrite). Returns the input
   * unchanged when no-op so signal consumers don't see a spurious
   * change.
   */
  add(current: SlotMap | null | undefined, slot: string, def: SlotDef): SlotMap {
    const base = current ?? {};
    if (base[slot] !== undefined) return base;  // no-op
    return { ...base, [slot]: def };
  },

  /**
   * Replace (or insert) a slot. Always produces a new map when the
   * slot value differs; returns input unchanged when the value is
   * structurally equal (cheap reference check + JSON compare on miss).
   */
  replace(current: SlotMap | null | undefined, slot: string, def: SlotDef): SlotMap {
    const base = current ?? {};
    if (base[slot] === def) return base;
    return { ...base, [slot]: def };
  },

  /**
   * Remove a slot. Returns the input unchanged when the slot didn't
   * exist (no-op).
   */
  remove(current: SlotMap | null | undefined, slot: string): SlotMap {
    if (!current || current[slot] === undefined) return current ?? {};
    const next: Record<string, SlotDef> = {};
    for (const [name, def] of Object.entries(current)) {
      if (name !== slot) next[name] = def;
    }
    return next as SlotMap;
  },

  /**
   * Bulk merge — apply `additions` (new slots) and `evictions`
   * (slots to drop) in a single pass. Useful when one agent tool
   * call needs to atomically apply several slot edits.
   */
  merge(
    current: SlotMap | null | undefined,
    additions: Partial<SlotMap>,
    evictions: readonly string[] = [],
  ): SlotMap {
    let next: SlotMap = current ?? {};
    for (const name of evictions) next = slotEdits.remove(next, name);
    for (const [name, def] of Object.entries(additions)) {
      if (def !== undefined) next = slotEdits.replace(next, name, def);
    }
    return next;
  },
});
