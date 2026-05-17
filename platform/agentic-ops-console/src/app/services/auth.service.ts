import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../environments/environment';

const STORAGE_TOKEN_KEY = 'ops-console.token';
const STORAGE_TENANT_KEY = 'ops-console.tenant';

export interface DecodedPrincipal {
  readonly sub: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly displayName: string | null;
  readonly expiresAt: number | null;
}

/**
 * Holds the operator's identity and exposes a parsed principal as a
 * signal. Two modes, switched at build time via
 * `environment.authMode`:
 *
 * - **`'oidc'`** — operator pastes a JWT into the login screen. The
 *   service decodes it and the principal carries the token's claims.
 *   Catalog requests forward the token in `Authorization: Bearer …`.
 *
 * - **`'disabled'`** — operator types a tenant id into the login
 *   screen (no JWT exists). The service synthesises a platform-admin
 *   principal client-side. Catalog requests carry no Authorization
 *   header, and the catalog (running with `AUTH_MODE=disabled`)
 *   accepts them. See ADR-022.
 *
 * Auth-storage: `localStorage`. The audit trail + the catalog
 * server's RLS provide the security boundary; the console is for
 * operators, not end-users.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly authMode = environment.authMode;

  private readonly _token = signal<string | null>(this.readStored(STORAGE_TOKEN_KEY));
  private readonly _tenantId = signal<string | null>(this.readStored(STORAGE_TENANT_KEY));

  /** OIDC mode only: the raw JWT for the HTTP interceptor. */
  readonly token = this._token.asReadonly();

  readonly principal = computed<DecodedPrincipal | null>(() => {
    if (this.authMode === 'disabled') {
      const tenantId = this._tenantId();
      if (!tenantId) return null;
      return {
        sub: 'anonymous',
        tenantId,
        roles: ['platform-admin'],
        displayName: 'anonymous (auth disabled)',
        expiresAt: null,
      };
    }
    const t = this._token();
    if (!t) return null;
    return decodePrincipal(t);
  });

  readonly isAuthenticated = computed(() => this.principal() !== null);

  readonly isPlatformAdmin = computed(() => {
    const p = this.principal();
    return p ? p.roles.includes('platform-admin') : false;
  });

  /** OIDC mode: store a JWT. */
  setToken(token: string): void {
    try { localStorage?.setItem?.(STORAGE_TOKEN_KEY, token); } catch { /* sandboxed env, no-op */ }
    this._token.set(token);
  }

  /**
   * Disabled mode: pick the tenant whose data the console should
   * display + write to. Persists across reloads. Operators switch
   * tenants at any time via the shell's tenant switcher.
   */
  setTenantId(tenantId: string): void {
    try { localStorage?.setItem?.(STORAGE_TENANT_KEY, tenantId); } catch { /* no-op */ }
    this._tenantId.set(tenantId);
  }

  logout(): void {
    try {
      localStorage?.removeItem?.(STORAGE_TOKEN_KEY);
      localStorage?.removeItem?.(STORAGE_TENANT_KEY);
    } catch { /* no-op */ }
    this._token.set(null);
    this._tenantId.set(null);
  }

  private readStored(key: string): string | null {
    try { return localStorage?.getItem?.(key) ?? null; } catch { return null; }
  }
}

export function decodePrincipal(token: string): DecodedPrincipal | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const segment = parts[1];
  if (!segment) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(segment)) as Record<string, unknown>;
    if (typeof payload !== 'object' || payload === null) return null;

    const sub = typeof payload['sub'] === 'string' ? payload['sub'] : '';
    const tenantId = typeof payload['tenant_id'] === 'string' ? payload['tenant_id']
      : typeof payload['tenantId'] === 'string' ? payload['tenantId']
      : '';
    const roles = Array.isArray(payload['roles'])
      ? payload['roles'].filter((r): r is string => typeof r === 'string')
      : [];
    const displayName = typeof payload['name'] === 'string' ? payload['name']
      : typeof payload['displayName'] === 'string' ? payload['displayName']
      : null;
    const exp = typeof payload['exp'] === 'number' ? payload['exp'] * 1000 : null;
    if (!sub || !tenantId) return null;
    return { sub, tenantId, roles, displayName, expiresAt: exp };
  } catch {
    return null;
  }
}

function base64UrlDecode(s: string): string {
  const normalised = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
