/**
 * On-demand resolver for federated `kind:'component'` catalog rows.
 *
 * The component-ingest service builds an uploaded/npm Angular library into a
 * Native-Federation remote and registers one `kind:'component'` catalog row per
 * discovered component. Each federated row is **self-describing** — it carries
 * its own `remoteName` + `manifestUrl` (the remoteEntry URL) + `exposedModule`
 * (`./Capability`). This service reads that and loads the remote **lazily**, the
 * first time a component surface actually needs it, then hands off to the host's
 * `ComponentRegistry` (which `<mvk-widget-container>` resolves by name).
 *
 * This complements the eager MFE-registry discovery in `provideCatalogRuntime`
 * (which bulk-loads every remote listed in `registry.json` at bootstrap): here
 * the *catalog row itself* is the source of truth, so a component renders even
 * when it isn't in the host's configured registry env — and only the remotes a
 * page references are ever fetched, not all 200-odd ingested ones.
 */
import { EnvironmentInjector, InjectionToken, Injectable, inject, runInInjectionContext } from '@angular/core';
import {
  ComponentRegistry, loadRemoteCapabilities, createRemoteLoader,
  type RemoteSpec, type CapabilityModule,
} from '@infra-tools/agentic-ui';
import { CatalogClient } from './catalog-client';

/**
 * Loads a remote's exposed `CapabilityModule` for a federated component. Defaults
 * to a Native-Federation loader (`createRemoteLoader`); a host on a different
 * bundler (Module Federation) — or a test — can override it. Mirrors the
 * bundler-agnostic `loader` seam on `loadRemoteCapabilities`.
 */
export type CatalogRemoteLoader =
  (remote: RemoteSpec, exposedModule: string) => Promise<{ readonly capability: CapabilityModule }>;

/** Override the federation loader used to resolve federated catalog components. */
export const CATALOG_REMOTE_LOADER = new InjectionToken<CatalogRemoteLoader>('CATALOG_REMOTE_LOADER');

/** The federated slice of a `kind:'component'` catalog `body` (preview-only rows omit these). */
interface FederatedComponentBody {
  readonly remoteName?: string;
  readonly version?: string;
  /** The remote's `remoteEntry.json` URL (named `manifestUrl` in the ingest body). */
  readonly manifestUrl?: string;
  /** Exposed module key — the ingest service always exposes `./Capability`. */
  readonly exposedModule?: string;
}

interface ComponentRow {
  readonly name: string;
  readonly body?: FederatedComponentBody;
}

/**
 * Outcome of resolving a component by name:
 * - `ready` — the widget is registered and renderable.
 * - `not-federated` — no row, or a preview-only row (no remote to load).
 * - `load-failed` — the remote failed to load (network / build / federation error).
 * - `unknown` — the remote loaded but did not register a widget of that name.
 */
export type ComponentResolution = 'ready' | 'not-federated' | 'load-failed' | 'unknown';

@Injectable({ providedIn: 'root' })
export class CatalogComponentSource {
  private readonly registry = inject(ComponentRegistry);
  private readonly client = inject(CatalogClient);
  private readonly injector = inject(EnvironmentInjector);
  private readonly loaderOverride = inject(CATALOG_REMOTE_LOADER, { optional: true });

  /** Component rows indexed by name — fetched once, lazily, on first `ensure()`. */
  private rowsPromise?: Promise<Map<string, ComponentRow>>;
  /** One in-flight/settled load promise per `remoteName`, so a remote loads at most once. */
  private readonly remoteLoads = new Map<string, Promise<void>>();

  /**
   * Ensure the widget `name` is registered, loading its federated remote on
   * demand. Idempotent + deduped per remote — safe to call from a render effect.
   */
  async ensure(name: string): Promise<ComponentResolution> {
    if (this.registry.getRaw(name)) return 'ready';
    const body = (await this.rows()).get(name)?.body;
    if (!body?.remoteName || !body.manifestUrl) return 'not-federated';
    try {
      await this.loadRemote(body);
    } catch {
      return 'load-failed';
    }
    return this.registry.getRaw(name) ? 'ready' : 'unknown';
  }

  private rows(): Promise<Map<string, ComponentRow>> {
    return (this.rowsPromise ??= this.client
      .listByKind<ComponentRow>('component')
      .then((items) => new Map(items.map((c) => [c.name, c])))
      .catch(() => new Map<string, ComponentRow>()));
  }

  private loadRemote(body: FederatedComponentBody): Promise<void> {
    const remoteName = body.remoteName!;
    let load = this.remoteLoads.get(remoteName);
    if (!load) {
      const remote: RemoteSpec = {
        remoteName,
        version: body.version ?? '0.0.0',
        remoteEntry: body.manifestUrl!,
      };
      const exposedModule = body.exposedModule ?? './Capability';
      const loader = this.loaderOverride
        ? (spec: RemoteSpec) => this.loaderOverride!(spec, exposedModule)
        : createRemoteLoader(remote, { exposedModule });
      // `loadRemoteCapabilities` injects host registries synchronously before its
      // first await, so it must start inside the captured injection context.
      load = runInInjectionContext(this.injector, () =>
        loadRemoteCapabilities({ remote, loader }),
      ).then(() => undefined);
      // Cache the promise even if it rejects so a broken remote isn't retried in a
      // hot render loop; drop it on failure so a later reload can try afresh.
      load.catch(() => this.remoteLoads.delete(remoteName));
      this.remoteLoads.set(remoteName, load);
    }
    return load;
  }
}
