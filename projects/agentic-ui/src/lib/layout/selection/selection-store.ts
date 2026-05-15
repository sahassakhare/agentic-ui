import { Injectable, signal } from '@angular/core';
import type { SelectionState } from './types';

/**
 * ADR-047 D7 — signal-backed store for "what the user has selected
 * right now". Adopters bind their click-handlers / multi-select code
 * to `set()`; the resolver's `SelectionLayoutInput` and the agent's
 * context block read from the same signal.
 *
 * Generic by design — `SelectionState.kind` is a string so adopters
 * can model `document` / `custodian` / `hold` / `production-set`
 * without the lib taking a position on what those mean. The
 * `metadata` map carries domain-specific facets (privilege status,
 * tag overlap, custodian count) consumers can match on in their
 * selection rules.
 *
 * Storage is in-memory only — selection is ephemeral by definition
 * (clears on navigation, doesn't survive reload). For persistent
 * "remember what they were looking at" semantics, adopters wire a
 * separate store; this one is for the live cursor.
 */
@Injectable({ providedIn: 'root' })
export class SelectionStore {
  private readonly _selection = signal<SelectionState | null>(null);

  /** Readonly signal — bind in templates, in `SelectionLayoutInput`, etc. */
  readonly selection = this._selection.asReadonly();

  /** Set the current selection. Pass `null` to clear (or call `clear()`). */
  set(state: SelectionState | null): void {
    this._selection.set(state);
  }

  /** Convenience — clear the selection. */
  clear(): void {
    this._selection.set(null);
  }

  /**
   * Convenience — update only the metadata of the current selection
   * without replacing kind/ids. No-op when no selection is active.
   */
  patchMetadata(metadata: Readonly<Record<string, unknown>>): void {
    this._selection.update((cur) => (cur ? { ...cur, metadata: { ...cur.metadata, ...metadata } } : cur));
  }
}
