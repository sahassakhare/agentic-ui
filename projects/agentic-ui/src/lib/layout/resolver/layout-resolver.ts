import { computed, inject, Injectable } from '@angular/core';
import type { SlotDef, SlotMap } from '../types';
import {
  AppliedRule,
  DEFAULT_LAYOUT_WEIGHTS,
  LAYOUT_INPUT,
  LAYOUT_WEIGHTS,
  type LayoutInputSource,
  type ResolvedLayout,
} from './types';

/**
 * Reactive layout engine — ADR-046 D1. Composes a single `ResolvedLayout`
 * from N layered inputs:
 *
 *   route signal       ↘
 *   selection signal    →  LayoutResolver.active (computed)  →  <mvk-workspace-layout>
 *   persona signal      ↗
 *   agent override     ↗
 *   user-saved        ↗
 *   alert / time-of-day / matter-phase / org-default…
 *
 * Each input returns 0..N `LayoutRule` candidates per recompute. The
 * resolver:
 *
 *  1. Concatenates all candidates.
 *  2. Filters by each rule's optional `matches()` predicate.
 *  3. Sorts by precedence weight (descending), then within-source
 *     `priority` (descending).
 *  4. Walks the sorted list applying evictions + filling slots that
 *     aren't yet set + aren't evicted. **Slot-level** merge: a
 *     lower-weight rule can still contribute slots the higher-weight
 *     rule didn't name.
 *
 * Reactive by construction. Inputs read signals inside `evaluate()`;
 * the `computed()` here auto-tracks every read across all inputs.
 * Whenever any input's signal changes, `active()` recomputes once.
 *
 * @see [ADR-046 D1 + D2](../../../../../docs/adr/0046-layered-layout-engine.md)
 */
@Injectable({ providedIn: 'root' })
export class LayoutResolver {
  private readonly inputs = inject(LAYOUT_INPUT);
  private readonly weightOverrides = inject(LAYOUT_WEIGHTS);

  /**
   * The live resolved layout. Components bind to `resolver.active().slots`;
   * audit + telemetry read `resolver.active().appliedRules`.
   */
  readonly active = computed<ResolvedLayout>(() => this.resolve());

  /**
   * Read the effective weight for a precedence layer — the override map
   * takes priority over the lib defaults. Adopters seeing a slot lose
   * unexpectedly can debug by reading this directly.
   */
  weightFor(source: LayoutInputSource): number {
    return this.weightOverrides[source] ?? DEFAULT_LAYOUT_WEIGHTS[source];
  }

  private resolve(): ResolvedLayout {
    // Stamp each rule with its effective weight so sorting + reporting
    // works from a single field. Source defines the weight unless the
    // rule itself was emitted with a custom weight (not currently a
    // field on LayoutRule — design space if needed later).
    const candidates = this.inputs.flatMap((input) =>
      input.evaluate().map((rule) => ({
        rule,
        weight: this.weightFor(rule.source),
      })),
    );

    // Filter to rules whose predicate (if any) currently matches.
    const matching = candidates.filter(({ rule }) =>
      rule.matches ? rule.matches() : true,
    );

    // Sort highest weight first; within the same weight, highest priority
    // first. Stable sort keeps registration order for true ties.
    matching.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return (b.rule.priority ?? 0) - (a.rule.priority ?? 0);
    });

    // Single-pass merge: first rule (highest priority) to name a slot
    // wins it. Evictions are global once declared — a high-weight rule
    // that evicts `footer` keeps every lower rule from contributing it.
    const slots: Record<string, SlotDef> = {};
    const evicted = new Set<string>();
    const appliedRules: AppliedRule[] = [];

    for (const { rule, weight } of matching) {
      if (rule.evictSlots) {
        for (const name of rule.evictSlots) evicted.add(name);
      }
      for (const [slotName, slotDef] of Object.entries(rule.slots)) {
        if (slotDef === undefined) continue;
        if (slots[slotName] !== undefined) continue;  // already filled by higher
        if (evicted.has(slotName)) continue;          // evicted by higher
        slots[slotName] = slotDef;
        appliedRules.push({
          ruleId: rule.id,
          source: rule.source,
          slotName,
          reason: rule.reason,
          weight,
        });
      }
    }

    return { slots: slots as SlotMap, appliedRules };
  }
}
