/**
 * End-user identity for the Experience Hub. Two modes, matched to the catalog
 * (`environment.authMode`):
 *
 *  - **`'disabled'`** — trusted-network dev. No JWT exists; the login screen
 *    collects a persona + the permissions the user holds, and this service
 *    synthesises an end-user principal. The catalog (`AUTH_MODE=disabled`)
 *    accepts unauthenticated requests.
 *  - **`'oidc'`** — the user signs in with a JWT (from the PKCE provider). The
 *    principal comes from its claims; `token()` feeds the catalog fetch's
 *    `Authorization: Bearer …`.
 *
 * The principal (`{ id, persona, permissions }`) is exactly the shape the
 * `ExperiencePlanner` access gate consumes (persona allow-list + held
 * permissions), so it governs both dashboards and journeys.
 */
import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../environments/environment';

const STORAGE_KEY = 'experience-hub.principal';

export interface HubPrincipal {
  readonly id: string;
  readonly persona: string;
  readonly permissions: readonly string[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly authMode = environment.authMode;

  private readonly _principal = signal<HubPrincipal | null>(this.readStored());
  private readonly _token = signal<string | null>(null);

  readonly principal = this._principal.asReadonly();
  readonly isAuthenticated = computed(() => this._principal() !== null);
  /** OIDC mode: the raw JWT forwarded to the catalog. `null` in disabled mode. */
  readonly token = this._token.asReadonly();

  readonly persona = computed(() => this._principal()?.persona ?? 'end-user');
  readonly permissions = computed<readonly string[]>(() => this._principal()?.permissions ?? []);

  /** Disabled mode: sign in as an end user with a chosen persona + held permissions. */
  signInDisabled(persona: string, permissions: readonly string[], id = 'end-user'): void {
    this.persist({ id, persona, permissions: [...permissions] });
  }

  /** OIDC mode: sign in with a JWT; derive the principal from its claims. */
  signInOidc(token: string): boolean {
    const p = decodePrincipal(token);
    if (!p) return false;
    this._token.set(token);
    this.persist(p);
    return true;
  }

  logout(): void {
    try { localStorage?.removeItem?.(STORAGE_KEY); } catch { /* no-op */ }
    this._principal.set(null);
    this._token.set(null);
  }

  private persist(p: HubPrincipal): void {
    try { localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(p)); } catch { /* no-op */ }
    this._principal.set(p);
  }

  private readStored(): HubPrincipal | null {
    try {
      const raw = localStorage?.getItem?.(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as HubPrincipal) : null;
    } catch { return null; }
  }
}

/** Decode a JWT into a Hub principal: `sub` → id, `roles` → permissions, persona claim (or first role). */
export function decodePrincipal(token: string): HubPrincipal | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    const id = typeof payload['sub'] === 'string' ? payload['sub'] : '';
    if (!id) return null;
    const roles = Array.isArray(payload['roles'])
      ? payload['roles'].filter((r): r is string => typeof r === 'string')
      : [];
    const persona = typeof payload['persona'] === 'string' ? payload['persona'] : (roles[0] ?? 'end-user');
    return { id, persona, permissions: roles };
  } catch { return null; }
}

function base64UrlDecode(s: string): string {
  const normalised = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
