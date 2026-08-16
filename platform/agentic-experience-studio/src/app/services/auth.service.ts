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

  /** Roles from the JWT `roles` claim. Auth-disabled dev acts as platform-admin. */
  readonly roles = computed<readonly string[]>(() => {
    if (this.authMode === 'disabled') return ['platform-admin'];
    const t = this._token();
    return t ? decodeRoles(t) : [];
  });

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

  /**
   * oidc mode: begin a real OIDC authorization-code + PKCE login (P3 / gap A2 —
   * replaces pasting a JWT). Generates a PKCE verifier + S256 challenge, stashes
   * the verifier + state, and redirects to the IdP's authorization endpoint.
   */
  async loginWithSso(): Promise<void> {
    const verifier = randomString(64);
    const challenge = await s256(verifier);
    const state = randomString(24);
    sessionStorage.setItem('aes.pkce', verifier);
    sessionStorage.setItem('aes.state', state);
    const url = new URL((environment as { ssoAuthorizeUrl?: string }).ssoAuthorizeUrl ?? '');
    url.searchParams.set('client_id', 'studio');
    url.searchParams.set('redirect_uri', `${location.origin}/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    location.href = url.toString();
  }

  /** Handle the IdP redirect back: verify state, exchange the code (+PKCE) for a token. */
  async handleSsoCallback(code: string, state: string): Promise<void> {
    const verifier = sessionStorage.getItem('aes.pkce');
    if (!verifier || state !== sessionStorage.getItem('aes.state')) throw new Error('Invalid SSO state — restart the login.');
    const res = await fetch((environment as { ssoTokenUrl?: string }).ssoTokenUrl ?? '', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, code_verifier: verifier,
        redirect_uri: `${location.origin}/callback`,
      }),
    });
    if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
    const { access_token } = await res.json() as { access_token: string };
    sessionStorage.removeItem('aes.pkce');
    sessionStorage.removeItem('aes.state');
    this.setToken(access_token);
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

export function decodeRoles(token: string): readonly string[] {
  try {
    const payload = token.split('.')[1];
    if (!payload) return [];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const roles = json.roles ?? json.role ?? [];
    return Array.isArray(roles) ? roles.map(String) : [String(roles)];
  } catch {
    return [];
  }
}

/** URL-safe random string for the PKCE verifier + state. */
function randomString(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('').slice(0, n);
}
/** base64url(SHA-256(input)) — the PKCE S256 challenge. */
async function s256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let s = '';
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
