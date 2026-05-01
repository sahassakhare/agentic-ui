import type { EnvironmentInjector } from '@angular/core';
import { registerProductionConfigForm } from './forms/production-config-form';

/**
 * Secondary federation entry — exposes a function that registers the
 * production-config form against the host's `FormRegistry`. Forms
 * need an `EnvironmentInjector` at registration time, which the
 * pure-data `defineCapabilityModule` shape doesn't carry, so we
 * expose this helper alongside `./Capability`.
 *
 * The host's `loadDemoRemotes()` initialiser calls this immediately
 * after applying the capability — sequence guaranteed by promise chain.
 */
export function registerForms(env: EnvironmentInjector): void {
  registerProductionConfigForm(env);
}
