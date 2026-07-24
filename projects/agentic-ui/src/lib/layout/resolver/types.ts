import { InjectionToken } from '@angular/core';
import type { SlotMap } from '../types';

/**
 * Source of a layout rule. Maps 1:1 to a precedence layer in ADR-046 D2.
 * The resolver consults `DEFAULT_LAYOUT_WEIGHTS[source]` (or the host's
 * overridden weight map via `LAYOUT_WEIGHTS`) to decide who wins on a
 * slot-level merge conflict.
 */
export type LayoutInputSource =
  | 'agent'           // setWorkspaceLayout tool — volatile, highest priority
  | 'experience'      // AEP ExperiencePlan seed — below agent, above user-saved
  | 'user-saved'      // user's personal pinned layout
  | 'matter-default'  // matter-lead pushed custom shape
  | 'alert'           // time-sensitive contextual switch (deadline approaching)
  | 'selection'       // selection-driven switch (doc / multi-doc / custodian)
  | 'route'           // route-driven default
  | 'time-of-day'     // schedule-driven contextual switch
  | 'matter-phase'    // collection / review / production / closed phase
  | 'persona'         // per-persona density / mode preference
  | 'org-default'     // org-admin baseline
  | 'hardcoded';      // lib-shipped fallback

/**
 * Default precedence weights per ADR-046 D2. Higher wins on conflict.
 * Adopters can rewire via `LAYOUT_WEIGHTS` provider — the resolver
 * reads the override before falling back to this map.
 */
export const DEFAULT_LAYOUT_WEIGHTS: Readonly<Record<LayoutInputSource, number>> = {
  agent: 1000,
  experience: 900,
  'user-saved': 800,
  'matter-default': 600,
  alert: 400,
  selection: 400,
  route: 400,
  'time-of-day': 400,
  'matter-phase': 300,
  persona: 200,
  'org-default': 100,
  hardcoded: 0,
};

/**
 * A single contribution toward the resolved layout. Inputs return zero or
 * more rules per `evaluate()` call. The resolver merges rules by precedence
 * weight + within-source priority, with slot-level (not layout-level) merge:
 * a rule that names only `sidebar` augments a higher-weight rule that named
 * `primary` + `footer`.
 */
export interface LayoutRule {
  /** Stable id for telemetry + audit attribution. */
  readonly id: string;
  /** Which precedence layer this rule comes from. */
  readonly source: LayoutInputSource;
  /** Partial slot map — only the slots this rule contributes to. */
  readonly slots: Partial<SlotMap>;
  /**
   * Slots this rule explicitly evicts (removes from lower-priority
   * contributions). Eviction is *separate* from override: an evicted
   * slot vanishes even if no rule provides a replacement.
   */
  readonly evictSlots?: readonly string[];
  /**
   * Tie-breaker within the same `source`. Default 0. Higher wins when
   * two rules from the same source contribute to the same slot.
   */
  readonly priority?: number;
  /** Audit-grade explanation surfaced in `LAYOUT_APPLIED` events (ADR-046 D4). */
  readonly reason: string;
  /**
   * Optional gate — if present, the rule only contributes when this
   * predicate returns true. Lets inputs return all candidate rules
   * statically and let the resolver filter dynamically.
   */
  readonly matches?: () => boolean;
}

/**
 * One input layer feeding the resolver. Implementations read their own
 * signals inside `evaluate()`; the resolver's `computed()` auto-tracks
 * those reads so `active()` recomputes whenever any input changes.
 */
export interface LayoutInput {
  /** Stable id — primarily for telemetry / debug. */
  readonly id: string;
  /** Which precedence layer this input contributes to. */
  readonly source: LayoutInputSource;
  /**
   * Compute the candidate rules for the current input state. Called
   * from inside the resolver's `computed()` — read signals freely.
   */
  evaluate(): readonly LayoutRule[];
}

/**
 * What the resolver outputs on each recompute. `slots` is the merged
 * `SlotMap` ready to bind to `<mvk-workspace-layout>`. `appliedRules`
 * records which rule won each slot — the audit-trail and time-travel
 * machinery (ADR-046 D4) reads this without re-running the resolver.
 */
export interface ResolvedLayout {
  readonly slots: SlotMap;
  readonly appliedRules: readonly AppliedRule[];
}

export interface AppliedRule {
  readonly ruleId: string;
  readonly source: LayoutInputSource;
  readonly slotName: string;
  readonly reason: string;
  readonly weight: number;
}

/**
 * Multi-provider injection token. Each LayoutInput class is provided
 * with `multi: true` against this token; the resolver injects the
 * combined array. Empty array if no provider — resolver returns an
 * empty SlotMap.
 */
export const LAYOUT_INPUT = new InjectionToken<readonly LayoutInput[]>(
  'LAYOUT_INPUT',
  { factory: () => [] },
);

/**
 * Optional override for the default precedence map. Provider value
 * replaces specific entries; unspecified keys fall back to
 * `DEFAULT_LAYOUT_WEIGHTS`.
 */
export const LAYOUT_WEIGHTS = new InjectionToken<Partial<Record<LayoutInputSource, number>>>(
  'LAYOUT_WEIGHTS',
  { factory: () => ({}) },
);
