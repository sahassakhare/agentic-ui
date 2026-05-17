import { inject, Injectable } from '@angular/core';
import type {
  LayoutInput,
  LayoutInputSource,
  LayoutRule,
} from '../resolver/types';
import {
  ACTIVE_ALERTS_SIGNAL,
  ALERT_LAYOUT_RULES,
  type ActiveAlert,
  type AlertLayoutRule,
} from './types';

const SEVERITY_RANK: Readonly<Record<NonNullable<ActiveAlert['severity']>, number>> = {
  info: 0,
  warning: 1,
  critical: 2,
};

/**
 * ADR-046 D2 + ADR-047 — alert-driven `LayoutInput`. Fires when any
 * currently-active alert matches a rule's `kind` AND meets the
 * `minSeverity` threshold (if specified).
 *
 * Source = `'alert'` (weight 400 by default — same tier as route /
 * selection / time-of-day, above persona / matter-phase). The intent:
 * a time-sensitive alert SHOULD interrupt the user's persona /
 * matter-phase baseline, but NOT override what the user is actively
 * looking at (route / selection win on ties via evaluation order).
 *
 * Composition example (eDiscovery):
 *   - alert kind 'deadline-approaching' (severity ≥ warning) →
 *     primary: deadlineFocus, sidebar: unresolvedPrivilege
 *   - alert kind 'opa-policy-violation' (critical) →
 *     primary: violationDetail, evictSlots: ['footer']
 *
 * Returns no rules when the active-alerts signal is empty, so
 * adopters who don't have an alert source pay zero cost.
 */
@Injectable({ providedIn: 'root' })
export class AlertLayoutInput implements LayoutInput {
  readonly id = 'alert';
  readonly source: LayoutInputSource = 'alert';

  private readonly alertsSignal = inject(ACTIVE_ALERTS_SIGNAL);
  private readonly rules = inject(ALERT_LAYOUT_RULES);

  evaluate(): readonly LayoutRule[] {
    const alerts = this.alertsSignal();
    if (alerts.length === 0) return [];
    const output: LayoutRule[] = [];
    for (const rule of this.rules) {
      const triggering = alerts.find((a) => this.alertMatches(a, rule));
      if (!triggering) continue;
      output.push({
        id: `alert:${rule.kind}:${triggering.id}`,
        source: this.source,
        slots: rule.slots,
        evictSlots: rule.evictSlots,
        priority: rule.priority,
        reason:
          rule.reason ??
          `alert kind=${rule.kind} severity=${triggering.severity ?? 'info'} fired`,
      });
    }
    return output;
  }

  private alertMatches(alert: ActiveAlert, rule: AlertLayoutRule): boolean {
    if (alert.kind !== rule.kind) return false;
    if (!rule.minSeverity) return true;
    const alertRank = SEVERITY_RANK[alert.severity ?? 'info'];
    const ruleRank = SEVERITY_RANK[rule.minSeverity];
    return alertRank >= ruleRank;
  }
}
