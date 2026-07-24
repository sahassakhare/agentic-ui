import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'aes.token';
const TENANT_KEY = 'aes.tenant';

/**
 * Auth holder for the studio. Two modes, switched at build time via
 * `environment.authMode` (mirrors the ops-console + catalog `AUTH_MODE`):
 *
 * - **`'oidc'`** — the user pastes a JWT on the login screen; the tenant is
 *   decoded from the token's `tenant_id` / `tenantId` claim and the token is
 *   forwarded as `Authorization: Bearer …`.
 * - **`'disabled'`** — the user types a tenant id (no JWT); requests carry no
 *   Authorization header and a catalog running with `AUTH_MODE=disabled`
 *   accepts them (ADR-022).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly authMode = environment.authMode;

  private readonly _token = signal<string | null>(safeGet(TOKEN_KEY));
  private readonly _tenant = signal<string | null>(safeGet(TENANT_KEY));

  /** Raw JWT for the HTTP interceptor (oidc mode). */
  readonly token = this._token.asReadonly();
  /** Active tenant id (decoded from the JWT in oidc mode, typed in disabled mode). */
  readonly tenant = this._tenant.asReadonly();

  readonly isAuthenticated = computed(() =>
    this.authMode === 'disabled' ? this._tenant() !== null : this._token() !== null,
  );

  /** oidc mode: store a JWT and derive the tenant from its claims. */
  setToken(token: string): void {
    this._token.set(token);
    safeSet(TOKEN_KEY, token);
    const tenant = decodeTenant(token);
    if (tenant) { this._tenant.set(tenant); safeSet(TENANT_KEY, tenant); }
  }

  /** disabled mode: set the tenant directly. */
  setTenant(tenant: string): void {
    this._tenant.set(tenant);
    safeSet(TENANT_KEY, tenant);
  }

  logout(): void {
    this._token.set(null);
    this._tenant.set(null);
    safeRemove(TOKEN_KEY);
    safeRemove(TENANT_KEY);
  }
}

/** Best-effort decode of the tenant claim from a JWT payload. Never throws. */
export function decodeTenant(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return json.tenant_id ?? json.tenantId ?? null;
  } catch {
    return null;
  }
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}
function safeRemove(k: string): void {
  try { localStorage.removeItem(k); } catch { /* ignore */ }
}
