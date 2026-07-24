import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { CONTEXT_CONTRIBUTOR } from '../layout/agent-context/types';
import { LAYOUT_INPUT } from '../layout/resolver/types';
import { ExperiencePlanContextContributor } from './experience-plan-context-contributor';
import { ExperienceLayoutInput } from './experience-layout-input';

export interface ExperiencePlatformConfig {
  /**
   * Register the `ExperiencePlanContextContributor` so the active
   * {@link ExperiencePlan} is serialized into the agent context block.
   * Default `true`. Requires `provideAgentContext(...)` to be wired for the
   * fragment to actually reach the model.
   */
  readonly includePlanContext?: boolean;
  /**
   * Register the `ExperienceLayoutInput` so the active plan's `layout`
   * template seeds the workspace layout at the `experience` precedence source.
   * Default `true`. Requires a `LayoutResolver` (root-provided) and an approved
   * `LayoutTemplateRegistry` entry matching the plan's layout name.
   */
  readonly includeLayoutInput?: boolean;
}

/**
 * Wires the AEP experience layer (Seams C + D) into an app (AEP §6).
 *
 * The registries (`ExperienceRegistry`, `ExperiencePlanner`,
 * `ExperiencePlanStore`) are all `providedIn: 'root'`, so they need no
 * registration — this provider's job is to plug the plan into the existing
 * agent-context pipeline (`CONTEXT_CONTRIBUTOR`), matching the
 * `provideAgentContext` idiom. Purely additive: omit it and nothing changes.
 *
 * @example
 * ```ts
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideAgentContext(),        // route/persona/layout-state
 *     provideExperiencePlatform(),  // + <experience-plan> block
 *   ],
 * };
 * ```
 */
export function provideExperiencePlatform(config: ExperiencePlatformConfig = {}): EnvironmentProviders {
  const providers = [];
  if (config.includePlanContext ?? true) {
    providers.push({
      provide: CONTEXT_CONTRIBUTOR,
      useExisting: ExperiencePlanContextContributor,
      multi: true,
    });
  }
  if (config.includeLayoutInput ?? true) {
    providers.push({
      provide: LAYOUT_INPUT,
      useExisting: ExperienceLayoutInput,
      multi: true,
    });
  }
  return makeEnvironmentProviders(providers);
}
