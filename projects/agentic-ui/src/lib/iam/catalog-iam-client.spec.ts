import { describe, expect, it, vi } from 'vitest';
import { resolveActivePersona } from './catalog-iam-client';

const URL = 'https://catalog.example.com/v1/catalogs/acme/role-mappings/resolve';

function mockFetch(handler: (req: { url: string; init: RequestInit }) => Response | Promise<Response>): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input
      : 'url' in (input as Request) ? (input as Request).url
      : String(input);
    return handler({ url, init });
  }) as typeof fetch;
}

describe('resolveActivePersona', () => {
  const baseOk = {
    runtimePersona: 'lead-counsel',
    matchedClaimValues: ['executive', 'legal-counsel'],
    mappingId: '00000000-0000-0000-0000-000000000001',
    priority: 100,
  };

  it('POSTs to the correct path with the bearer token', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const f = mockFetch((req) => { captured = req; return new Response(JSON.stringify(baseOk)); });
    const res = await resolveActivePersona({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      token: 'eyJ.fake.jwt',
      claimPath: 'groups',
      claimValues: ['executive'],
      fetchFn: f,
    });
    expect(res.runtimePersona).toBe('lead-counsel');
    expect(captured!.url).toBe(URL);
    expect(captured!.init.method).toBe('POST');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer eyJ.fake.jwt');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toEqual({ claimPath: 'groups', claimValues: ['executive'] });
  });

  it('strips a trailing slash from catalogUrl', async () => {
    let captured: string | null = null;
    const f = mockFetch((req) => { captured = req.url; return new Response(JSON.stringify(baseOk)); });
    await resolveActivePersona({
      catalogUrl: 'https://catalog.example.com/',
      tenantId: 'acme', token: 't', claimPath: 'groups', claimValues: [], fetchFn: f,
    });
    expect(captured).toBe(URL);
  });

  it('omits the Authorization header when token is null', async () => {
    let captured: RequestInit | null = null;
    const f = mockFetch((req) => { captured = req.init; return new Response(JSON.stringify(baseOk)); });
    await resolveActivePersona({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme', token: null, claimPath: 'groups', claimValues: [], fetchFn: f,
    });
    expect((captured!.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('throws on non-2xx HTTP status', async () => {
    const f = mockFetch(() => new Response('boom', { status: 500, statusText: 'Internal' }));
    await expect(resolveActivePersona({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme', token: 't', claimPath: 'groups', claimValues: [], fetchFn: f,
    })).rejects.toThrow(/HTTP 500/);
  });

  it('throws on a malformed response body (Zod rejects)', async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ wrong: 'shape' })));
    await expect(resolveActivePersona({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme', token: 't', claimPath: 'groups', claimValues: [], fetchFn: f,
    })).rejects.toThrow();
  });

  it('encodes the tenant id (path injection guard)', async () => {
    let captured: string | null = null;
    const f = mockFetch((req) => { captured = req.url; return new Response(JSON.stringify(baseOk)); });
    await resolveActivePersona({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme/with slash', token: 't', claimPath: 'groups', claimValues: [], fetchFn: f,
    });
    expect(captured).toContain('acme%2Fwith%20slash');
  });
});
