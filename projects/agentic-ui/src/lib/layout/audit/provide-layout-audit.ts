import type { EnvironmentProviders, Provider } from '@angular/core';
import { inject, makeEnvironmentProviders } from '@angular/core';
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
    providers.push({ provide: LAYOUT_AUDIT_ATTRIBUTION, useValue: attributionFactory });
  }
  if (config.eager !== false) {
    // EnvironmentInitializer that touches `LayoutAuditTracker` so its
    // constructor (and the watching `effect()`) runs at app boot.
    providers.push({
      provide: 'LayoutAuditEagerInit',
      useFactory: () => inject(LayoutAuditTracker),
    });
  }
  return makeEnvironmentProviders(providers);
}
