import { InjectionToken } from '@angular/core';

/**
 * Static configuration for the catalog runtime bridge — supplied once via
 * `provideCatalogRuntime({ ... })` in `app.config.ts`.
 */
export interface CatalogRuntimeConfig {
  /** Catalog service base URL, e.g. `http://localhost:8081`. */
  readonly baseUrl: string;
  /** Tenant / catalog id the app reads from, e.g. `acme`. */
  readonly tenant: string;
  /** Which `kind:'application'` capability this app renders as its shell (shell mode). */
  readonly applicationName?: string;
  /** `'disabled'` (trusted-network dev) or `'oidc'` (forward a bearer token). */
  readonly authMode?: 'disabled' | 'oidc';
  /**
   * Secrets referenced by data-source headers as `${NAME}`. Kept out of the
   * catalog body — a data source stores only the ref. Empty in local dev.
   */
  readonly dataSourceSecrets?: Record<string, string>;
  /** Where federated MFE remotes are discovered (shell mode; optional). */
  readonly mfeRegistryUrl?: string;
  /** MFE federation environment (matches remotes' `env`; shell mode; optional). */
  readonly mfeEnv?: string;
}

/** Fully-resolved config (defaults applied) — the shape services inject. */
export type ResolvedCatalogConfig =
  Required<Pick<CatalogRuntimeConfig, 'baseUrl' | 'tenant' | 'authMode' | 'dataSourceSecrets'>> &
  Pick<CatalogRuntimeConfig, 'applicationName' | 'mfeRegistryUrl' | 'mfeEnv'>;

/** Config token, provided by `provideCatalogRuntime`. */
export const CATALOG_CONFIG = new InjectionToken<ResolvedCatalogConfig>('CATALOG_CONFIG');

/**
 * Auth seam — decouples the runtime from any host auth service.
 *
 * `token()` is all `registries` mode needs (bearer for the catalog fetch in
 * `oidc` mode). The optional members are the `shell`-mode access gate (page/
 * surface hosts filter by persona + scopes); a host that renders the shell wires
 * them from its own auth. Provide your own against your existing service:
 *
 * ```ts
 * { provide: CATALOG_AUTH, useExisting: MyAuthService }  // implements CatalogAuth
 * ```
 */
export interface CatalogAuth {
  /** Current bearer token, or `null` in disabled mode. */
  token(): string | null;
  /** Signed-in principal id (shell-mode gate). */
  principalId?(): string;
  /** Active persona (shell-mode page/experience access filter). */
  persona?(): string;
  /** Held permission scopes (shell-mode access gate). */
  permissions?(): readonly string[];
  /** Whether a user is signed in (shell-mode login gate). */
  isAuthenticated?(): boolean;
  /** Sign out (shell-mode header menu); optional no-op if unsupported. */
  logout?(): void;
}

/**
 * Default auth — **disabled** (trusted-network) mode: no token, a single
 * `end-user` persona, no scopes, always "authenticated" so a dev shell renders
 * with no login wall. OIDC apps override with `{ provide: CATALOG_AUTH, ... }`.
 */
export const CATALOG_AUTH = new InjectionToken<CatalogAuth>('CATALOG_AUTH', {
  providedIn: 'root',
  factory: () => ({
    token: () => null,
    principalId: () => 'end-user',
    persona: () => 'end-user',
    permissions: () => [],
    isAuthenticated: () => true,
  }),
});
