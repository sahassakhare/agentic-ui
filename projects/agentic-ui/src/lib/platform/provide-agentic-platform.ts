import {
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from '@angular/core';
import {
  provideCatalogActivePersona,
  type CatalogActivePersonaOptions,
} from '../iam/provide-catalog-active-persona';
import {
  provideRestMfeRegistry,
  type RestMfeRegistryOptions,
} from '../mfe/rest-mfe-registry';
import {
  provideCatalogCapabilityRegistrar,
  type CatalogCapabilityRegistrarOptions,
} from './provide-catalog-capability-registrar';
import {
  provideCatalogCapabilityAuthorizer,
  type CatalogCapabilityAuthorizerOptions,
} from './provide-catalog-capability-authorizer';

/**
 * Single configuration point for consumer apps integrating with the
 * Maverick agentic platform (catalog server + ops console).
 * Replaces 4–5 separate provider calls + thread-the-same-3-args
 * boilerplate with one hook:
 *
 * ```ts
 * provideAgenticPlatform({
 *   catalogUrl: 'https://catalog.example.com',
 *   tenantId: 'acme',
 *   getToken: () => oidc.getAccessToken(),
 *   personaResolver: { defaultPersona: 'paralegal' },
 *   mfeRegistry: { refreshIntervalMs: 30_000 },
 * })
 * ```
 *
 * Closes Gap 4 from the [2026-05-10 platform audit](../../../../../docs/audit/2026-05-10-platform-audit.md).
 *
 * Each integration is **opt-in** via its own options object; pass
 * `false` for an integration to skip it. Adopters who want only MFE
 * federation and not IAM persona resolution can do
 * `personaResolver: false`.
 *
 * Future slices ([Gap 1: registrar](../../../../../docs/audit/2026-05-10-platform-audit.md#gap-1--capability-registration),
 * [Gap 3: authorizer](../../../../../docs/audit/2026-05-10-platform-audit.md#gap-3--capability-authorization-catalog-as-allowlist),
 * [Gap 2: metering](../../../../../docs/audit/2026-05-10-platform-audit.md#gap-2--usage-metering))
 * will plug in as additional opt-in feature switches without
 * breaking existing callers.
 */
export interface AgenticPlatformOptions {
  /**
   * Catalog server base URL. No trailing slash.
   * @example "https://catalog.example.com"
   */
  readonly catalogUrl: string;

  /**
   * Tenant id. Must match the JWT's tenant claim, OR the principal
   * must hold `platform-admin` (catalog enforces this). Static
   * string OR function for hosts that derive tenant from a
   * subdomain / route param.
   */
  readonly tenantId: string | (() => string);

  /**
   * Bearer-token source. Called per outbound request so token
   * rotation is automatic. Return `null` / `undefined` only when
   * the catalog runs `AUTH_MODE=disabled` ([ADR-022](../../../../../docs/adr/0022-auth-disabled-mode.md))
   * — production deployments must always return a valid JWT.
   */
  readonly getToken: () => Promise<string | null | undefined> | string | null | undefined;

  /**
   * IAM persona resolver — wires
   * [`provideCatalogActivePersona`](../iam/provide-catalog-active-persona.ts).
   * Pass options to enable; pass `false` to skip.
   *
   * Required field when enabled: `defaultPersona`.
   */
  readonly personaResolver?: PersonaResolverOptions | false;

  /**
   * MFE registry source — wires
   * [`provideRestMfeRegistry`](../mfe/rest-mfe-registry.ts).
   * Pass options (or empty object for defaults) to enable; pass
   * `false` to skip.
   */
  readonly mfeRegistry?: MfeRegistryOptions | false;

  /**
   * Capability registrar — on Angular bootstrap, POSTs each
   * code-registered tool / widget to the catalog
   * (`POST /v1/catalogs/{tenant}/capabilities`). Idempotent — 409s
   * on repeat boots are treated as success.
   *
   * Closes Gap 1 from the 2026-05-10 platform audit. Pass `{}` for
   * defaults (lifecycle: 'published', host-only) or `false` to skip.
   */
  readonly capabilityRegistrar?: CapabilityRegistrarFeatureOptions | false;

  /**
   * Capability authorizer — fetches the catalog's disabled-list at
   * boot, polls for live updates, and gates `ToolRegistry` +
   * `ComponentRegistry` reads via a composed scope policy. An
   * operator who toggles a capability to `disabled` in the ops
   * console sees the runtime stop offering it on the next refresh
   * tick.
   *
   * Closes Gap 3 from the 2026-05-10 platform audit. Pass `{}` for
   * defaults (default-allow, 30s polling) or `false` to skip.
   */
  readonly capabilityAuthorizer?: CapabilityAuthorizerFeatureOptions | false;
}

/** IAM persona resolver options — tenant + token come from the platform-level config. */
export interface PersonaResolverOptions {
  readonly defaultPersona: string;
  readonly claimPath?: string;
  readonly tenantClaim?: string;
  readonly claimValuesExtractor?: CatalogActivePersonaOptions['claimValuesExtractor'];
  /** Override of `globalThis.fetch`. Test seam. */
  readonly fetchFn?: typeof fetch;
}

/** MFE registry options — tenant + token come from the platform-level config. */
export interface MfeRegistryOptions {
  readonly refreshIntervalMs?: number;
  readonly staticFallbackUrl?: string;
  /** Override of `globalThis.fetch`. Test seam. */
  readonly fetchFn?: typeof fetch;
}

/** Capability registrar options — tenant + token come from the platform-level config. */
export interface CapabilityRegistrarFeatureOptions {
  readonly defaultLifecycle?: 'draft' | 'published' | 'deprecated' | 'disabled';
  readonly includeRemotes?: boolean;
  /** Override of `globalThis.fetch`. Test seam. */
  readonly fetchFn?: typeof fetch;
}

/** Capability authorizer options — tenant + token come from the platform-level config. */
export interface CapabilityAuthorizerFeatureOptions {
  readonly refreshIntervalMs?: number;
  readonly onInitialFetchFailure?: 'allow' | 'deny';
  /** Override of `globalThis.fetch`. Test seam. */
  readonly fetchFn?: typeof fetch;
}

/**
 * Resolve the tenant id once, eagerly. Both adapters take a static
 * tenant id today; if a host needs dynamic re-resolution
 * (multi-tenant SPA without a hard reload between tenants), they
 * should re-instantiate the providers behind a feature flag.
 */
function resolveTenantId(opt: AgenticPlatformOptions['tenantId']): string {
  return typeof opt === 'function' ? opt() : opt;
}

export function provideAgenticPlatform(
  options: AgenticPlatformOptions,
): EnvironmentProviders {
  const tenantId = resolveTenantId(options.tenantId);
  const childProviders: EnvironmentProviders[] = [];

  // ── Persona resolver (IAM) ──
  if (options.personaResolver !== false && options.personaResolver !== undefined) {
    const opts = options.personaResolver;
    const personaCfg: CatalogActivePersonaOptions = {
      catalogUrl: options.catalogUrl,
      getToken: options.getToken,
      defaultPersona: opts.defaultPersona,
      tenantId,
      ...(opts.claimPath !== undefined ? { claimPath: opts.claimPath } : {}),
      ...(opts.tenantClaim !== undefined ? { tenantClaim: opts.tenantClaim } : {}),
      ...(opts.claimValuesExtractor ? { claimValuesExtractor: opts.claimValuesExtractor } : {}),
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    };
    childProviders.push(provideCatalogActivePersona(personaCfg));
  }

  // ── MFE registry source ──
  if (options.mfeRegistry !== false && options.mfeRegistry !== undefined) {
    const opts = options.mfeRegistry;
    const mfeCfg: RestMfeRegistryOptions = {
      catalogUrl: options.catalogUrl,
      tenantId,
      getToken: options.getToken,
      ...(opts.refreshIntervalMs !== undefined ? { refreshIntervalMs: opts.refreshIntervalMs } : {}),
      ...(opts.staticFallbackUrl !== undefined ? { staticFallbackUrl: opts.staticFallbackUrl } : {}),
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    };
    childProviders.push(provideRestMfeRegistry(mfeCfg));
  }

  // ── Capability registrar (Gap 1 / ADR-032) ──
  if (options.capabilityRegistrar !== false && options.capabilityRegistrar !== undefined) {
    const opts = options.capabilityRegistrar;
    const regCfg: CatalogCapabilityRegistrarOptions = {
      catalogUrl: options.catalogUrl,
      tenantId,
      getToken: options.getToken,
      ...(opts.defaultLifecycle !== undefined ? { defaultLifecycle: opts.defaultLifecycle } : {}),
      ...(opts.includeRemotes !== undefined ? { includeRemotes: opts.includeRemotes } : {}),
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    };
    childProviders.push(provideCatalogCapabilityRegistrar(regCfg));
  }

  // ── Capability authorizer (Gap 3 / ADR-033) ──
  if (options.capabilityAuthorizer !== false && options.capabilityAuthorizer !== undefined) {
    const opts = options.capabilityAuthorizer;
    const authCfg: CatalogCapabilityAuthorizerOptions = {
      catalogUrl: options.catalogUrl,
      tenantId,
      getToken: options.getToken,
      ...(opts.refreshIntervalMs !== undefined ? { refreshIntervalMs: opts.refreshIntervalMs } : {}),
      ...(opts.onInitialFetchFailure !== undefined ? { onInitialFetchFailure: opts.onInitialFetchFailure } : {}),
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    };
    childProviders.push(provideCatalogCapabilityAuthorizer(authCfg));
  }

  return makeEnvironmentProviders(childProviders);
}
