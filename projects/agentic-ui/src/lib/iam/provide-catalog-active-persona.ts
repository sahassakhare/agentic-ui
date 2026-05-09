import {
  Injectable,
  inject,
  signal,
  type Signal,
  makeEnvironmentProviders,
  type EnvironmentProviders,
  DestroyRef,
} from '@angular/core';
import { AGENTIC_ACTIVE_PERSONA } from '../chat/active-persona';
import { resolveActivePersona } from './catalog-iam-client';
import {
  readJwtPayload,
  extractClaimValues,
  readTenantId,
} from './jwt-claims';

/**
 * Configuration for {@link provideCatalogActivePersona}. The runtime
 * adapter that maps an OIDC user to a runtime persona via the
 * control-plane catalog server (M2 C3 / [ADR-016](../../../../../docs/adr/0016-iam-role-mapping.md)).
 *
 * Hosts that don't run a catalog server should keep using the
 * existing static wire-up (`AGENTIC_ACTIVE_PERSONA` provided directly
 * with a host-owned factory). This helper is opt-in.
 */
export interface CatalogActivePersonaOptions {
  /**
   * Catalog server base URL. The adapter posts to
   * `${catalogUrl}/v1/catalogs/${tenantId}/role-mappings/resolve`.
   * No trailing slash.
   */
  readonly catalogUrl: string;

  /**
   * Bearer-token source. Called immediately and on every
   * `refresh()`. The adapter never caches the token internally; it
   * relies on the host's OIDC client to do silent refresh and
   * surface the latest token through this callable.
   *
   * Returning `null` / `undefined` is acceptable in development
   * against a catalog with auth disabled; production hosts must
   * always return a valid JWT.
   */
  readonly getToken: () => Promise<string | null | undefined> | string | null | undefined;

  /**
   * Persona to activate when (a) the catalog is unreachable, (b) the
   * resolve endpoint returns `runtimePersona: null`, or (c) the JWT
   * is malformed. Required — there is no implicit default. Hosts
   * that want "no persona" semantics should pass `''`.
   */
  readonly defaultPersona: string;

  /**
   * JWT claim path to resolve against. Default `'groups'`.
   */
  readonly claimPath?: string;

  /**
   * Override of the JWT tenant claim, mirroring the catalog server's
   * `OIDC_TENANT_CLAIM`. Default `'tenant_id'`. Ignored when
   * `tenantId` is provided explicitly.
   */
  readonly tenantClaim?: string;

  /**
   * Override of the resolved tenant id. By default the adapter pulls
   * the tenant from the JWT (`tenant_id` claim, configurable via
   * `tenantClaim`). Hosts that derive tenant scope from a different
   * source (subdomain, route param) can pass it explicitly.
   */
  readonly tenantId?: string | (() => string);

  /**
   * Optional custom claim-values extractor. The default reads a
   * top-level claim and tolerates string / array / CSV-string
   * shapes; supply this if your IdP packs the values under a nested
   * structure or under a different shape.
   */
  readonly claimValuesExtractor?: (
    payload: Record<string, unknown> | null,
    claimPath: string,
  ) => readonly string[];

  /**
   * Test seam — override of `globalThis.fetch`. Production hosts
   * never set this.
   */
  readonly fetchFn?: typeof fetch;
}

/**
 * Service that owns the live persona signal. Hosts can also `inject`
 * this directly to drive imperative refresh after a re-login event:
 *
 * ```ts
 * const iam = inject(CatalogIamService);
 * await iam.refresh();
 * ```
 *
 * The signal updates atomically and the chat / approval pipeline
 * picks up the new value on the next read (Angular reactivity).
 */
@Injectable({ providedIn: 'root' })
export class CatalogIamService {
  private readonly active = signal<string>('');
  private options: CatalogActivePersonaOptions | null = null;
  private inflight: AbortController | null = null;
  private readonly destroyRef = inject(DestroyRef, { optional: true });

  configure(options: CatalogActivePersonaOptions): void {
    this.options = options;
    this.active.set(options.defaultPersona);
    this.destroyRef?.onDestroy(() => this.inflight?.abort());
  }

  readonly persona: Signal<string> = this.active.asReadonly();

  async refresh(): Promise<void> {
    const opts = this.options;
    if (!opts) {
      // configure() was never called — keep returning the empty default.
      return;
    }

    // Cancel any in-flight resolve; the most-recent call wins.
    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;

    try {
      const token = await opts.getToken();
      if (!token) {
        this.active.set(opts.defaultPersona);
        return;
      }
      const payload = readJwtPayload(token);
      if (!payload) {
        this.active.set(opts.defaultPersona);
        return;
      }

      const tenantId =
        typeof opts.tenantId === 'function' ? opts.tenantId()
          : opts.tenantId
          ?? readTenantId(payload, opts.tenantClaim);

      if (!tenantId) {
        this.active.set(opts.defaultPersona);
        return;
      }

      const claimPath = opts.claimPath ?? 'groups';
      const extractor = opts.claimValuesExtractor ?? extractClaimValues;
      const claimValues = extractor(payload, claimPath);

      const result = await resolveActivePersona({
        catalogUrl: opts.catalogUrl,
        tenantId,
        token,
        claimPath,
        claimValues,
        signal: ctrl.signal,
        fetchFn: opts.fetchFn,
      });

      // The most-recent in-flight call wins. If a newer refresh()
      // already replaced `inflight`, drop our result.
      if (this.inflight !== ctrl) return;

      this.active.set(result.runtimePersona ?? opts.defaultPersona);
    } catch (err) {
      // Aborts are normal (a newer refresh superseded us); only fall
      // back on real failures. Aborts come through as DOMException
      // with name 'AbortError' or as plain Error in older runtimes.
      const aborted =
        err instanceof DOMException && err.name === 'AbortError';
      if (!aborted) {
        // Catalog unreachable, malformed response, etc. Fall back to
        // the configured default — never block the runtime.
        this.active.set(opts.defaultPersona);
      }
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
  }
}

/**
 * Wire the catalog-driven active-persona pipeline into the runtime.
 *
 * Provides:
 * - `CatalogIamService` (owns the live persona signal + refresh logic)
 * - `AGENTIC_ACTIVE_PERSONA` factory that reads from the service's signal
 *
 * The provider also fires a single `refresh()` at bootstrap so the
 * persona is populated before the user interacts with the chat.
 *
 * Hosts that need to re-resolve after a token refresh should
 * `inject(CatalogIamService).refresh()` from their OIDC client's
 * silent-renew callback.
 *
 * @example
 * ```ts
 * provideCatalogActivePersona({
 *   catalogUrl: 'https://catalog.example.com',
 *   getToken: () => oidc.getAccessToken(),
 *   defaultPersona: 'paralegal',
 * })
 * ```
 */
export function provideCatalogActivePersona(
  options: CatalogActivePersonaOptions,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: AGENTIC_ACTIVE_PERSONA,
      useFactory: () => {
        const svc = inject(CatalogIamService);
        svc.configure(options);
        // Kick off the initial resolve. We deliberately do not
        // await — bootstrap should not block on a network round
        // trip, and the persona signal carries `defaultPersona`
        // until the resolve lands.
        void svc.refresh();
        return () => svc.persona();
      },
    },
  ]);
}
