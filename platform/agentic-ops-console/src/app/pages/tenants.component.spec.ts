import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TenantsComponent } from './tenants.component';
import { AuthService } from '../services/auth.service';

function base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function adminToken(): string {
  return [
    base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    base64Url(JSON.stringify({
      sub: 'u-1', tenant_id: 'mgmt', roles: ['platform-admin'], name: 'Admin',
    })),
    'sig',
  ].join('.');
}

describe('TenantsComponent (C6.1 editor)', () => {
  let httpTesting: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    try { localStorage?.removeItem?.('ops-console.token'); } catch { /* no-op */ }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(AuthService);
    auth.setToken(adminToken());
    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('non-admin sees the access notice without firing a list call', () => {
    auth.logout();
    // No principal at all → component skips the list fetch and shows notice.
    const fixture = TestBed.createComponent(TenantsComponent);
    const cmp = fixture.componentInstance;
    expect(cmp.isAdmin()).toBe(false);
    expect(cmp.loading()).toBe(false);
    httpTesting.expectNone(() => true);
  });

  it('platform-admin lists tenants on init', async () => {
    const fixture = TestBed.createComponent(TenantsComponent);
    const req = httpTesting.expectOne((r) => r.url.endsWith('/v1/tenants') && r.params.get('includeDeleted') === 'true');
    req.flush({ items: [
      { id: 'acme', displayName: 'Acme', status: 'active', quotas: {},
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        onboardedAt: null, onboardedBy: null, suspendedAt: null,
        suspendedBy: null, suspendedReason: null, deletedAt: null,
      },
    ]});
    await fixture.whenStable();
    expect(fixture.componentInstance.items().length).toBe(1);
    expect(fixture.componentInstance.items()[0]?.id).toBe('acme');
  });

  it('submitCreate validates the tenant id regex client-side', async () => {
    const fixture = TestBed.createComponent(TenantsComponent);
    const cmp = fixture.componentInstance;
    httpTesting.expectOne((r) => r.url.endsWith('/v1/tenants') && r.params.get('includeDeleted') === 'true').flush({ items: [] });
    cmp.openCreate();
    cmp.createId = 'has spaces';
    cmp.createDisplayName = 'X';
    cmp.submitCreate();
    expect(cmp.createError()).toMatch(/\[a-zA-Z0-9_.-\]\+/);
    httpTesting.expectNone((r) => r.method === 'POST');
  });

  it('submitCreate fires POST + refreshes list on success', async () => {
    const fixture = TestBed.createComponent(TenantsComponent);
    const cmp = fixture.componentInstance;
    httpTesting.expectOne((r) => r.url.endsWith('/v1/tenants') && r.params.get('includeDeleted') === 'true').flush({ items: [] });
    cmp.openCreate();
    cmp.createId = 'newco';
    cmp.createDisplayName = 'Newco Inc';
    cmp.submitCreate();
    const post = httpTesting.expectOne((r) => r.method === 'POST' && r.url.endsWith('/v1/tenants'));
    expect(post.request.body).toEqual({ id: 'newco', displayName: 'Newco Inc' });
    post.flush({ id: 'newco', displayName: 'Newco Inc', status: 'active' });
    await fixture.whenStable();
    httpTesting.expectOne((r) => r.url.endsWith('/v1/tenants') && r.params.get('includeDeleted') === 'true')
      .flush({ items: [{ id: 'newco', displayName: 'Newco Inc', status: 'active', quotas: {},
        createdAt: '', updatedAt: '', onboardedAt: null, onboardedBy: null,
        suspendedAt: null, suspendedBy: null, suspendedReason: null, deletedAt: null }] });
    expect(cmp.showCreate()).toBe(false);
  });

  it('executeAction(suspend) POSTs /suspend with reason', async () => {
    const fixture = TestBed.createComponent(TenantsComponent);
    const cmp = fixture.componentInstance;
    httpTesting.expectOne((r) => r.url.endsWith('/v1/tenants') && r.params.get('includeDeleted') === 'true').flush({ items: [] });
    const tenant = { id: 'acme', displayName: 'Acme', status: 'active' as const, quotas: {},
      createdAt: '', updatedAt: '', onboardedAt: null, onboardedBy: null,
      suspendedAt: null, suspendedBy: null, suspendedReason: null, deletedAt: null };
    cmp.executeAction({ tenant, kind: 'suspend' }, 'overdue invoice');
    const post = httpTesting.expectOne((r) =>
      r.method === 'POST' && r.url.endsWith('/v1/tenants/acme/suspend'),
    );
    expect(post.request.body).toEqual({ reason: 'overdue invoice' });
  });
});
