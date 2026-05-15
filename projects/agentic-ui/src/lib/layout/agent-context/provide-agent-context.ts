import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import { makeEnvironmentProviders } from '@angular/core';
import {
  LayoutStateContextContributor,
  PersonaContextContributor,
  RouteContextContributor,
} from './contributors';
import {
  AvailableTemplatesContextContributor,
  MatterContextContributor,
  OverrideStackContextContributor,
  RecentToolCallsContextContributor,
  SelectionContextContributor,
} from './extra-contributors';
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
   * ADR-047 D3 — include `SelectionContextContributor`. Emits
   * `<selection kind="..." count="N">` describing what the user is
   * currently looking at. Default `true` — `SelectionStore` is
   * `providedIn: 'root'` and returns null when no selection is active.
   */
  readonly includeSelection?: boolean;
  /**
   * ADR-047 D3 — include `AvailableTemplatesContextContributor`.
   * Emits `<available-templates>` listing every approved layout +
   * dashboard template so the agent can recommend by name. Default
   * `true` — registries are `providedIn: 'root'` and return empty
   * when no templates exist.
   */
  readonly includeAvailableTemplates?: boolean;
  /**
   * ADR-047 D3 — include `OverrideStackContextContributor`. Emits
   * `<override-stack>` showing the precedence layer driving each
   * slot of the current resolved layout. Default `true`.
   */
  readonly includeOverrideStack?: boolean;
  /**
   * ADR-047 D3 — include `RecentToolCallsContextContributor`. Emits
   * `<recent-tool-calls>` (last 10) so the agent knows what's just
   * happened. Default `false` — adopters opt in by also binding
   * `RECENT_TOOL_CALLS_SIGNAL` to their tool-call history source.
   */
  readonly includeRecentToolCalls?: boolean;
  /**
   * ADR-047 D3 — include `MatterContextContributor`. Emits
   * `<matter id="..." phase="..." />` for the active matter (or the
   * adopter's domain analog: ticket, portfolio). Default `false` —
   * adopters opt in by also binding `MATTER_CONTEXT_SIGNAL`.
   */
  readonly includeMatter?: boolean;
  /**
   * Adopter-defined contributors. Each is registered as a multi-provider
   * against `CONTEXT_CONTRIBUTOR`. Use this for domain-specific
   * contributors not shipped by the lib.
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
  const includeSelection = config.includeSelection ?? true;
  const includeAvailableTemplates = config.includeAvailableTemplates ?? true;
  const includeOverrideStack = config.includeOverrideStack ?? true;
  const includeRecentToolCalls = config.includeRecentToolCalls ?? false;
  const includeMatter = config.includeMatter ?? false;

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
  if (includeSelection) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: SelectionContextContributor, multi: true });
  }
  if (includeAvailableTemplates) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: AvailableTemplatesContextContributor, multi: true });
  }
  if (includeOverrideStack) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: OverrideStackContextContributor, multi: true });
  }
  if (includeRecentToolCalls) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: RecentToolCallsContextContributor, multi: true });
  }
  if (includeMatter) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: MatterContextContributor, multi: true });
  }
  for (const c of config.extraContributors ?? []) {
    providers.push({ provide: CONTEXT_CONTRIBUTOR, useExisting: c, multi: true });
  }

  return makeEnvironmentProviders(providers);
}
