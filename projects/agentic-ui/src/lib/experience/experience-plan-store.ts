import { Injectable, signal } from '@angular/core';
import type { ExperiencePlan } from './experience-planner';

/**
 * Holds the currently-active {@link ExperiencePlan} (AEP Seam D). The app calls
 * `set(plan)` after `ExperiencePlanner.plan(...)` resolves; the
 * `ExperiencePlanContextContributor` reads it so the plan is serialized into
 * the per-turn agent context, and layout/tool wiring can react to it.
 *
 * `providedIn: 'root'` — returns `null` until a plan is set, so contributors
 * that read it degrade to "no plan" by absence.
 */
@Injectable({ providedIn: 'root' })
export class ExperiencePlanStore {
  private readonly _plan = signal<ExperiencePlan | null>(null);
  /** The active plan, or `null`. */
  readonly plan = this._plan.asReadonly();

  set(plan: ExperiencePlan | null): void {
    this._plan.set(plan);
  }

  clear(): void {
    this._plan.set(null);
  }
}
