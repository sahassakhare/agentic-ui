import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthService } from '../services/auth.service';

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

describe('LoginComponent', () => {
  beforeEach(() => {
    try { localStorage?.removeItem?.('ops-console.token'); } catch { /* no localStorage */ }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
  });

  it('rejects an empty token', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const cmp = fixture.componentInstance;
    cmp.token.set('');
    cmp.submit();
    expect(cmp.error()).toMatch(/required/i);
  });

  it('rejects a malformed token', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const cmp = fixture.componentInstance;
    cmp.token.set('not-a-jwt');
    cmp.submit();
    expect(cmp.error()).toMatch(/well-formed JWT|tenant_id/i);
  });

  it('rejects an expired token', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const cmp = fixture.componentInstance;
    const expired = mintToken({ sub: 'u-1', tenant_id: 'acme', exp: 1 });
    cmp.token.set(expired);
    cmp.submit();
    expect(cmp.error()).toMatch(/expired/i);
  });

  it('accepts a well-formed token and stores it', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const cmp = fixture.componentInstance;
    const auth = TestBed.inject(AuthService);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    cmp.token.set(mintToken({ sub: 'u-1', tenant_id: 'acme', exp, roles: ['member'] }));
    cmp.submit();
    expect(cmp.error()).toBeNull();
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.principal()?.tenantId).toBe('acme');
  });
});
