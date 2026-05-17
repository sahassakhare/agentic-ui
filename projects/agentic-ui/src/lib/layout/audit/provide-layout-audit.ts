import type { EnvironmentProviders, Provider } from '@angular/core';
import {
  ENVIRONMENT_INITIALIZER,
  EnvironmentInjector,
  inject,
  makeEnvironmentProviders,
  runInInjectionContext,
} from '@angular/core';
import { LayoutAuditTracker } from './layout-audit-tracker';
import {
  LAYOUT_AUDIT_ATTRIBUTION,
  LAYOUT_AUDIT_SINK,
  type LayoutAuditSink,
} from './types';

export interface LayoutAuditConfig {
  /**
   * Sink callback — wired to receive every emitted
   * `LayoutAppliedEvent`. Adopters bind their existing audit
   * pipeline here. Runs in DI context.
   */
  readonly sink?: () => LayoutAuditSink;
  /**
   * Attribution factory — returns the static metadata attached to
   * every emitted event (userId, matterId, route, tenantId). Re-
   * evaluated per event so signal-backed values stay current.
   */
  readonly attribution?: () => Record<string, string>;
  /**
   * Eagerly instantiate `LayoutAuditTracker` at app boot. Default
   * `true` — the tracker only starts watching when its constructor
   * runs, so most hosts will want it auto-started.
   */
  readonly eager?: boolean;
}

/**
 * Wire `LayoutAuditTracker` into the DI tree. By default eagerly
 * instantiates the tracker so chain capture starts at boot, before
 * any layout resolution happens.
 *
 * Typical wiring:
 *
 * ```ts
 * provideLayoutAudit({
 *   sink: () => ({
 *     emit: (event) => {
 *       // forward into existing audit pipeline
 *       appendAudit({ kind: 'LAYOUT_APPLIED', ...event });
 *     },
 *   }),
 *   attribution: () => ({
 *     userId: inject(CurrentUser).id() ?? 'anonymous',
 *     matterId: inject(MatterStore).id() ?? '',
 *     route: inject(Router).url,
 *   }),
 * });
 * ```
 *
 * @see [ADR-046 D4](../../../../../docs/adr/0046-layered-layout-engine.md)
 */
export function provideLayoutAudit(config: LayoutAuditConfig = {}): EnvironmentProviders {
  const providers: Provider[] = [];
  if (config.sink) {
    const sinkFactory = config.sink;
    providers.push({ provide: LAYOUT_AUDIT_SINK, useFactory: sinkFactory });
  }
  if (config.attribution) {
    const attributionFactory = config.attribution;
    // Wrap the user's function so it always runs in an injection
    // context. The audit tracker calls LAYOUT_AUDIT_ATTRIBUTION from
    // inside its watching effect(), which is NOT an injection context
    // — calling inject() in the user's factory there throws NG0203.
    // Capture the EnvironmentInjector at DI time + use it to scope
    // each call. Adopters can freely inject inside their factory.
    providers.push({
      provide: LAYOUT_AUDIT_ATTRIBUTION,
      useFactory: () => {
        const env = inject(EnvironmentInjector);
        return () => runInInjectionContext(env, attributionFactory);
      },
    });
  }
  if (config.eager !== false) {
    // ENVIRONMENT_INITIALIZER token — Angular runs every multi value
    // at app boot inside an injection context, so `inject()` works.
    // Touches LayoutAuditTracker so its constructor + watching
    // effect() start before any layout resolution happens. (Previous
    // implementation used a string-token + useFactory, which silently
    // never runs because nothing injects that string token.)
    providers.push({
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        inject(LayoutAuditTracker);
      },
    });
  }
  return makeEnvironmentProviders(providers);
}
