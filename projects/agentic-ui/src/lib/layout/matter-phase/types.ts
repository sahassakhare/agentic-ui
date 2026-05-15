import { InjectionToken, type Signal, signal } from '@angular/core';
import type { SlotMap } from '../types';

/**
 * Adopter-supplied rule for `MatterPhaseLayoutInput`. Fires when the
 * active `MATTER_CONTEXT_SIGNAL.phase` matches the rule's `phase`
 * value. Phases are strings — adopters define their own taxonomy
 * (eDiscovery: `'collection' | 'review' | 'production' | 'closed'`;
 * customer support: `'open' | 'investigating' | 'resolved'`; etc.).
 */
export interface MatterPhaseLayoutRule {
  /** Phase value to match — string comparison against `MATTER_CONTEXT_SIGNAL.phase`. */
  readonly phase: string;
  readonly slots: Partial<SlotMap>;
  readonly evictSlots?: readonly string[];
  readonly priority?: number;
  readonly reason?: string;
}

export const MATTER_PHASE_LAYOUT_RULES = new InjectionToken<readonly MatterPhaseLayoutRule[]>(
  'MATTER_PHASE_LAYOUT_RULES',
  { factory: () => [] },
);

/**
 * Adopter-supplied phase signal — usually a derived view of
 * `MATTER_CONTEXT_SIGNAL`. Separate token from `MATTER_CONTEXT_SIGNAL`
 * so adopters who only want phase-driven rules (without populating the
 * full matter context block for the agent) can wire just this one.
 *
 * Default: empty signal that never fires.
 */
export const ACTIVE_MATTER_PHASE_SIGNAL = new InjectionToken<Signal<string | null>>(
  'ACTIVE_MATTER_PHASE_SIGNAL',
  { factory: () => signal<string | null>(null).asReadonly() },
);
