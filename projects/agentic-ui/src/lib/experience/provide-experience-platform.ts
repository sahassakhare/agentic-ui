import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { CONTEXT_CONTRIBUTOR } from '../layout/agent-context/types';
import { ExperiencePlanContextContributor } from './experience-plan-context-contributor';

export interface ExperiencePlatformConfig {
  /**
   * Register the `ExperiencePlanContextContributor` so the active
   * {@link ExperiencePlan} is serialized into the agent context block.
   * Default `true`. Requires `provideAgentContext(...)` to be wired for the
   * fragment to actually reach the model.
   */
  readonly includePlanContext?: boolean;
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
  return makeEnvironmentProviders(providers);
}
