import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { Observable, of, Subject } from 'rxjs';
import { z } from 'zod';
import {
  MFE_REGISTRY_SOURCE,
  type MfeRegistrySource,
} from './mfe-registry-source';
import { RemoteSpecSchema, type RemoteSpec } from './manifest';

/**
 * Construction options for {@link RestMfeRegistrySource}, the runtime-tier
 * adapter that reads federated-remote manifests from the M2 control-plane
 * catalog server (`@maverick/agentic-catalog-server`, ADR-015).
 *
 * Wire this in your host's app config when the catalog server is the
 * source of truth for federation. For deployments without a catalog,
 * keep using {@link provideStaticJsonMfeRegistry}; it remains the
 * embedded-first default.
 */
export interface RestMfeRegistryOptions {
  /**
   * Catalog server base URL. The adapter requests
   * `${catalogUrl}/v1/catalogs/${tenantId}/mfes`. No trailing slash.
   *
   * @example "https://catalog.example.com"
   */
  readonly catalogUrl: string;

  /**
   * Tenant id to request remotes for. Must match the JWT's tenant
   * claim or the principal must have the `platform-admin` role
   * (catalog enforces this).
   */
  readonly tenantId: string;

  /**
   * Returns a Bearer token for the catalog server. Called per
   * `discover()` invocation (so token-rotation is automatic).
   * Returning `null` / `undefined` causes the adapter to omit the
   * Authorization header — only useful in development against a
   * catalog with auth disabled.
   *
   * Production hosts wire this to their OIDC client's silent-token
   * refresh pipeline (Auth0 SDK, msal-js, oidc-client-ts, etc.).
   */
  readonly getToken: () => Promise<string | null | undefined> | string | null | undefined;

  /**
   * Optional poll cadence for `watch()`. When set, the source
   * re-fetches at this interval and emits a fresh list to
   * subscribers. Default: no polling (`watch()` emits the last-known
   * list once).
   *
   * SSE-based push updates are on the v0.2 catalog-server roadmap;
   * until then, polling is the propagation mechanism.
   */
  readonly refreshIntervalMs?: number;

  /**
   * Optional fallback URL when the catalog is unreachable. Typical
   * pattern: ship the host with a bundled `mfes.json` that the
   * adapter falls back to during catalog outages. Without a fallback,
   * `discover()` rejects and the host's federation graph stays empty
   * until the catalog recovers.
   */
  readonly staticFallbackUrl?: string;

  /**
   * Optional fetch override — used mostly by tests, but also useful
   * for hosts that want to thread tracing headers / a custom
   * keep-alive agent. Must conform to the standard `fetch` signature.
   */
  readonly fetchFn?: typeof fetch;

  /**
   * Per-request timeout in milliseconds. Default: 5_000.
   */
  readonly timeoutMs?: number;
}

/**
 * Catalog response shape for `GET /v1/catalogs/{tenant}/mfes`.
 * Mirrors the server's `MfeRemoteSchema` minus the catalog-internal
 * fields the runtime doesn't need (id, tenantId, timestamps).
 */
const CatalogMfeRemoteSchema = z.object({
  name: z.string(),
  manifestUrl: z.string(),
  version: z.string().nullable(),
  requiredHostVersion: z.string().nullable(),
  exposes: z.record(z.string(), z.array(z.string())),
  status: z.enum(['active', 'inactive', 'degraded']),
});
type CatalogMfeRemote = z.infer<typeof CatalogMfeRemoteSchema>;

const CatalogResponseSchema = z.object({
  items: z.array(CatalogMfeRemoteSchema),
});

export class RestMfeRegistrySource implements MfeRegistrySource {
  readonly id = 'catalog-rest';
  private lastKnown: readonly RemoteSpec[] = [];

  constructor(private readonly opts: RestMfeRegistryOptions) {}

  async discover(env: string): Promise<readonly RemoteSpec[]> {
    try {
      const remotes = await this.fetchFromCatalog(env);
      this.lastKnown = remotes;
      return remotes;
    } catch (err) {
      // Try the fallback URL if configured. Falling back is a
      // graceful degradation — log to caller so they can wire
      // alerting if they want.
      if (this.opts.staticFallbackUrl) {
        const fallback = await this.fetchFromFallback();
        if (fallback) {
          this.lastKnown = fallback;
          return fallback;
        }
      }
      // Re-throw so the caller can decide what to do; lastKnown
      // stays stable if discover was previously successful.
      throw err;
    }
  }

  watch(env: string): Observable<readonly RemoteSpec[]> {
    if (!this.opts.refreshIntervalMs) {
      return of(this.lastKnown);
    }
    return new Observable<readonly RemoteSpec[]>((subscriber) => {
      const subject = new Subject<readonly RemoteSpec[]>();
      const sub = subject.subscribe(subscriber);
      let active = true;
      const tick = async () => {
        try {
          const remotes = await this.discover(env);
          if (active) subject.next(remotes);
        } catch (err) {
          // Don't tear down the subscription on a single failure —
          // network blips happen. Re-emit the last-known list and
          // wait for the next tick.
          if (active && this.lastKnown.length > 0) {
            subject.next(this.lastKnown);
          } else if (active) {
            subject.error(err);
          }
        }
      };
      void tick();
      const interval = setInterval(() => void tick(), this.opts.refreshIntervalMs);
      return () => {
        active = false;
        clearInterval(interval);
        sub.unsubscribe();
      };
    });
  }

  private async fetchFromCatalog(_env: string): Promise<readonly RemoteSpec[]> {
    void _env; // env-scoping is part of the interface; catalog uses tenant scoping instead.
    const fetcher = this.opts.fetchFn ?? globalThis.fetch;
    const url = `${this.opts.catalogUrl.replace(/\/$/, '')}/v1/catalogs/${encodeURIComponent(this.opts.tenantId)}/mfes`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = await this.opts.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 5_000);
    try {
      const res = await fetcher(url, { headers, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Catalog fetch failed: ${res.status} ${res.statusText}`);
      }
      const body = await res.json();
      const parsed = CatalogResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error(`Catalog response failed validation: ${parsed.error.message}`);
      }
      return parsed.data.items.map(toRemoteSpec);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchFromFallback(): Promise<readonly RemoteSpec[] | null> {
    if (!this.opts.staticFallbackUrl) return null;
    const fetcher = this.opts.fetchFn ?? globalThis.fetch;
    try {
      const res = await fetcher(this.opts.staticFallbackUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const body = (await res.json()) as { remotes?: unknown };
      const remotes = Array.isArray(body.remotes) ? body.remotes : [];
      return remotes
        .map((r) => RemoteSpecSchema.safeParse(r))
        .filter((p): p is { success: true; data: RemoteSpec } => p.success)
        .map((p) => p.data);
    } catch {
      return null;
    }
  }
}

/**
 * Map a catalog `MfeRemote` shape to the runtime's `RemoteSpec`. The
 * catalog stores rich metadata; the runtime only needs the federation
 * essentials (name, entry, version, health). Extra fields the runtime
 * doesn't yet consume (`exposes`, `requiredHostVersion`) are dropped
 * here — they're available via the catalog's full
 * `/v1/catalogs/{tenant}/mfes/{name}` endpoint when needed.
 */
function toRemoteSpec(catalog: CatalogMfeRemote): RemoteSpec {
  return {
    remoteName: catalog.name,
    version: catalog.version ?? 'unknown',
    remoteEntry: catalog.manifestUrl,
    healthStatus: mapHealthStatus(catalog.status),
  };
}

function mapHealthStatus(status: CatalogMfeRemote['status']): RemoteSpec['healthStatus'] {
  switch (status) {
    case 'active':   return 'healthy';
    case 'degraded': return 'degraded';
    case 'inactive': return 'down';
  }
}

/**
 * Provides a {@link RestMfeRegistrySource} at root scope. Use when
 * the M2 control-plane catalog server is the source of truth for
 * federation manifests.
 *
 * @example
 * ```ts
 * // app.config.ts
 * provideRestMfeRegistry({
 *   catalogUrl: environment.catalogUrl,
 *   tenantId: environment.tenantId,
 *   getToken: () => inject(AuthService).accessToken(),
 *   refreshIntervalMs: 30_000,
 *   staticFallbackUrl: '/mfes.json',  // graceful catalog-outage fallback
 * }),
 * ```
 */
export function provideRestMfeRegistry(opts: RestMfeRegistryOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: MFE_REGISTRY_SOURCE, useFactory: () => new RestMfeRegistrySource(opts) },
  ]);
}
