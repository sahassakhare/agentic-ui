import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import { makeEnvironmentProviders } from '@angular/core';
import {
  LayoutStateContextContributor,
  PersonaContextContributor,
  RouteContextContributor,
} from './contributors';
import {
  CONTEXT_CONTRIBUTOR,
  type ContextContributor,
} from './types';

export interface AgentContextConfig {
  /**
   * Include the lib-shipped `RouteContextContributor`. Default `true`.
   */
  readonly includeRoute?: boolean;
  /**
   * Include the lib-shipped `PersonaContextContributor`. Default `true`.
   * Requires `ACTIVE_PERSONA_SIGNAL` to be provided (typically via
   * `provideLayoutResolver({ activePersona })`).
   */
  readonly includePersona?: boolean;
  /**
   * Include the lib-shipped `LayoutStateContextContributor`. Default
   * `true`. Requires `LayoutResolver` to be available (it is, since
   * the resolver is `providedIn: 'root'`).
   */
  readonly includeLayoutState?: boolean;
  /**
   * Adopter-defined contributors. Each is registered as a multi-provider
   * against `CONTEXT_CONTRIBUTOR`. Use this for selection / matter-phase /
   * recent-tool-calls / alert contributors that the lib doesn't ship.
   */
  readonly extraContributors?: readonly Type<ContextContributor>[];
}

/**
 * Wire the `AgentContextProvider` and its contributors into the DI tree.
 * Defaults to the three lib-shipped contributors (route, persona,
 * layout-state). Adopters add their own via `extraContributors`.
 *
 * Typical wiring:
 *
 * ```ts
 * provideAgentContext({
 *   extraContributors: [SelectionContextContributor, MatterPhaseContextContributor],
 * });
 * ```
 *
 * Or to suppress a default (e.g. persona-less hosts):
 *
 * ```ts
 * provideAgentContext({ includePersona: false });
 * ```
 *
 * @see [ADR-046 D5](../../../../../docs/adr/0046-layered-layout-engine.md)
 */
export function provideAgentContext(config: AgentContextConfig = {}): EnvironmentProviders {
  const includeRoute = config.includeRoute ?? true;
  const includePersona = config.includePersona ?? true;
  const includeLayoutState = config.includeLayoutState ?? true;

  const providers: Provider[] = [];

  if (includeRoute) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: RouteContextContributor, multi: true });
  }
  if (includePersona) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: PersonaContextContributor, multi: true });
  }
  if (includeLayoutState) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: LayoutStateContextContributor, multi: true });
  }
  for (const c of config.extraContributors ?? []) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: c, multi: true });
  }

  return makeEnvironmentProviders(providers);
}
