import { inject, Injectable } from '@angular/core';
import type {
  LayoutInput,
  LayoutInputSource,
  LayoutRule,
} from '../resolver/types';
import { SelectionStore } from './selection-store';
import { SELECTION_LAYOUT_RULES, type SelectionLayoutRule } from './types';

/**
 * ADR-047 D7 — selection-driven `LayoutInput`. Fires when the
 * current `SelectionState.kind` matches an adopter-supplied rule AND
 * the selection count falls inside `[minCount, maxCount]`.
 *
 * Source = `'selection'` (weight 400 by default, equal to route +
 * alert + time-of-day; higher than persona). The intent: selection
 * is a strong contextual signal — clicking a single document SHOULD
 * pivot the workspace to a document-preview layout even when the
 * route's default rule says something different.
 *
 * Composition example:
 *   route /documents → primary: docList, sidebar: filters
 *   selection { kind: 'document', count: 1 } → primary: docPreview, sidebar: tagPanel
 *   resolved: primary + sidebar from selection (same source weight,
 *   selection wins via insertion order — both rules sit at weight 400,
 *   selection rules are evaluated after route rules in input order).
 *
 * Adopters who want selection to ALWAYS beat route override weights:
 *   provideLayoutResolver({ weights: { selection: 500, route: 400, ... } })
 */
@Injectable({ providedIn: 'root' })
export class SelectionLayoutInput implements LayoutInput {
  readonly id = 'selection';
  readonly source: LayoutInputSource = 'selection';

  private readonly selectionStore = inject(SelectionStore);
  private readonly rules = inject(SELECTION_LAYOUT_RULES);

  evaluate(): readonly LayoutRule[] {
    const state = this.selectionStore.selection();
    if (!state) return [];
    const count = state.ids.length;
    return this.rules
      .filter((rule) => this.ruleMatches(rule, state.kind, count))
      .map((rule, index) => ({
        id: `selection:${state.kind}:${count}#${index}`,
        source: this.source,
        slots: rule.slots,
        evictSlots: rule.evictSlots,
        priority: rule.priority,
        reason:
          rule.reason ??
          `selection kind=${state.kind} count=${count} matched`,
      }));
  }

  private ruleMatches(rule: SelectionLayoutRule, kind: string, count: number): boolean {
    if (rule.kind !== kind) return false;
    const min = rule.minCount ?? 1;
    const max = rule.maxCount ?? Number.POSITIVE_INFINITY;
    return count >= min && count <= max;
  }
}
