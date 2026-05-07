import { Injectable, inject } from '@angular/core';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import { RegistryBase } from './registry-base';
import type { DataSourceDef } from '../types/registry-defs';

/**
 * Typed view of a registered data source — the runtime entry whose
 * `adapter` signature has been narrowed to the caller's `<TQuery, TResult>`.
 *
 * The narrowing is a TypeScript-only convenience; the underlying
 * `DataSourceDef.adapter` stores a `(query: unknown) => unknown` shape
 * so the registry itself stays generic across tools and widgets.
 */
export interface TypedDataSource<TQuery, TResult> {
  readonly name: string;
  readonly kind: DataSourceDef['kind'];
  readonly adapter: (query: TQuery) => TResult;
}

/**
 * Thrown by {@link DataSourceRegistry.getTyped} when the requested name has
 * no matching registration. Carries the name and a snapshot of available
 * names so boot-time diagnostics are actionable.
 */
export class UnknownDataSourceError extends Error {
  constructor(public readonly sourceName: string, public readonly available: readonly string[]) {
    super(
      `No DataSource registered as ${JSON.stringify(sourceName)}. ` +
      `Available: [${available.map((n) => JSON.stringify(n)).join(', ')}]`,
    );
    this.name = 'UnknownDataSourceError';
  }
}

/**
 * Registry of data sources tools can read from. Tools call
 * `inject(DataSourceRegistry).get('flights').adapter(query)` instead of
 * hard-coding fetch URLs — enables stubbing in tests, per-env routing, and
 * MFE-aware overrides.
 *
 * Capability F2 adds {@link getTyped} for widgets that declare
 * `dataSources` in their `ComponentDef` and want a strongly-typed adapter
 * at call time, plus {@link missing} for mount-time validation.
 */
@Injectable({ providedIn: 'root' })
export class DataSourceRegistry extends RegistryBase<DataSourceDef> {
  protected readonly registryName = 'data-source';

  /**
   * Telemetry sink used to record `data_source.query_ms` histograms on
   * every adapter call routed through {@link getTyped}. Direct callers
   * of `get(name).adapter(...)` bypass the wrapper — those call sites
   * are responsible for their own instrumentation.
   */
  private readonly metrics = inject(AGENTIC_TELEMETRY_SINK);

  byKind(kind: DataSourceDef['kind']): readonly DataSourceDef[] {
    return this.list().filter((d) => d.kind === kind);
  }

  /**
   * Resolve `name` as a typed view of a registered source. Throws
   * {@link UnknownDataSourceError} when the registration is missing.
   * The `<TQuery, TResult>` generic is a compile-time narrowing only —
   * the registered adapter's actual shape is the runtime source of truth.
   *
   * The returned adapter is **wrapped with telemetry**: every call records
   * a `data_source.query_ms` histogram tagged with `name`, `kind`, and an
   * `ok` flag (`'true'` / `'false'`). Async results are awaited so the
   * histogram captures end-to-end latency including the network hop.
   */
  getTyped<TQuery, TResult>(name: string): TypedDataSource<TQuery, TResult> {
    const def = this.get(name);
    if (!def) throw new UnknownDataSourceError(name, this.list().map((d) => d.name));
    const sink = this.metrics;
    const sourceName = def.name;
    const sourceKind = def.kind;
    const baseAdapter = def.adapter;
    return {
      name: def.name,
      kind: def.kind,
      adapter: (query: TQuery): TResult => {
        const start = performance.now();
        const record = (ok: boolean): void => {
          sink.histogram('data_source.query_ms', performance.now() - start, {
            name: sourceName,
            kind: sourceKind,
            ok: ok ? 'true' : 'false',
          });
        };
        try {
          const result = baseAdapter(query as unknown);
          if (result !== null && typeof result === 'object' && typeof (result as PromiseLike<unknown>).then === 'function') {
            return (result as Promise<unknown>).then(
              (value) => { record(true); return value; },
              (err) => { record(false); throw err; },
            ) as unknown as TResult;
          }
          record(true);
          return result as TResult;
        } catch (err) {
          record(false);
          throw err;
        }
      },
    };
  }

  /**
   * Validate that every name in `required` resolves to a registered
   * source. Used by mount-time machinery (`<mvk-widget-container>` and
   * the composition branch of `<mvk-form-renderer>`) to surface
   * authoring errors at the moment of mount rather than at first call.
   *
   * Returns the list of missing names; an empty array means all declared
   * sources are present.
   */
  missing(required: readonly string[]): readonly string[] {
    if (required.length === 0) return [];
    const missing: string[] = [];
    for (const name of required) {
      if (!this.get(name)) missing.push(name);
    }
    return missing;
  }
}
