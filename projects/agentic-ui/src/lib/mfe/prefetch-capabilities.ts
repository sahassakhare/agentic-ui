import type { EnvironmentInjector } from '@angular/core';
import { runInInjectionContext } from '@angular/core';
import { CapabilityRegistry } from '../registries/capability-registry';
import { CapabilityManifestSchema, type RemoteSpec } from './manifest';
import type { CapabilityDef } from '../types/registry-defs';

/**
 * Fetch a remote's `capabilities.json` and register it with
 * `CapabilityRegistry` as **metadata only** — without loading the
 * remote's federated bundle.
 *
 * @remarks
 * This unlocks the federation-scale story:
 *
 *  1. Host calls `prefetchCapabilities(...)` for every known remote at
 *     boot — cheap, parallel, no JS evaluated.
 *  2. The `CapabilityRegistry` signal now carries the full topology
 *     (which remote contributes which tool/component names).
 *  3. The host's tool filter (or system-prompt builder) uses those
 *     names to decide what to send the LLM, with no bundle cost paid.
 *  4. When the agent actually invokes a tool, the host calls
 *     `loadRemoteCapabilities(...)` for that specific remote — the
 *     bundle hydrates, the real `ToolDef.handler` becomes available,
 *     and the call proceeds.
 *
 * At 50+ remotes this is the difference between fetching 50 bundles
 * at boot (multiple MB) and fetching 50 small JSON manifests
 * (a few KB total).
 *
 * @returns The `CapabilityDef` that was registered, so callers can do
 *          additional bookkeeping if they want.
 *
 * @example
 * ```ts
 * import { prefetchCapabilities, MfeRegistryClient } from '@maverick/agentic-ui';
 *
 * const remotes = await client.discover('dev');
 * await Promise.all(remotes.map((r) => prefetchCapabilities({ remote: r, injector })));
 * // CapabilityRegistry now lists every remote's tool/widget names
 * // even though no remote bundle has been hydrated.
 * ```
 */
export interface PrefetchCapabilitiesOptions {
  readonly remote: RemoteSpec;
  /**
   * Custom fetch implementation. Defaults to `globalThis.fetch`.
   * Override for tests, custom auth, retries, etc.
   */
  readonly fetchFn?: typeof fetch;
  /**
   * Where the host runs the registration. Use the same injector you'd
   * pass to `loadRemoteCapabilities` so the registry singleton is
   * resolved consistently.
   */
  readonly injector: EnvironmentInjector;
}

export async function prefetchCapabilities(options: PrefetchCapabilitiesOptions): Promise<CapabilityDef> {
  const url =
    options.remote.capabilityManifestUrl ??
    deriveManifestUrl(options.remote.remoteEntry);
  if (!url) {
    throw new Error(
      `prefetchCapabilities: remote "${options.remote.remoteName}" has no capabilityManifestUrl ` +
      `and the URL could not be derived from remoteEntry — set capabilityManifestUrl explicitly.`,
    );
  }

  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(
      `prefetchCapabilities: ${url} returned ${res.status} ${res.statusText}`,
    );
  }
  const raw = await res.json();
  const manifest = CapabilityManifestSchema.parse(raw);

  const def: CapabilityDef = {
    name: manifest.remoteName,
    remoteName: manifest.remoteName,
    version: manifest.version,
    exposes: {
      tools: manifest.exposes.tools,
      components: manifest.exposes.components,
      actions: manifest.exposes.actions,
      forms: manifest.exposes.forms,
      prompts: manifest.exposes.prompts,
    },
    manifestUrl: url,
    source: `remote:${manifest.remoteName}`,
  };

  runInInjectionContext(options.injector, () => {
    options.injector.get(CapabilityRegistry).register(def);
  });

  return def;
}

/**
 * Best-effort derivation of a remote's `capabilities.json` URL from its
 * `remoteEntry.json` URL. Convention: `capabilities.json` is a sibling
 * of the federation entry. Returns `null` if the URL doesn't fit a
 * recognisable shape.
 */
function deriveManifestUrl(remoteEntry: string): string | null {
  try {
    const u = new URL(remoteEntry);
    const dir = u.pathname.replace(/\/[^/]+$/, '/');
    return new URL(`${dir}capabilities.json`, u).toString();
  } catch {
    return null;
  }
}
