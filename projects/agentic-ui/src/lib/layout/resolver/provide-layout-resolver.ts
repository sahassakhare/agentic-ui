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
  SelectionLayoutInput,
  SELECTION_LAYOUT_RULES,
  type SelectionLayoutRule,
} from '../selection';
import {
  UserSavedLayoutInput,
  USER_SAVED_LAYOUT_KEY,
} from '../layered-store/user-saved-layout-input';
import {
  ACTIVE_MATTER_PHASE_SIGNAL,
  MatterPhaseLayoutInput,
  MATTER_PHASE_LAYOUT_RULES,
  type MatterPhaseLayoutRule,
} from '../matter-phase';
import {
  ACTIVE_ALERTS_SIGNAL,
  ALERT_LAYOUT_RULES,
  AlertLayoutInput,
  type ActiveAlert,
  type AlertLayoutRule,
} from '../alert';
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
   * ADR-047 D7 — selection-driven rules. Fire when the current
   * `SelectionStore.selection()` matches a rule's `kind` + count
   * predicates. `SelectionLayoutInput` is registered when this is
   * set. The lib's `SelectionStore` is `providedIn: 'root'`, so no
   * factory is needed — adopters call `selectionStore.set(...)`
   * from their click handlers.
   */
  readonly selectionRules?: readonly SelectionLayoutRule[];

  /**
   * Adopter-supplied factory returning a signal that resolves to the
   * **key** the user-saved tier should look up on each resolver
   * recompute. When set, `UserSavedLayoutInput` is registered and the
   * user-saved precedence layer becomes live (weight 800 by default).
   *
   * Typical wiring — per-route + per-persona key:
   *
   * ```ts
   * userSavedKey: () => {
   *   const router = inject(Router);
   *   const persona = inject(PersonaService);
   *   return computed(() => `${router.url}:${persona.active()}`);
   * }
   * ```
   *
   * Return `null` from the inner signal to opt out for the current
   * route (e.g. an admin page that shouldn't be customizable).
   */
  readonly userSavedKey?: () => Signal<string | null>;

  /**
   * ADR-046 D2 + ADR-047 — matter-phase rules. Fire when the active
   * `ACTIVE_MATTER_PHASE_SIGNAL` value matches a rule's `phase`
   * field. `MatterPhaseLayoutInput` is registered when this is set
   * AND `activeMatterPhase` is set. Weight 300 by default — above
   * persona, below contextual layers.
   */
  readonly matterPhaseRules?: readonly MatterPhaseLayoutRule[];

  /**
   * Adopter-supplied factory returning the active matter-phase signal.
   * Typically derives from a domain store (eDiscovery: `MatterStore.phase`).
   *
   * ```ts
   * activeMatterPhase: () => inject(MatterStore).phase
   * ```
   *
   * Return null from the inner signal to suspend phase-driven rules.
   */
  readonly activeMatterPhase?: () => Signal<string | null>;

  /**
   * ADR-046 D2 + ADR-047 — alert-driven rules. Fire when any
   * active alert (from `activeAlerts` signal) matches a rule's
   * `kind` and meets its `minSeverity`. Source weight 400.
   */
  readonly alertRules?: readonly AlertLayoutRule[];

  /**
   * Adopter-supplied factory returning a signal listing currently-
   * active alerts. Typically a `computed()` over the host's
   * trigger-runner / notifications / SLA-monitor that reshapes to
   * the lib's `ActiveAlert` contract.
   */
  readonly activeAlerts?: () => Signal<readonly ActiveAlert[]>;

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

  if (config.selectionRules) {
    providers.push(
      { provide: SELECTION_LAYOUT_RULES, useValue: config.selectionRules },
      { provide: LAYOUT_INPUT, useExisting: SelectionLayoutInput, multi: true },
    );
  }

  if (config.userSavedKey) {
    const keyFactory = config.userSavedKey;
    providers.push(
      { provide: USER_SAVED_LAYOUT_KEY, useFactory: keyFactory },
      { provide: LAYOUT_INPUT, useExisting: UserSavedLayoutInput, multi: true },
    );
  }

  if (config.matterPhaseRules || config.activeMatterPhase) {
    if (config.matterPhaseRules) {
      providers.push({ provide: MATTER_PHASE_LAYOUT_RULES, useValue: config.matterPhaseRules });
    }
    if (config.activeMatterPhase) {
      const phaseFactory = config.activeMatterPhase;
      providers.push({ provide: ACTIVE_MATTER_PHASE_SIGNAL, useFactory: phaseFactory });
    }
    providers.push({ provide: LAYOUT_INPUT, useExisting: MatterPhaseLayoutInput, multi: true });
  }

  if (config.alertRules || config.activeAlerts) {
    if (config.alertRules) {
      providers.push({ provide: ALERT_LAYOUT_RULES, useValue: config.alertRules });
    }
    if (config.activeAlerts) {
      const alertsFactory = config.activeAlerts;
      providers.push({ provide: ACTIVE_ALERTS_SIGNAL, useFactory: alertsFactory });
    }
    providers.push({ provide: LAYOUT_INPUT, useExisting: AlertLayoutInput, multi: true });
  }

  for (const inputClass of config.extraInputs ?? []) {
    providers.push({ provide: LAYOUT_INPUT, useExisting: inputClass, multi: true });
  }

  return makeEnvironmentProviders(providers);
}
