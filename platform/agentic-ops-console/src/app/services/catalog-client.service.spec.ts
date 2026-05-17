import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { CatalogClientService } from './catalog-client.service';

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

describe('CatalogClientService', () => {
  let client: CatalogClientService;
  let httpTesting: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    try { localStorage?.removeItem?.('ops-console.token'); } catch { /* no localStorage */ }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(AuthService);
    auth.setToken(mintToken({ sub: 'u-1', tenant_id: 'acme', roles: ['member'] }));
    client = TestBed.inject(CatalogClientService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('listCapabilities issues GET to /v1/catalogs/<tenant>/capabilities', async () => {
    const res$ = client.listCapabilities({ kind: 'tool', limit: 50 });
    const promise = firstValueFrom(res$);
    const req = httpTesting.expectOne((r) =>
      r.method === 'GET' && r.url.endsWith('/v1/catalogs/acme/capabilities'),
    );
    expect(req.request.params.get('kind')).toBe('tool');
    expect(req.request.params.get('limit')).toBe('50');
    req.flush({ items: [], total: 0, limit: 50, offset: 0 });
    const result = await promise;
    expect(result.total).toBe(0);
  });

  it('listMfes issues GET to /v1/catalogs/<tenant>/mfes', async () => {
    const promise = firstValueFrom(client.listMfes());
    const req = httpTesting.expectOne((r) => r.url.endsWith('/v1/catalogs/acme/mfes'));
    req.flush({ items: [] });
    expect((await promise).items).toEqual([]);
  });

  it('verifyAuditChain issues GET to /audit/verify', async () => {
    const promise = firstValueFrom(client.verifyAuditChain());
    const req = httpTesting.expectOne((r) => r.url.endsWith('/v1/catalogs/acme/audit/verify'));
    req.flush({ valid: true, checkedRows: 0, chainHead: null, brokenAt: null });
    expect((await promise).valid).toBe(true);
  });

  it('exportAudit fetches as text', async () => {
    const promise = firstValueFrom(client.exportAudit({ limit: 10 }));
    const req = httpTesting.expectOne((r) =>
      r.method === 'GET' && r.url.endsWith('/v1/catalogs/acme/audit/export'),
    );
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.responseType).toBe('text');
    req.flush('{"id":"x"}\n');
    expect(await promise).toContain('"id":"x"');
  });

  it('aggregateUsage forwards from/to/kind', async () => {
    const promise = firstValueFrom(client.aggregateUsage({
      from: '2026-01-01T00:00:00Z',
      kind: 'llm.tokens.input',
    }));
    const req = httpTesting.expectOne((r) => r.url.endsWith('/v1/catalogs/acme/usage'));
    expect(req.request.params.get('from')).toBe('2026-01-01T00:00:00Z');
    expect(req.request.params.get('kind')).toBe('llm.tokens.input');
    req.flush({ from: null, to: null, byKind: {}, totalEvents: 0, totalQuantity: 0 });
    await promise;
  });

  it('throws when not authenticated', () => {
    auth.logout();
    expect(() => client.listCapabilities()).toThrow(/Not authenticated/);
  });

  it('listRoleMappings issues GET to /role-mappings', async () => {
    const promise = firstValueFrom(client.listRoleMappings());
    const req = httpTesting.expectOne((r) => r.url.endsWith('/v1/catalogs/acme/role-mappings'));
    req.flush({ items: [] });
    expect((await promise).items).toEqual([]);
  });

  // ── C6.1 mutations ─────────────────────────────────────────
  it('createCapability POSTs to /capabilities', async () => {
    const promise = firstValueFrom(client.createCapability({
      kind: 'tool',
      name: 'demo-tool',
      body: { description: 'a tool' },
      lifecycle: 'published',
      tags: ['demo'],
    }));
    const req = httpTesting.expectOne((r) =>
      r.method === 'POST' && r.url.endsWith('/v1/catalogs/acme/capabilities'),
    );
    expect(req.request.body).toMatchObject({
      kind: 'tool',
      name: 'demo-tool',
      lifecycle: 'published',
      tags: ['demo'],
    });
    req.flush({ id: 'cap-1', kind: 'tool', name: 'demo-tool' });
    await promise;
  });

  it('patchCapability PATCHes to /capabilities/:id', async () => {
    const promise = firstValueFrom(client.patchCapability('cap-1', { lifecycle: 'deprecated' }));
    const req = httpTesting.expectOne((r) =>
      r.method === 'PATCH' && r.url.endsWith('/v1/catalogs/acme/capabilities/cap-1'),
    );
    expect(req.request.body).toEqual({ lifecycle: 'deprecated' });
    req.flush({ id: 'cap-1', lifecycle: 'deprecated' });
    await promise;
  });

  it('deleteCapability DELETEs /capabilities/:id', async () => {
    const promise = firstValueFrom(client.deleteCapability('cap-1'));
    const req = httpTesting.expectOne((r) =>
      r.method === 'DELETE' && r.url.endsWith('/v1/catalogs/acme/capabilities/cap-1'),
    );
    req.flush(null, { status: 204, statusText: 'No Content' });
    await promise;
  });

  it('createTenant POSTs to /v1/tenants (platform-level)', async () => {
    const promise = firstValueFrom(client.createTenant({ id: 'acme', displayName: 'Acme Corp' }));
    const req = httpTesting.expectOne((r) =>
      r.method === 'POST' && r.url.endsWith('/v1/tenants'),
    );
    expect(req.request.body).toEqual({ id: 'acme', displayName: 'Acme Corp' });
    req.flush({ id: 'acme', displayName: 'Acme Corp', status: 'active' });
    await promise;
  });

  it('suspendTenant POSTs to /v1/tenants/:id/suspend with reason', async () => {
    const promise = firstValueFrom(client.suspendTenant('acme', 'overdue invoice'));
    const req = httpTesting.expectOne((r) =>
      r.method === 'POST' && r.url.endsWith('/v1/tenants/acme/suspend'),
    );
    expect(req.request.body).toEqual({ reason: 'overdue invoice' });
    req.flush({ id: 'acme', status: 'suspended' });
    await promise;
  });

  it('activateTenant POSTs to /v1/tenants/:id/activate', async () => {
    const promise = firstValueFrom(client.activateTenant('acme'));
    const req = httpTesting.expectOne((r) =>
      r.method === 'POST' && r.url.endsWith('/v1/tenants/acme/activate'),
    );
    expect(req.request.body).toEqual({});
    req.flush({ id: 'acme', status: 'active' });
    await promise;
  });

  it('createMfe POSTs to /mfes', async () => {
    const promise = firstValueFrom(client.createMfe({
      name: 'bookings',
      manifestUrl: 'https://b.example.com/remoteEntry.json',
      version: '1.0.0',
      exposes: { tools: ['bookFlight'] },
    }));
    const req = httpTesting.expectOne((r) =>
      r.method === 'POST' && r.url.endsWith('/v1/catalogs/acme/mfes'),
    );
    expect(req.request.body).toMatchObject({
      name: 'bookings',
      manifestUrl: 'https://b.example.com/remoteEntry.json',
    });
    req.flush({ id: 'm-1', name: 'bookings' });
    await promise;
  });

  it('patchMfe PATCHes by name', async () => {
    const promise = firstValueFrom(client.patchMfe('bookings', { version: '1.0.1' }));
    const req = httpTesting.expectOne((r) =>
      r.method === 'PATCH' && r.url.endsWith('/v1/catalogs/acme/mfes/bookings'),
    );
    expect(req.request.body).toEqual({ version: '1.0.1' });
    req.flush({ id: 'm-1', name: 'bookings', version: '1.0.1' });
    await promise;
  });

  it('deleteMfe DELETEs by name', async () => {
    const promise = firstValueFrom(client.deleteMfe('bookings'));
    const req = httpTesting.expectOne((r) =>
      r.method === 'DELETE' && r.url.endsWith('/v1/catalogs/acme/mfes/bookings'),
    );
    req.flush(null, { status: 204, statusText: 'No Content' });
    await promise;
  });

  it('createRoleMapping POSTs to /role-mappings', async () => {
    const promise = firstValueFrom(client.createRoleMapping({
      claimPath: 'groups',
      claimValue: 'engineering@acme.com',
      runtimePersona: 'paralegal',
      priority: 100,
    }));
    const req = httpTesting.expectOne((r) =>
      r.method === 'POST' && r.url.endsWith('/v1/catalogs/acme/role-mappings'),
    );
    expect(req.request.body).toMatchObject({
      claimValue: 'engineering@acme.com',
      runtimePersona: 'paralegal',
    });
    req.flush({ id: 'rm-1', runtimePersona: 'paralegal' });
    await promise;
  });

  it('patchRoleMapping PATCHes by id', async () => {
    const promise = firstValueFrom(client.patchRoleMapping('rm-1', { enabled: false }));
    const req = httpTesting.expectOne((r) =>
      r.method === 'PATCH' && r.url.endsWith('/v1/catalogs/acme/role-mappings/rm-1'),
    );
    expect(req.request.body).toEqual({ enabled: false });
    req.flush({ id: 'rm-1', enabled: false });
    await promise;
  });

  it('deleteRoleMapping DELETEs by id', async () => {
    const promise = firstValueFrom(client.deleteRoleMapping('rm-1'));
    const req = httpTesting.expectOne((r) =>
      r.method === 'DELETE' && r.url.endsWith('/v1/catalogs/acme/role-mappings/rm-1'),
    );
    req.flush(null, { status: 204, statusText: 'No Content' });
    await promise;
  });

  it('deleteTenant DELETEs /v1/tenants/:id', async () => {
    const promise = firstValueFrom(client.deleteTenant('acme'));
    const req = httpTesting.expectOne((r) =>
      r.method === 'DELETE' && r.url.endsWith('/v1/tenants/acme'),
    );
    req.flush(null, { status: 204, statusText: 'No Content' });
    await promise;
  });
});
