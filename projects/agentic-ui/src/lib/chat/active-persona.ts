import { InjectionToken } from '@angular/core';

/**
 * Injection token returning the active persona's role identifier.
 *
 * Wired by the host (e.g. eDiscovery's `PersonaService.active`) and
 * consumed by Capability F4's approval intercept to decide whether a
 * given tool call needs HITL. Defaults to `() => ''` so libraries
 * that don't wire personas still see a stable empty string and can
 * `required: () => true` without referencing the value.
 *
 * @example
 * ```ts
 * provideEnvironmentInitializer(() => {
 *   const personaService = inject(PersonaService);
 *   // tell the lib how to read the active persona
 *   provideAgenticActivePersona(() => personaService.active());
 * });
 * ```
 */
export const AGENTIC_ACTIVE_PERSONA = new InjectionToken<() => string>(
  'AGENTIC_ACTIVE_PERSONA',
  { providedIn: 'root', factory: () => () => '' },
);
