import { Injectable, inject } from '@angular/core';
import type { LayoutInput, LayoutInputSource, LayoutRule } from '../layout/resolver/types';
import type { SlotMap } from '../layout/types';
import { LayoutTemplateRegistry } from '../layout/templates/layout-template-registry';
import { ExperiencePlanStore } from './experience-plan-store';

/**
 * Seeds the workspace layout from the active {@link ExperiencePlan} (AEP
 * Seam D → LayoutResolver integration). When a plan is active, allowed, and
 * names a `defaultLayout`, this input resolves that approved
 * `LayoutTemplateRegistry` entry to its slot map and contributes it at the
 * new **`experience`** precedence source (weight 900 — below the volatile
 * `agent` layer at 1000, above `user-saved` at 800).
 *
 * Effect: opening an experience pivots the workspace to its layout, but the
 * agent can still override per-turn and the user's saved pins still lose only
 * to the agent + experience layers — exactly the precedence the AEP plan
 * specifies. Contributes nothing (so the resolver is unaffected) when there is
 * no active/allowed plan, the plan names no layout, or the template is missing
 * or unapproved.
 */
@Injectable({ providedIn: 'root' })
export class ExperienceLayoutInput implements LayoutInput {
  readonly id = 'experience-plan';
  readonly source: LayoutInputSource = 'experience';

  private readonly store = inject(ExperiencePlanStore);
  private readonly templates = inject(LayoutTemplateRegistry);

  evaluate(): readonly LayoutRule[] {
    const plan = this.store.plan();
    if (!plan || !plan.access.allowed || !plan.layout) return [];

    const template = this.templates.get(plan.layout);
    if (!template || template.approvalState !== 'approved') return [];

    const slots = template.body?.slotMap as SlotMap | undefined;
    if (!slots || Object.keys(slots).length === 0) return [];

    return [
      {
        id: `experience:${plan.experienceId}`,
        source: this.source,
        slots,
        reason: `experience "${plan.experienceId}" → template "${plan.layout}"`,
      },
    ];
  }
}
