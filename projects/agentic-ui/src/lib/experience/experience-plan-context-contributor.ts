import { Injectable, inject } from '@angular/core';
import type { ContextContributor, ContextFragment } from '../layout/agent-context/types';
import { ExperiencePlanStore } from './experience-plan-store';

/**
 * Serializes the active {@link ExperiencePlan} into the per-turn agent context
 * block (AEP Seam D → runtime integration). The deterministic planner decides
 * *scope* (which capabilities, gated by access); this contributor hands that
 * decision to the LLM so it *personalizes and streams* the experience rather
 * than re-deriving the layout/tools from scratch.
 *
 * Emits (only when a plan is active and access was allowed):
 * ```xml
 * <experience-plan id="legalIntake" goal="Create Legal Matter" layout="legal-intake-layout">
 *   <tools>conflictCheck, aiSummary</tools>
 *   <forms>customerSearch</forms>
 *   <components>approvalCard</components>
 *   <workflow>intakeFlow</workflow>
 *   <unmet count="1">tool:conflictCheck</unmet>
 * </experience-plan>
 * ```
 *
 * Returns `null` when there is no active plan, or the active plan was denied
 * by the access gate — the agent infers "no experience in play" by absence.
 */
@Injectable({ providedIn: 'root' })
export class ExperiencePlanContextContributor implements ContextContributor {
  readonly id = 'experience-plan';
  // After route/persona/layout-state (100/200/300), before lower-signal blocks.
  readonly order = 250;

  private readonly store = inject(ExperiencePlanStore);

  contribute(): ContextFragment | null {
    const plan = this.store.plan();
    if (!plan || !plan.access.allowed) return null;

    const children: ContextFragment[] = [];
    const list = (tag: string, items: readonly string[]) => {
      if (items.length > 0) children.push({ tag, content: items.join(', ') });
    };

    list('tools', plan.tools);
    list('forms', plan.forms);
    list('components', plan.components);
    list('dataSources', plan.dataSources);
    list('prompts', plan.prompts);
    list('knowledge', plan.knowledge);
    list('memory', plan.memory);
    list('skills', plan.skills);
    if (plan.workflow) children.push({ tag: 'workflow', content: plan.workflow });
    list('policies', plan.policies);
    if (plan.unmet.length > 0) {
      children.push({
        tag: 'unmet',
        attrs: { count: plan.unmet.length },
        content: plan.unmet
          .map((u) => `${u.requirement.kind}:${u.requirement.name ?? u.requirement.tag ?? '*'}`)
          .join(', '),
      });
    }

    const attrs: Record<string, string> = { id: plan.experienceId, goal: plan.goal };
    if (plan.layout) attrs['layout'] = plan.layout;

    return { tag: 'experience-plan', attrs, content: children };
  }
}
