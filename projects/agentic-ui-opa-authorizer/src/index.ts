/**
 * @infra-tools/agentic-ui-opa-authorizer
 *
 * Optional runtime plugin that gates `ToolRegistry` /
 * `ComponentRegistry` reads via OPA decisions (Open Policy
 * Agent). Slice OPA-B / [ADR-040](../../../docs/adr/0040-opa-policy-integration.md).
 *
 * **Why this is a separate package**: ADR-010 D4 prohibits OPA in
 * the core lib. Adopters who don't want OPA pay nothing — they
 * never install this package.
 *
 * Architecture:
 * - `provideOpaAuthorizer({...})` installs a composing scope policy
 *   on `ToolRegistry` + `ComponentRegistry`. The policy reads from a
 *   per-(kind,name) decision cache; cache misses default to allow
 *   (or deny, configurable) and fire a background OPA call.
 * - `OpaAuthorizerService` owns the cache + decision queue. Hosts
 *   inject it directly to inspect cached decisions / force refresh.
 * - The catalog server's `/policy/decide` endpoint (ADR-040 / OPA-A)
 *   is the actual decision point. This plugin is a runtime client.
 *
 * @example
 * ```ts
 * import { provideOpaAuthorizer } from '@infra-tools/agentic-ui-opa-authorizer';
 *
 * provideAgenticPlatform({
 *   catalogUrl: 'https://catalog.example.com',
 *   tenantId: 'acme',
 *   getToken: () => oidc.getAccessToken(),
 *   capabilityAuthorizer: false,   // disable the lifecycle deny-list authorizer
 * }),
 * provideOpaAuthorizer({
 *   catalogUrl: 'https://catalog.example.com',
 *   tenantId: 'acme',
 *   getToken: () => oidc.getAccessToken(),
 *   subject: () => ({ persona: persona.active(), tenant: tenantId }),
 *   cacheTtlMs: 5_000,
 *   onMiss: 'allow',
 * }),
 * ```
 */

import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  type EnvironmentProviders,
  type Signal,
} from '@angular/core';
import {
  ToolRegistry,
  ComponentRegistry,
  AGENTIC_TELEMETRY_SINK,
  type RegistryScopePolicy,
} from '@infra-tools/agentic-ui';

export interface OpaAuthorizerOptions {
  readonly catalogUrl: string;
  readonly tenantId: string;
  readonly getToken: () => Promise<string | null | undefined> | string | null | undefined;
  /**
   * Function returning the `subject` to send in the decision input.
   * Typically the active persona + tenant + any host claims. Re-read
   * on every uncached decision call so persona changes propagate.
   */
  readonly subject?: () => Record<string, unknown>;
  /** Action string. Default `'invoke'`. */
  readonly action?: string;
  /** Decision cache TTL in ms. Default `5_000`. `0` disables caching. */
  readonly cacheTtlMs?: number;
  /**
   * What to do when a decision isn't cached yet (typical first read
   * after boot). Default `'allow'` — degrades gracefully, the
   * background fetch refines on next read. Set `'deny'` for strict
   * closed-allowlist behaviour.
   */
  readonly onMiss?: 'allow' | 'deny';
  /**
   * What to do when the decision call fails (catalog/OPA unreachable).
   * Default `'allow'`. `'deny'` for strict mode.
   */
  readonly onError?: 'allow' | 'deny';
  /** Test seam — override `globalThis.fetch`. */
  readonly fetchFn?: typeof fetch;
}

interface CacheEntry {
  readonly allow: boolean;
  readonly expiresAt: number;
}

/**
 * Service that owns the decision cache + OPA call dispatch. Hosts
 * can `inject` it to inspect cached decisions or force re-evaluation.
 */
@Injectable({ providedIn: 'root' })
export class OpaAuthorizerService {
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);
  private readonly destroyRef = inject(DestroyRef, { optional: true });

  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Set<string>();
  private readonly cacheVersion = signal(0);

  /** Reactive view: total cached entries. Useful for debug UI. */
  readonly cachedDecisions: Signal<number> = computed(() => {
    this.cacheVersion();
    return this.cache.size;
  });

  private options: OpaAuthorizerOptions | null = null;

  configure(options: OpaAuthorizerOptions): void {
    this.options = options;
    this.destroyRef?.onDestroy(() => this.cache.clear());
  }

  /**
   * Synchronous lookup. Used by the scope policy. Returns the cached
   * boolean OR — on cache miss — fires a background OPA call and
   * returns the configured `onMiss` default.
   */
  decide(kind: string, name: string): boolean {
    const opts = this.options;
    if (!opts) return true; // defensive: never configured
    const key = `${kind}:${name}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.allow;
    }
    // Cache miss / expired. Fire a refresh; return onMiss default.
    if (!this.inflight.has(key)) {
      this.inflight.add(key);
      void this.refreshOne(kind, name).finally(() => this.inflight.delete(key));
    }
    return (opts.onMiss ?? 'allow') === 'allow';
  }

  /** Force a refresh for one (kind, name) pair. Public for tests + ops. */
  async refreshOne(kind: string, name: string): Promise<boolean> {
    const opts = this.options;
    if (!opts) return true;
    const key = `${kind}:${name}`;
    const fetcher = opts.fetchFn ?? fetch;
    const subject = opts.subject ? opts.subject() : {};
    const action = opts.action ?? 'invoke';
    const url = `${stripTrail(opts.catalogUrl)}/v1/catalogs/${encodeURIComponent(opts.tenantId)}/policy/decide`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const token = await opts.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let allow: boolean;
    try {
      const res = await fetcher(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subject,
          action,
          resource: { kind, name },
        }),
      });
      if (!res.ok) {
        this.telemetry.emit('agentic.platform.opa.decision_failed', {
          'opa.kind': kind,
          'opa.name': name,
          'opa.http_status': res.status,
        });
        allow = (opts.onError ?? 'allow') === 'allow';
      } else {
        const body = await res.json() as { allow: boolean };
        allow = !!body.allow;
        this.telemetry.emit('agentic.platform.opa.decision', {
          'opa.kind': kind,
          'opa.name': name,
          'opa.allow': allow,
        });
      }
    } catch (err) {
      this.telemetry.emit('agentic.platform.opa.decision_failed', {
        'opa.kind': kind,
        'opa.name': name,
        'error.message': err instanceof Error ? err.message : String(err),
      });
      allow = (opts.onError ?? 'allow') === 'allow';
    }

    const ttl = opts.cacheTtlMs ?? 5_000;
    this.cache.set(key, { allow, expiresAt: ttl > 0 ? Date.now() + ttl : 0 });
    this.cacheVersion.update((n) => n + 1);
    return allow;
  }

  /**
   * Pre-fetch decisions for a list of (kind, name) entries — used at
   * boot when `prefetchOnBoot: true` is set on the provider.
   */
  async prefetch(entries: ReadonlyArray<{ kind: string; name: string }>): Promise<void> {
    await Promise.all(entries.map((e) => this.refreshOne(e.kind, e.name)));
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheVersion.update((n) => n + 1);
  }
}

// `composeWithOpaAuthorizer` lives in `./compose.ts` (no Angular
// imports) so it's testable via plain vitest. Re-export here for
// the public package surface.
export { composeWithOpaAuthorizer } from './compose.js';
import { composeWithOpaAuthorizer } from './compose.js';

export interface OpaAuthorizerProviderOptions extends OpaAuthorizerOptions {
  /**
   * Pre-fetch OPA decisions for every registered tool/widget at
   * boot. Default `false` — lazy decisions on first read with the
   * `onMiss` default until they cache. `true` blocks until all
   * decisions land (with parallel calls).
   */
  readonly prefetchOnBoot?: boolean;
}

export function provideOpaAuthorizer(
  options: OpaAuthorizerProviderOptions,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const svc = inject(OpaAuthorizerService);
      const tools = inject(ToolRegistry);
      const widgets = inject(ComponentRegistry);
      svc.configure(options);

      const innerToolsPolicy = tools.currentScopePolicy();
      const innerWidgetsPolicy = widgets.currentScopePolicy();
      tools.setScopePolicy(
        composeWithOpaAuthorizer(innerToolsPolicy, (k, n) => svc.decide(k, n), 'tool'),
      );
      widgets.setScopePolicy(
        composeWithOpaAuthorizer(innerWidgetsPolicy, (k, n) => svc.decide(k, n), 'component'),
      );

      if (options.prefetchOnBoot) {
        const entries = [
          ...tools.listRaw().map((t) => ({ kind: 'tool', name: t.name })),
          ...widgets.listRaw().map((w) => ({ kind: 'component', name: w.name })),
        ];
        void svc.prefetch(entries);
      }

      // Re-evaluate registries when the cache changes — the registry's
      // signal recomputation is what reflects allow/deny flips.
      effect(() => {
        svc.cachedDecisions();
        // Touching the registries triggers their filtered-signal
        // consumers to recompute. There's no-op API for this; reading
        // their signals from inside the effect is enough.
        tools.signal();
        widgets.signal();
      });
    }),
  ]);
}

function stripTrail(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
