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
});
