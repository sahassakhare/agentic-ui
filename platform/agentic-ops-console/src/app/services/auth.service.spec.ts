import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { AuthService, decodePrincipal } from './auth.service';

function base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintToken(payload: object): string {
  return [
    base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    base64Url(JSON.stringify(payload)),
    'sig',
  ].join('.');
}

describe('decodePrincipal', () => {
  it('extracts subject + tenant + roles', () => {
    const t = mintToken({ sub: 'u-1', tenant_id: 'acme', roles: ['member'], name: 'Z' });
    const p = decodePrincipal(t);
    expect(p).toMatchObject({ sub: 'u-1', tenantId: 'acme', roles: ['member'], displayName: 'Z' });
  });

  it('returns null for malformed JWTs', () => {
    expect(decodePrincipal('not-a-jwt')).toBeNull();
    expect(decodePrincipal('a.b')).toBeNull();
    expect(decodePrincipal('')).toBeNull();
  });

  it('returns null when tenant_id is absent', () => {
    const t = mintToken({ sub: 'u-1', roles: ['m'] });
    expect(decodePrincipal(t)).toBeNull();
  });

  it('honours camelCase tenantId fallback', () => {
    const t = mintToken({ sub: 'u-1', tenantId: 'acme' });
    expect(decodePrincipal(t)?.tenantId).toBe('acme');
  });

  it('preserves expiresAt as ms epoch', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = mintToken({ sub: 'u-1', tenant_id: 'acme', exp });
    expect(decodePrincipal(t)?.expiresAt).toBe(exp * 1000);
  });
});

describe('AuthService', () => {
  let svc: AuthService;

  beforeEach(() => {
    try { localStorage?.removeItem?.('ops-console.token'); } catch { /* no localStorage in this test env */ }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(AuthService);
  });

  it('starts unauthenticated when no token is stored', () => {
    expect(svc.isAuthenticated()).toBe(false);
    expect(svc.principal()).toBeNull();
  });

  it('setToken populates principal', () => {
    const t = mintToken({ sub: 'u-1', tenant_id: 'acme', roles: ['platform-admin'] });
    svc.setToken(t);
    expect(svc.isAuthenticated()).toBe(true);
    expect(svc.isPlatformAdmin()).toBe(true);
    expect(svc.principal()?.tenantId).toBe('acme');
  });

  it('logout clears principal', () => {
    const t = mintToken({ sub: 'u-1', tenant_id: 'acme', roles: ['member'] });
    svc.setToken(t);
    svc.logout();
    expect(svc.isAuthenticated()).toBe(false);
    expect(svc.principal()).toBeNull();
  });
});
