import type { EnvironmentProviders, Provider, Signal, Type } from '@angular/core';
import { makeEnvironmentProviders } from '@angular/core';
import type { SlotMap } from '../types';
import {
  ACTIVE_PERSONA_SIGNAL,
  AGENT_LAYOUT_SIGNAL,
  AgentLayoutInput,
  PERSONA_LAYOUT_RULES,
  PersonaLayoutInput,
  type PersonaLayoutRule,
  ROUTE_LAYOUT_RULES,
  RouteLayoutInput,
  type RouteLayoutRule,
} from './inputs';
import {
  LAYOUT_INPUT,
  LAYOUT_WEIGHTS,
  type LayoutInput,
  type LayoutInputSource,
} from './types';

/**
 * Adopter-facing config for `provideLayoutResolver`. Every field is
 * optional — supply only the layers you need. The lib registers
 * `LayoutInput` classes against the multi-provider token only when the
 * adopter provides their corresponding rules / signals, so a host that
 * only cares about route-driven layouts pays zero cost for persona /
 * agent input wiring.
 */
export interface LayoutResolverConfig {
  /**
   * Route-driven rules — fire when the router URL matches the pattern.
   * The lib's `RouteLayoutInput` is registered when this is set.
   */
  readonly routeRules?: readonly RouteLayoutRule[];

  /**
   * Persona-driven rules — fire when the active-persona signal matches.
   * `PersonaLayoutInput` is registered when this OR `activePersona` is set.
   */
  readonly personaRules?: readonly PersonaLayoutRule[];

  /**
   * Adopter-supplied factory returning a signal that tracks the current
   * persona id. Bound to `ACTIVE_PERSONA_SIGNAL`. Runs in DI context so
   * adopters can `inject(PersonaService)` inside.
   *
   * ```ts
   * activePersona: () => inject(PersonaService).active
   * ```
   */
  readonly activePersona?: () => Signal<string | null>;

  /**
   * Adopter-supplied factory returning a signal holding the agent-
   * emitted SlotMap (the write target of `setWorkspaceLayout`). When
   * set, `AgentLayoutInput` is registered. Typically:
   *
   * ```ts
   * agentSlots: () => inject(WorkspaceLayoutStore).slots
   * ```
   */
  readonly agentSlots?: () => Signal<SlotMap | null>;

  /**
   * Override the lib's default precedence weights. Partial — unspecified
   * keys fall back to `DEFAULT_LAYOUT_WEIGHTS`.
   */
  readonly weights?: Partial<Record<LayoutInputSource, number>>;

  /**
   * Extra `LayoutInput` classes the adopter wrote. Each is registered
   * as a multi-provider against `LAYOUT_INPUT` so the resolver picks
   * them up alongside the built-ins.
   */
  readonly extraInputs?: readonly Type<LayoutInput>[];
}

/**
 * Wire the `LayoutResolver` engine into the app's DI tree. Lib-shipped
 * inputs (route / persona / agent) opt in based on which config fields
 * are populated; adopters provide their own inputs via `extraInputs`.
 *
 * Typical wiring:
 *
 * ```ts
 * import { provideLayoutResolver } from '@infra-tools/agentic-ui';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideLayoutResolver({
 *       routeRules: [
 *         { pattern: '/documents/*', slots: { primary: { component: 'documentPreview' } } },
 *         { pattern: '/holds', slots: { primary: { component: 'holdsCanvas' } } },
 *       ],
 *       activePersona: () => inject(PersonaService).active,
 *       agentSlots: () => inject(WorkspaceLayoutStore).slots,
 *     }),
 *   ],
 * };
 * ```
 *
 * @see [ADR-046 D1](../../../../../docs/adr/0046-layered-layout-engine.md)
 */
export function provideLayoutResolver(config: LayoutResolverConfig = {}): EnvironmentProviders {
  const providers: Provider[] = [];

  if (config.weights) {
    providers.push({ provide: LAYOUT_WEIGHTS, useValue: config.weights });
  }

  if (config.routeRules) {
    providers.push(
      { provide: ROUTE_LAYOUT_RULES, useValue: config.routeRules },
      { provide: LAYOUT_INPUT, useExisting: RouteLayoutInput, multi: true },
    );
  }

  if (config.personaRules || config.activePersona) {
    if (config.personaRules) {
      providers.push({ provide: PERSONA_LAYOUT_RULES, useValue: config.personaRules });
    }
    if (config.activePersona) {
      const factory = config.activePersona;
      providers.push({ provide: ACTIVE_PERSONA_SIGNAL, useFactory: factory });
    }
    providers.push({ provide: LAYOUT_INPUT, useExisting: PersonaLayoutInput, multi: true });
  }

  if (config.agentSlots) {
    const factory = config.agentSlots;
    providers.push(
      { provide: AGENT_LAYOUT_SIGNAL, useFactory: factory },
      { provide: LAYOUT_INPUT, useExisting: AgentLayoutInput, multi: true },
    );
  }

  for (const inputClass of config.extraInputs ?? []) {
    providers.push({ provide: LAYOUT_INPUT, useExisting: inputClass, multi: true });
  }

  return makeEnvironmentProviders(providers);
}
