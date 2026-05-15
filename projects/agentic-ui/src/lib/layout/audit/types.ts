import { InjectionToken } from '@angular/core';
import type { SlotMap } from '../types';
import type { AppliedRule } from '../resolver/types';

/**
 * ADR-046 D4 — chain-hashed audit event emitted every time the
 * `LayoutResolver`'s `active()` output materially changes. Joins the
 * existing tool-call / approval audit trail with the same
 * `prevHash → chainHash` chain so compliance discovery treats layout
 * changes as first-class history.
 *
 * Why "every material change" and not "every recompute": the resolver
 * recomputes whenever any input signal fires, including signal
 * changes that produce an identical output (e.g. a route ping that
 * doesn't match any rule). The audit sink filters by deep-equal of
 * the resolved slots — only emits when the output actually changed.
 */
export interface LayoutAppliedEvent {
  readonly kind: 'LAYOUT_APPLIED';
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  /** Stable id for the event — UUID / random-id. */
  readonly id: string;
  /** Resolved slot map at this point in time. */
  readonly slots: SlotMap;
  /**
   * Provenance — every rule that contributed to a slot in this
   * snapshot. Lets a time-travel viewer reconstruct *why* a slot
   * appeared where it did without re-running the resolver.
   */
  readonly appliedRules: readonly AppliedRule[];
  /** Optional context attribution — adopters can attach userId / matterId / route / etc. */
  readonly attribution?: Readonly<Record<string, string>>;
  /** Previous event's `chainHash` — `null` for the first event in the chain. */
  readonly prevHash: string | null;
  /** sha256-over-canonical-JSON of this event minus `chainHash`. */
  readonly chainHash: string;
}

/**
 * Sink contract — the audit hook that receives `LayoutAppliedEvent`s.
 * Adopters bind their existing audit pipeline here (the ediscovery
 * flagship binds `appendAudit` from demo-ediscovery-shared).
 */
export interface LayoutAuditSink {
  emit(event: LayoutAppliedEvent): void | Promise<void>;
}

/**
 * Adopter-provided sink. When wired, `LayoutAuditTracker` calls it on
 * every material change. When absent, the tracker keeps an in-memory
 * chain only — useful for tests + offline mode.
 */
export const LAYOUT_AUDIT_SINK = new InjectionToken<LayoutAuditSink>('LAYOUT_AUDIT_SINK');

/**
 * Adopter-provided attribution. Returns the static metadata the
 * tracker should attach to every event (userId / matterId / tenantId
 * / current route). Re-evaluated per event so signal-backed values
 * are always current.
 */
export const LAYOUT_AUDIT_ATTRIBUTION = new InjectionToken<() => Record<string, string>>(
  'LAYOUT_AUDIT_ATTRIBUTION',
  { factory: () => () => ({}) },
);
