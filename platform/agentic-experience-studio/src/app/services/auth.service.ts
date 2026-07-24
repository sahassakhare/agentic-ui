import { Injectable, signal } from '@angular/core';

const TOKEN_KEY = 'aes.token';
const TENANT_KEY = 'aes.tenant';

/**
 * Minimal auth holder for the studio. Stores a JWT (oidc mode) or a tenant id
 * (disabled mode) in localStorage and exposes them as signals. Mirrors the
 * ops-console AuthService contract used by the auth interceptor.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _token = signal<string | null>(safeGet(TOKEN_KEY));
  private readonly _tenant = signal<string | null>(safeGet(TENANT_KEY));
  readonly token = this._token.asReadonly();
  readonly tenant = this._tenant.asReadonly();

  setToken(token: string): void {
    this._token.set(token);
    safeSet(TOKEN_KEY, token);
  }
  setTenant(tenant: string): void {
    this._tenant.set(tenant);
    safeSet(TENANT_KEY, tenant);
  }
  logout(): void {
    this._token.set(null);
    safeRemove(TOKEN_KEY);
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
