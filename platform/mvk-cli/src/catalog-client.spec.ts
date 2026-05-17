import { describe, expect, it, vi } from 'vitest';
import { createCatalogClient, CatalogError } from './catalog-client.js';

const baseConfig = {
  catalogUrl: 'https://catalog.example.com/',
  token: 't0ken',
  authMode: 'oidc' as const,
};

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input
      : 'url' in (input as Request) ? (input as Request).url
      : String(input);
    return handler(url, init);
  }) as typeof fetch;
}

describe('catalog-client', () => {
  it('attaches Bearer token in oidc mode', async () => {
    let captured: RequestInit | null = null;
    const client = createCatalogClient(baseConfig, mockFetch((_, init) => {
      captured = init;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }));
    await client.request({ method: 'GET', path: 'v1/tenants' });
    const headers = captured!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer t0ken');
  });

  it('skips Authorization header in disabled mode', async () => {
    let captured: RequestInit | null = null;
    const client = createCatalogClient(
      { ...baseConfig, authMode: 'disabled', token: null },
      mockFetch((_, init) => { captured = init; return new Response('{}'); }),
    );
    await client.request({ method: 'GET', path: 'v1/tenants' });
    const headers = captured!.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('rejects oidc requests when no token configured', async () => {
    const client = createCatalogClient(
      { ...baseConfig, token: null },
      mockFetch(() => new Response('{}')),
    );
    await expect(client.request({ method: 'GET', path: 'v1/tenants' }))
      .rejects.toThrow(CatalogError);
  });

  it('joins query parameters', async () => {
    let captured: string | null = null;
    const client = createCatalogClient(baseConfig, mockFetch((url) => {
      captured = url; return new Response('{}');
    }));
    await client.request({
      method: 'GET',
      path: 'v1/catalogs/acme/capabilities',
      query: { kind: 'tool', limit: 50 },
    });
    expect(captured).toContain('kind=tool');
    expect(captured).toContain('limit=50');
  });

  it('throws CatalogError with detail on non-2xx', async () => {
    const client = createCatalogClient(baseConfig, mockFetch(() =>
      new Response(JSON.stringify({ title: 'Forbidden', detail: 'Tenant scope mismatch', status: 403 }), {
        status: 403,
      }),
    ));
    try {
      await client.request({ method: 'GET', path: 'v1/tenants' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogError);
      expect((err as CatalogError).status).toBe(403);
      expect((err as Error).message).toContain('Tenant scope mismatch');
    }
  });

  it('strips trailing slash from catalogUrl', async () => {
    let captured: string | null = null;
    const client = createCatalogClient(
      { ...baseConfig, catalogUrl: 'https://catalog.example.com/' },
      mockFetch((url) => { captured = url; return new Response('{}'); }),
    );
    await client.request({ method: 'GET', path: 'healthz' });
    expect(captured).toBe('https://catalog.example.com/healthz');
  });
});
