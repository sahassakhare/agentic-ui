import {
  loadRemoteCapabilities,
  type CapabilityModule,
  type LoadedRemote,
  type RemoteLoader,
  type RemoteSpec,
} from '../mfe';

/**
 * Convenience wrapper around `loadRemoteCapabilities` for consumers using
 * webpack Module Federation. Expects `@module-federation/runtime` (or a
 * compatible shim) registered in the host's bootstrap.
 *
 * The library does NOT depend on `@module-federation/runtime` directly — pass
 * the `loadRemote` function in to keep the dep graph narrow:
 *
 *   import { loadRemote, init } from '@module-federation/runtime';
 *   init({ name: 'host', remotes: [...] });
 *   const remote = await loadRemoteCapabilitiesMF({
 *     remote: { remoteName: 'bookings', version: '1.0.0', remoteEntry: '...' },
 *     loadRemote,
 *     exposedModule: './Capability',
 *   });
 */
export interface LoadRemoteCapabilitiesMFOptions {
  readonly remote: RemoteSpec;
  /** `loadRemote` from `@module-federation/runtime`, or any compatible loader. */
  readonly loadRemote: <T>(name: string) => Promise<T>;
  /** Exposed module name; defaults to `./Capability`. */
  readonly exposedModule?: string;
  readonly prefetchManifest?: boolean;
  readonly fetchFn?: typeof fetch;
}

/**
 * Adapt a Module Federation `loadRemote` (from `@module-federation/runtime`, which
 * handles both MF 2.0 and MF 1.0 remotes) into a {@link RemoteLoader} for
 * `createRemoteLoader(remote, { moduleFederation: moduleFederationLoader(loadRemote) })`.
 * The host owns the MF runtime + its `init(...)`, so the library stays free of it.
 *
 *   import { init, loadRemote } from '@module-federation/runtime';
 *   init({ name: 'host', remotes: [{ name: r.remoteName, entry: r.remoteEntry }] });
 *   const loader = createRemoteLoader(r, { moduleFederation: moduleFederationLoader(loadRemote) });
 */
export function moduleFederationLoader(
  loadRemote: <T>(name: string) => Promise<T>,
  exposedModule = './Capability',
): RemoteLoader {
  return (spec) =>
    loadRemote<{ readonly capability: CapabilityModule }>(`${spec.remoteName}/${exposedModule.replace(/^\.\//, '')}`);
}

export function loadRemoteCapabilitiesMF(opts: LoadRemoteCapabilitiesMFOptions): Promise<LoadedRemote> {
  const exposedModule = opts.exposedModule ?? './Capability';
  return loadRemoteCapabilities({
    remote: opts.remote,
    loader: async (spec) => {
      const moduleId = `${spec.remoteName}/${exposedModule.replace(/^\.\//, '')}`;
      const mod = await opts.loadRemote<{ readonly capability: CapabilityModule }>(moduleId);
      return mod;
    },
    prefetchManifest: opts.prefetchManifest,
    fetchFn: opts.fetchFn,
  });
}
