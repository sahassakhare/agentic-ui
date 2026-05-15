import { InjectionToken, type Signal } from '@angular/core';
import type { SlotMap } from '../types';

/**
 * ADR-047 D7 — generic shape for "what is the user looking at right now".
 * Adopters set the active selection by calling `SelectionStore.set(state)`
 * whenever something is clicked / multi-selected / drilled into.
 *
 * `kind` is intentionally a free-form string so domain-specific shapes
 * (`'document'`, `'custodian'`, `'hold'`, `'matter-event'`, …) can be
 * authored without a lib-side enum. The `SelectionLayoutInput` and
 * `SelectionContextContributor` both match on `kind` to decide
 * which rules / context fragments apply.
 */
export interface SelectionState {
  readonly kind: string;
  readonly ids: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Adopter-supplied rule for `SelectionLayoutInput`. Fires when the
 * current `SelectionState.kind` matches AND the selection-count falls
 * inside `[minCount, maxCount]` (both inclusive; default 1..∞).
 */
export interface SelectionLayoutRule {
  readonly kind: string;
  readonly minCount?: number;
  readonly maxCount?: number;
  readonly slots: Partial<SlotMap>;
  readonly evictSlots?: readonly string[];
  readonly priority?: number;
  readonly reason?: string;
}

export const SELECTION_LAYOUT_RULES = new InjectionToken<readonly SelectionLayoutRule[]>(
  'SELECTION_LAYOUT_RULES',
  { factory: () => [] },
);

/**
 * Optional adopter-bound signal — used by `SelectionContextContributor`
 * (ADR-047 D3) to read the current selection without having to inject
 * `SelectionStore` directly. When the lib auto-registers
 * `SelectionStore` (always available, `providedIn: 'root'`), this
 * token isn't usually needed — contributors inject the store. Token
 * exists for tests + adopters who want to bind a synthetic source.
 */
export const ACTIVE_SELECTION_SIGNAL = new InjectionToken<Signal<SelectionState | null>>(
  'ACTIVE_SELECTION_SIGNAL',
);
