import { InjectionToken, type Signal, signal } from '@angular/core';
import type { SlotMap } from '../types';

/**
 * Generic alert shape for `AlertLayoutInput`. Adopters convert their
 * trigger-runner / notification / pager / SLA-monitor signals into
 * this shape via a `computed()` that filters to currently-active
 * alerts.
 *
 * `kind` is intentionally a free-form string so domain-specific
 * alert types (`'deadline-approaching'`, `'opa-policy-violation'`,
 * `'sla-breach'`, `'on-call-page'`, …) can be authored without a
 * lib-side enum.
 */
export interface ActiveAlert {
  readonly id: string;
  readonly kind: string;
  readonly severity?: 'info' | 'warning' | 'critical';
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Adopter-supplied rule for `AlertLayoutInput`. Fires when any
 * currently-active alert matches the rule's `kind` (and optionally
 * `minSeverity`). Multiple alerts of the same kind only fire the
 * rule once — the kind itself is the predicate.
 */
export interface AlertLayoutRule {
  readonly kind: string;
  /** Minimum severity that triggers the rule. Default: any severity. */
  readonly minSeverity?: 'info' | 'warning' | 'critical';
  readonly slots: Partial<SlotMap>;
  readonly evictSlots?: readonly string[];
  readonly priority?: number;
  readonly reason?: string;
}

export const ALERT_LAYOUT_RULES = new InjectionToken<readonly AlertLayoutRule[]>(
  'ALERT_LAYOUT_RULES',
  { factory: () => [] },
);

/**
 * Adopter-bound signal listing currently-active alerts. Re-evaluated
 * by the resolver whenever the signal fires. Default: empty signal
 * that never emits.
 *
 * Typical wiring (eDiscovery): a `computed()` over
 * `TriggerRunner.activeTriggers()` filtered to deadline-approaching
 * + escalations, reshaped to the `ActiveAlert` shape.
 */
export const ACTIVE_ALERTS_SIGNAL = new InjectionToken<Signal<readonly ActiveAlert[]>>(
  'ACTIVE_ALERTS_SIGNAL',
  { factory: () => signal<readonly ActiveAlert[]>([]).asReadonly() },
);
