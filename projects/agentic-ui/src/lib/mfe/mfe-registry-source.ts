import { EnvironmentProviders, inject, Injectable, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { Observable, of } from 'rxjs';
import type { RemoteSpec } from './manifest';
import { RemoteSpecSchema } from './manifest';

/**
 * Pluggable source for MFE deployment metadata. Implementations include:
 *  - Spring Boot REST adapter (provideSpringBootMfeRegistry)
 *  - Static JSON adapter (provideStaticJsonMfeRegistry)
 * Apps add their own (Consul, Etcd, internal REST) without forking the lib.
 */
export interface MfeRegistrySource {
  readonly id: string;
  discover(env: string): Promise<readonly RemoteSpec[]>;
  /** Optional live updates (Spring Boot via SSE, Consul via watch). */
  watch?(env: string): Observable<readonly RemoteSpec[]>;
}

export const MFE_REGISTRY_SOURCE = new InjectionToken<MfeRegistrySource>('MFE_REGISTRY_SOURCE');

export interface StaticJsonMfeRegistryOptions {
  /** URL of the JSON document. The document must be `{ remotes: RemoteSpec[] }`. */
  readonly url: string;
  /** If set, the source poll-refreshes at this cadence and re-emits via `watch()`. */
  readonly refreshIntervalMs?: number;
  /** Optional fetch override for testing or auth headers. */
  readonly fetchFn?: typeof fetch;
}

class StaticJsonMfeRegistrySource implements MfeRegistrySource {
  readonly id = 'static-json';
  private cached?: readonly RemoteSpec[];

  constructor(private readonly opts: StaticJsonMfeRegistryOptions) {}

  async discover(_env: string): Promise<readonly RemoteSpec[]> {
    void _env;
    const fetcher = this.opts.fetchFn ?? globalThis.fetch;
    const res = await fetcher(this.opts.url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Static JSON registry fetch failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { remotes?: unknown };
    const remotes = Array.isArray(body.remotes) ? body.remotes : [];
    const parsed = remotes
      .map((r) => RemoteSpecSchema.safeParse(r))
      .filter((p): p is { success: true; data: RemoteSpec } => p.success)
      .map((p) => p.data);
    this.cached = parsed;
    return parsed;
  }

  watch(env: string): Observable<readonly RemoteSpec[]> {
    if (!this.opts.refreshIntervalMs) return of(this.cached ?? []);
    return new Observable((subscriber) => {
      let active = true;
      const tick = async () => {
        try {
          const remotes = await this.discover(env);
          if (active) subscriber.next(remotes);
        } catch (err) {
          if (active) subscriber.error(err);
        }
      };
      void tick();
      const interval = setInterval(() => void tick(), this.opts.refreshIntervalMs);
      return () => { active = false; clearInterval(interval); };
    });
  }
}

/** Provides a static-JSON-backed MfeRegistrySource at root scope. */
export function provideStaticJsonMfeRegistry(opts: StaticJsonMfeRegistryOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: MFE_REGISTRY_SOURCE, useFactory: () => new StaticJsonMfeRegistrySource(opts) },
  ]);
}

/** Front-door client for resolving remotes from the configured MfeRegistrySource. */
@Injectable({ providedIn: 'root' })
export class MfeRegistryClient {
  private readonly source = inject(MFE_REGISTRY_SOURCE, { optional: true });

  /** Returns the configured source or `undefined` if none was provided. */
  getSource(): MfeRegistrySource | undefined {
    return this.source ?? undefined;
  }

  async discover(env = 'default'): Promise<readonly RemoteSpec[]> {
    if (!this.source) {
      throw new Error('No MfeRegistrySource configured. Call provideStaticJsonMfeRegistry(...) or provideSpringBootMfeRegistry(...).');
    }
    return this.source.discover(env);
  }

  watch(env = 'default'): Observable<readonly RemoteSpec[]> | undefined {
    return this.source?.watch?.(env);
  }
}
