import { inject, Injectable } from '@angular/core';
import type {
  LayoutInput,
  LayoutInputSource,
  LayoutRule,
} from '../resolver/types';
import {
  ACTIVE_MATTER_PHASE_SIGNAL,
  MATTER_PHASE_LAYOUT_RULES,
} from './types';

/**
 * ADR-046 D2 + ADR-047 — phase-driven `LayoutInput`. Fires when the
 * adopter's `ACTIVE_MATTER_PHASE_SIGNAL` value matches a rule's
 * `phase` field.
 *
 * Source = `'matter-phase'` (weight 300 by default — above persona,
 * below contextual layers like route/selection). The intent: matter
 * phase is a longer-lived contextual signal than selection but
 * shorter-lived than persona, and it should drive baseline layouts
 * differently per phase without overriding what the user is actively
 * looking at.
 *
 * Composition example (eDiscovery):
 *   - phase 'review'     → primary: reviewQueue, sidebar: tagPanel
 *   - phase 'production' → primary: productionThroughput, sidebar: bates
 *
 * Returns no rules when no phase is set, so adopters can omit the
 * signal binding to opt out entirely.
 */
@Injectable({ providedIn: 'root' })
export class MatterPhaseLayoutInput implements LayoutInput {
  readonly id = 'matter-phase';
  readonly source: LayoutInputSource = 'matter-phase';

  private readonly phaseSignal = inject(ACTIVE_MATTER_PHASE_SIGNAL);
  private readonly rules = inject(MATTER_PHASE_LAYOUT_RULES);

  evaluate(): readonly LayoutRule[] {
    const phase = this.phaseSignal();
    if (!phase) return [];
    return this.rules
      .filter((rule) => rule.phase === phase)
      .map((rule, index) => ({
        id: `matter-phase:${phase}#${index}`,
        source: this.source,
        slots: rule.slots,
        evictSlots: rule.evictSlots,
        priority: rule.priority,
        reason: rule.reason ?? `matter phase '${phase}'`,
      }));
  }
}
