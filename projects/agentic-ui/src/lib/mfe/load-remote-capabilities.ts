import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import {
  AGENTIC_TELEMETRY_SINK,
  CapabilityRegistry,
  ComponentRegistry,
  ToolRegistry,
} from '../internal';
import type { CapabilityModule } from './capability-module';
import { CapabilityManifestSchema, type CapabilityManifest, type RemoteSpec } from './manifest';

export interface LoadRemoteCapabilitiesOptions {
  readonly remote: RemoteSpec;
  /**
   * Bundler-specific module loader. Provide:
   *   - Native Federation: `(spec) => loadRemoteModule({ remoteName: spec.remoteName, exposedModule: './Capability' })`
   *   - Module Federation: a thin wrapper around `@module-federation/runtime`'s loadRemote.
   * The library stays bundler-agnostic; the consumer wires the federation runtime they use.
   */
  readonly loader: (spec: RemoteSpec) => Promise<{ readonly capability: CapabilityModule }>;
  /** Optional manifest prefetch — populates CapabilityRegistry's `exposes` ahead of load. */
  readonly prefetchManifest?: boolean;
  /** Optional override for `fetch` (used for prefetch). */
  readonly fetchFn?: typeof fetch;
}

export interface LoadedRemote {
  readonly remote: RemoteSpec;
  readonly module: CapabilityModule;
  /** Disposer that unwinds registry registration; call when the remote unloads. */
  readonly dispose: () => void;
}

/**
 * Loads a remote MFE's CapabilityModule, applies it to the host's registries,
 * and returns a disposer for teardown. Bundler-agnostic — pass a Native
 * Federation or Module Federation loader as `options.loader`.
 *
 * Must be called inside an Angular injection context (component, route
 * resolver, environment initializer, etc.) so the host's `EnvironmentInjector`
 * is captured for the remote's tool-call dispatch boundary.
 */
export async function loadRemoteCapabilities(options: LoadRemoteCapabilitiesOptions): Promise<LoadedRemote> {
  const hostInjector = inject(EnvironmentInjector);
  const telemetry = inject(AGENTIC_TELEMETRY_SINK);

  const span = telemetry.startSpan('agentic.federation.load.start', {
    'mfe.remote_name': options.remote.remoteName,
    'mfe.version': options.remote.version,
    'mfe.remote_entry': options.remote.remoteEntry,
  });

  let prefetched: CapabilityManifest | undefined;
  if (options.prefetchManifest && options.remote.capabilityManifestUrl) {
    prefetched = await prefetchManifest(options.remote.capabilityManifestUrl, options.fetchFn);
  }

  // Capture HOST registry instances eagerly. When host + remote each bundle
  // their own copy of the lib, the remote's `apply()` lookup against its own
  // class identity would resolve a *different* (empty) instance. Passing
  // host instances directly bypasses that.
  const hostRegistries = runInInjectionContext(hostInjector, () => ({
    tools: inject(ToolRegistry),
    components: inject(ComponentRegistry),
    capabilities: inject(CapabilityRegistry),
  }));

  try {
    const { capability } = await options.loader(options.remote);
    const dispose = capability.apply(hostRegistries);

    span.end({
      'mfe.capability_count':
        capability.tools.length + capability.components.length,
      'mfe.prefetched': Boolean(prefetched),
    });

    return { remote: options.remote, module: capability, dispose };
  } catch (err) {
    span.recordError(err);
    span.end({ 'mfe.load.outcome': 'error' });
    throw err;
  }
}

async function prefetchManifest(url: string, fetchFn?: typeof fetch): Promise<CapabilityManifest | undefined> {
  const fetcher = fetchFn ?? globalThis.fetch;
  try {
    const res = await fetcher(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return undefined;
    const body = await res.json();
    const parsed = CapabilityManifestSchema.safeParse(body);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
