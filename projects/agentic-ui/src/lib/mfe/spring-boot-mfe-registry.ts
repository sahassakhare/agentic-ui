import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { Observable } from 'rxjs';
import { MFE_REGISTRY_SOURCE, type MfeRegistrySource } from './mfe-registry-source';
import { RemoteSpecSchema, type RemoteSpec } from './manifest';

export interface SpringBootMfeRegistryOptions {
  /** Base URL of the mfe-registry-platform service, e.g., 'https://registry.internal'. */
  readonly url: string;
  /** Optional bearer token or arbitrary headers. */
  readonly headers?: Record<string, string>;
  /** Override the path appended to `url` for discovery. Default `/mfes?env={env}`. */
  readonly discoveryPath?: (env: string) => string;
  /** Path appended to `url` for the SSE watch stream. Default `/mfes/watch?env={env}`. */
  readonly watchPath?: (env: string) => string;
  /**
   * If the Spring Boot record doesn't carry a capabilityManifestUrl, derive it from the record.
   * Default: `${record.deploymentUrl}/capabilities.json`.
   */
  readonly capabilityManifestResolver?: (record: Record<string, unknown>) => string | undefined;
  readonly fetchFn?: typeof fetch;
}

const DEFAULT_DISCOVERY_PATH = (env: string) => `/mfes?env=${encodeURIComponent(env)}`;
const DEFAULT_WATCH_PATH = (env: string) => `/mfes/watch?env=${encodeURIComponent(env)}`;
const DEFAULT_CAPABILITY_MANIFEST_RESOLVER = (record: Record<string, unknown>): string | undefined => {
  const deployment = typeof record['deploymentUrl'] === 'string' ? record['deploymentUrl'] : undefined;
  return deployment ? new URL('capabilities.json', ensureTrailingSlash(deployment)).toString() : undefined;
};

class SpringBootMfeRegistrySource implements MfeRegistrySource {
  readonly id = 'spring-boot';
  constructor(private readonly opts: SpringBootMfeRegistryOptions) {}

  async discover(env: string): Promise<readonly RemoteSpec[]> {
    const fetcher = this.opts.fetchFn ?? globalThis.fetch;
    const url = `${this.opts.url}${(this.opts.discoveryPath ?? DEFAULT_DISCOVERY_PATH)(env)}`;
    const res = await fetcher(url, { headers: { Accept: 'application/json', ...(this.opts.headers ?? {}) } });
    if (!res.ok) throw new Error(`Spring Boot registry discovery failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { mfes?: unknown[]; remotes?: unknown[] } | unknown[];
    const records = Array.isArray(body) ? body : (body.mfes ?? body.remotes ?? []);
    const resolver = this.opts.capabilityManifestResolver ?? DEFAULT_CAPABILITY_MANIFEST_RESOLVER;
    return (records as Record<string, unknown>[])
      .map((record) => normalizeRecord(record, resolver))
      .filter((spec): spec is RemoteSpec => spec !== undefined);
  }

  watch(env: string): Observable<readonly RemoteSpec[]> {
    const url = `${this.opts.url}${(this.opts.watchPath ?? DEFAULT_WATCH_PATH)(env)}`;
    return new Observable((subscriber) => {
      const es = new EventSource(url, { withCredentials: false });
      const handler = (ev: MessageEvent) => {
        try {
          const remotes = JSON.parse(ev.data) as unknown[];
          const resolver = this.opts.capabilityManifestResolver ?? DEFAULT_CAPABILITY_MANIFEST_RESOLVER;
          const parsed = (remotes as Record<string, unknown>[])
            .map((record) => normalizeRecord(record, resolver))
            .filter((s): s is RemoteSpec => s !== undefined);
          subscriber.next(parsed);
        } catch (err) {
          subscriber.error(err);
        }
      };
      es.addEventListener('mfes', handler);
      es.onerror = (err) => subscriber.error(err);
      return () => { es.removeEventListener('mfes', handler); es.close(); };
    });
  }
}

function normalizeRecord(record: Record<string, unknown>, resolver: (r: Record<string, unknown>) => string | undefined): RemoteSpec | undefined {
  const remoteName = record['remoteName'] ?? record['mfeId'];
  const version = record['version'];
  const remoteEntry = record['remoteEntry'] ?? record['remoteEntryUrl'];
  if (typeof remoteName !== 'string' || typeof version !== 'string' || typeof remoteEntry !== 'string') return undefined;
  const capabilityManifestUrl = (typeof record['capabilityManifestUrl'] === 'string' ? record['capabilityManifestUrl'] : undefined) ?? resolver(record);
  const candidate = {
    remoteName,
    version,
    remoteEntry,
    capabilityManifestUrl,
    env: typeof record['env'] === 'string' ? record['env'] : undefined,
    healthStatus: typeof record['healthStatus'] === 'string' ? record['healthStatus'] : undefined,
  };
  const parsed = RemoteSpecSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function ensureTrailingSlash(s: string): string {
  return s.endsWith('/') ? s : s + '/';
}

/** Provides a Spring-Boot-backed MfeRegistrySource at root scope. */
export function provideSpringBootMfeRegistry(opts: SpringBootMfeRegistryOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: MFE_REGISTRY_SOURCE, useFactory: () => new SpringBootMfeRegistrySource(opts) },
  ]);
}
