/**
 * Decides how a resolved experience should render for the end user.
 *
 * One experience can produce a dashboard OR a guided journey OR a plain form.
 * The plan already carries `forms` / `workflow`; dashboards are host-shipped and
 * flagged on the experience with `tags: ['dashboard']`, looked up by name in the
 * DashboardRegistry. Access is decided first — a denied plan never renders.
 */
import type { DashboardDef, DashboardRegistry, ExperienceDef, ExperiencePlan } from '@infra-tools/agentic-ui';

export type RenderMode =
  | { readonly kind: 'denied'; readonly reason: string }
  | { readonly kind: 'dashboard'; readonly dashboard: DashboardDef }
  | { readonly kind: 'workflow'; readonly formName: string }
  | { readonly kind: 'form'; readonly formName: string }
  | { readonly kind: 'empty' };

export function resolveRenderMode(
  experience: ExperienceDef | undefined,
  plan: ExperiencePlan,
  dashboards: DashboardRegistry,
): RenderMode {
  if (!plan.access.allowed) return { kind: 'denied', reason: plan.access.reason ?? 'access denied' };
  if (experience?.tags?.includes('dashboard')) {
    const dashboard = dashboards.get(experience.name);
    if (dashboard) return { kind: 'dashboard', dashboard };
  }
  if (plan.workflow) return { kind: 'workflow', formName: plan.workflow };
  if (plan.forms.length) return { kind: 'form', formName: plan.forms[0] };
  return { kind: 'empty' };
}
