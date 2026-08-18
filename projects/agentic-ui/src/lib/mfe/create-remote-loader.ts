import type { CapabilityModule } from './capability-module';
import type { RemoteSpec } from './manifest';

/** Resolves a remote's `./Capability` module. Pass the result to `loadRemoteCapabilities`. */
export type RemoteLoader = (spec: RemoteSpec) => Promise<{ readonly capability: CapabilityModule }>;

export interface RemoteLoaderOptions {
  /** Exposed module name; defaults to `./Capability`. */
  readonly exposedModule?: string;
  /**
   * Loader for `type: 'module-federation'` remotes (MF 2.0). The host supplies it —
   * typically `moduleFederationLoader(loadRemote)` from `/mfe-module-federation`,
   * backed by `@module-federation/runtime` — so the library never depends on the
   * MF runtime. `@module-federation/runtime` also consumes MF 1.0 remotes.
   */
  readonly moduleFederation?: RemoteLoader;
  /** Loader for `type: 'module-federation-1'` remotes (webpack MF 1.0), if handled separately. */
  readonly moduleFederationV1?: RemoteLoader;
}

/**
 * Build the right loader for a remote based on the federation runtime that built
 * it (`RemoteSpec.type`), so one registry can mix **Native Federation** and
 * **Module Federation 1.0 / 2.0** remotes.
 *
 * - `native-federation` (default) is handled directly here: it loads via the
 *   remote's `remoteEntry` URL, so a remote discovered at runtime (e.g. one
 *   ingested after boot, not in the static `federation.manifest.json`) is
 *   fetched + registered on demand rather than requiring a rebuilt host manifest.
 * - `module-federation` / `module-federation-1` delegate to a host-provided
 *   loader (kept out of the library so its dependency graph stays narrow).
 */
export function createRemoteLoader(remote: RemoteSpec, opts: RemoteLoaderOptions = {}): RemoteLoader {
  const exposedModule = opts.exposedModule ?? './Capability';
  switch (remote.type ?? 'native-federation') {
    case 'module-federation':
      if (!opts.moduleFederation) throw new Error(missingLoader(remote, 'module-federation'));
      return opts.moduleFederation;
    case 'module-federation-1':
      // A separate MF1 loader if given; otherwise MF 2.0's runtime handles MF1 too.
      if (opts.moduleFederationV1) return opts.moduleFederationV1;
      if (opts.moduleFederation) return opts.moduleFederation;
      throw new Error(missingLoader(remote, 'module-federation-1'));
    default:
      return async (spec) => {
        // Lazy import so the mfe barrel doesn't statically pull in the native-
        // federation runtime (kept out of non-federation code paths + test envs).
        const { loadRemoteModule } = await import('@angular-architects/native-federation');
        const mod = await loadRemoteModule<{ capability: CapabilityModule }>({
          remoteEntry: spec.remoteEntry, remoteName: spec.remoteName, exposedModule,
        });
        return { capability: mod.capability };
      };
  }
}

function missingLoader(remote: RemoteSpec, type: string): string {
  return `Remote "${remote.remoteName}" is type "${type}" but no loader was provided. `
    + `Install @module-federation/runtime and pass createRemoteLoader(remote, { moduleFederation: moduleFederationLoader(loadRemote) }).`;
}
