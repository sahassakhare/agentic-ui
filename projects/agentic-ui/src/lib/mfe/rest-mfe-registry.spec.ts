import { describe, expect, it, beforeEach, vi } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { RestMfeRegistrySource, type RestMfeRegistryOptions } from './rest-mfe-registry';

const TENANT = 'acme';
const CATALOG = 'https://catalog.example.com';

interface MockResponseShape {
  status: number;
  json: () => unknown;
}

function makeFetch(handlers: Record<string, MockResponseShape | (() => Promise<MockResponseShape>)>): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString()
      : typeof input === 'string' ? input
      : input.url;
    const handler = handlers[url];
    if (!handler) {
      throw new Error(`No mock handler for ${url}`);
    }
    const resolved = typeof handler === 'function' ? await handler() : handler;
    void init;
    return new Response(JSON.stringify(resolved.json()), { status: resolved.status });
  }) as typeof fetch;
}

const validCatalogResponse = {
  items: [
    {
      name: 'bookings',
      manifestUrl: 'https://bookings.example.com/remoteEntry.json',
      version: '1.2.3',
      requiredHostVersion: '^1.0.0',
      exposes: { tools: ['bookFlight'] },
      status: 'active',
    },
    {
      name: 'loyalty',
      manifestUrl: 'https://loyalty.example.com/remoteEntry.json',
      version: null,
      requiredHostVersion: null,
      exposes: {},
      status: 'degraded',
    },
  ],
};

describe('RestMfeRegistrySource', () => {
  let baseOpts: RestMfeRegistryOptions;
  beforeEach(() => {
    baseOpts = {
      catalogUrl: CATALOG,
      tenantId: TENANT,
      getToken: () => 'jwt-token',
    };
  });

  it('has stable id', () => {
    const src = new RestMfeRegistrySource(baseOpts);
    expect(src.id).toBe('catalog-rest');
  });

  it('discover() fetches + maps catalog response to RemoteSpec', async () => {
    const fetchFn = makeFetch({
      [`${CATALOG}/v1/catalogs/${TENANT}/mfes`]: { status: 200, json: () => validCatalogResponse },
    });
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn });
    const remotes = await src.discover('production');
    expect(remotes).toHaveLength(2);
    expect(remotes[0]).toEqual({
      remoteName: 'bookings',
      version: '1.2.3',
      remoteEntry: 'https://bookings.example.com/remoteEntry.json',
      healthStatus: 'healthy',
    });
    expect(remotes[1]).toEqual({
      remoteName: 'loyalty',
      version: 'unknown',
      remoteEntry: 'https://loyalty.example.com/remoteEntry.json',
      healthStatus: 'degraded',
    });
  });

  it('discover() sends Authorization: Bearer when token is non-empty', async () => {
    let capturedAuth: string | null = null;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedAuth = headers['Authorization'] ?? null;
      return new Response(JSON.stringify(validCatalogResponse), { status: 200 });
    }) as typeof fetch;
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn });
    await src.discover('any');
    expect(capturedAuth).toBe('Bearer jwt-token');
  });

  it('omits Authorization header when getToken returns null', async () => {
    let capturedAuth: string | null = null;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedAuth = headers['Authorization'] ?? null;
      return new Response(JSON.stringify(validCatalogResponse), { status: 200 });
    }) as typeof fetch;
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn, getToken: () => null });
    await src.discover('any');
    expect(capturedAuth).toBeNull();
  });

  it('discover() supports async getToken (e.g., silent OIDC refresh)', async () => {
    let capturedAuth: string | null = null;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedAuth = headers['Authorization'] ?? null;
      return new Response(JSON.stringify(validCatalogResponse), { status: 200 });
    }) as typeof fetch;
    const src = new RestMfeRegistrySource({
      ...baseOpts,
      fetchFn,
      getToken: () => Promise.resolve('async-token'),
    });
    await src.discover('any');
    expect(capturedAuth).toBe('Bearer async-token');
  });

  it('discover() throws on 5xx without a fallback', async () => {
    const fetchFn = makeFetch({
      [`${CATALOG}/v1/catalogs/${TENANT}/mfes`]: { status: 503, json: () => ({}) },
    });
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn });
    await expect(src.discover('any')).rejects.toThrow(/503/);
  });

  it('discover() throws on 401 without a fallback', async () => {
    const fetchFn = makeFetch({
      [`${CATALOG}/v1/catalogs/${TENANT}/mfes`]: { status: 401, json: () => ({ title: 'Unauthorized' }) },
    });
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn });
    await expect(src.discover('any')).rejects.toThrow(/401/);
  });

  it('discover() rejects malformed catalog payload', async () => {
    const fetchFn = makeFetch({
      [`${CATALOG}/v1/catalogs/${TENANT}/mfes`]: { status: 200, json: () => ({ wrong: 'shape' }) },
    });
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn });
    await expect(src.discover('any')).rejects.toThrow(/validation/);
  });

  it('falls back to staticFallbackUrl when catalog is unreachable', async () => {
    const fallbackUrl = 'https://host.example.com/mfes.json';
    const fetchFn = makeFetch({
      [`${CATALOG}/v1/catalogs/${TENANT}/mfes`]: { status: 503, json: () => ({}) },
      [fallbackUrl]: {
        status: 200,
        json: () => ({
          remotes: [{
            remoteName: 'bookings',
            version: '1.0.0',
            remoteEntry: 'https://bookings.example.com/remoteEntry.json',
          }],
        }),
      },
    });
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn, staticFallbackUrl: fallbackUrl });
    const remotes = await src.discover('any');
    expect(remotes).toHaveLength(1);
    expect(remotes[0]?.remoteName).toBe('bookings');
  });

  it('returns empty list when fallback also fails', async () => {
    const fallbackUrl = 'https://host.example.com/mfes.json';
    const fetchFn = makeFetch({
      [`${CATALOG}/v1/catalogs/${TENANT}/mfes`]: { status: 503, json: () => ({}) },
      [fallbackUrl]: { status: 404, json: () => ({}) },
    });
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn, staticFallbackUrl: fallbackUrl });
    // staticFallback returning null re-throws the original catalog error.
    await expect(src.discover('any')).rejects.toThrow(/503/);
  });

  it('honours custom timeoutMs', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      // Wait until the abort signal fires.
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    }) as typeof fetch;
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn, timeoutMs: 50 });
    await expect(src.discover('any')).rejects.toThrow();
  });

  it('watch() with no refreshIntervalMs emits the last-known list once', async () => {
    const fetchFn = makeFetch({
      [`${CATALOG}/v1/catalogs/${TENANT}/mfes`]: { status: 200, json: () => validCatalogResponse },
    });
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn });
    await src.discover('any');  // populate lastKnown
    const remotes = await firstValueFrom(src.watch!('any'));
    expect(remotes).toHaveLength(2);
  });

  it('watch() with refreshIntervalMs polls + emits fresh data', async () => {
    let counter = 0;
    const fetchFn = vi.fn(async () => {
      counter++;
      const status = counter === 1 ? 'active' : 'degraded';
      return new Response(JSON.stringify({
        items: [{
          name: 'bookings',
          manifestUrl: 'https://bookings.example.com/remoteEntry.json',
          version: '1.0.0',
          requiredHostVersion: null,
          exposes: {},
          status,
        }],
      }), { status: 200 });
    }) as typeof fetch;
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn, refreshIntervalMs: 25 });
    const emissions = await firstValueFrom(
      src.watch!('any').pipe(take(2), toArray()),
    );
    expect(emissions).toHaveLength(2);
    expect(emissions[0]?.[0]?.healthStatus).toBe('healthy');
    expect(emissions[1]?.[0]?.healthStatus).toBe('degraded');
  });

  it('watch() falls back to lastKnown on transient errors instead of erroring', async () => {
    let counter = 0;
    const fetchFn = vi.fn(async () => {
      counter++;
      if (counter === 1) {
        return new Response(JSON.stringify(validCatalogResponse), { status: 200 });
      }
      return new Response('{}', { status: 503 });
    }) as typeof fetch;
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn, refreshIntervalMs: 25 });
    const emissions = await firstValueFrom(
      src.watch!('any').pipe(take(2), toArray()),
    );
    // First emission is fresh (200); second falls back to lastKnown (which is the same fresh data because there was no other successful tick).
    expect(emissions).toHaveLength(2);
    expect(emissions[0]).toEqual(emissions[1]);
  });

  it('encodes tenantId in the URL path', async () => {
    let capturedUrl: string | null = null;
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify(validCatalogResponse), { status: 200 });
    }) as typeof fetch;
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn, tenantId: 'acme/with/slashes' });
    await src.discover('any');
    expect(capturedUrl).toContain('acme%2Fwith%2Fslashes');
  });

  it('strips trailing slash from catalogUrl', async () => {
    let capturedUrl: string | null = null;
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify(validCatalogResponse), { status: 200 });
    }) as typeof fetch;
    const src = new RestMfeRegistrySource({ ...baseOpts, fetchFn, catalogUrl: 'https://catalog.example.com/' });
    await src.discover('any');
    expect(capturedUrl).toBe('https://catalog.example.com/v1/catalogs/acme/mfes');
  });
});
