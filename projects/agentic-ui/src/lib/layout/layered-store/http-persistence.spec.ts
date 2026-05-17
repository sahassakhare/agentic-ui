import { describe, expect, it, vi } from 'vitest';

import { httpPersistenceStore } from './http-persistence';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('httpPersistenceStore', () => {
  it('GET /baseUrl/<key> returns parsed JSON on 200', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ schemaVersion: 1, name: 'layout-a' }));
    const store = httpPersistenceStore({ name: 'user-store', baseUrl: '/api/user', fetcher: fetcher as any });
    const result = await store.read('layout-a');
    expect(result).toEqual({ schemaVersion: 1, name: 'layout-a' });
    expect(fetcher).toHaveBeenCalledWith('/api/user/layout-a', expect.objectContaining({ method: 'GET' }));
  });

  it('GET returning 404 resolves to undefined when missingIs404 (default)', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    const store = httpPersistenceStore({ name: 'user-store', baseUrl: '/api/user', fetcher: fetcher as any });
    expect(await store.read('absent')).toBeUndefined();
  });

  it('GET 404 throws when missingIs404 = false', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    const store = httpPersistenceStore({
      name: 'user-store',
      baseUrl: '/api/user',
      fetcher: fetcher as any,
      missingIs404: false,
    });
    await expect(store.read('absent')).rejects.toThrow(/read failed/);
  });

  it('PUT writes a JSON body to /baseUrl/<key>', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const store = httpPersistenceStore({ name: 'user-store', baseUrl: '/api/user', fetcher: fetcher as any });
    await store.write('layout-a', { schemaVersion: 1, foo: 'bar' });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/user/layout-a',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: '{"schemaVersion":1,"foo":"bar"}',
      }),
    );
  });

  it('DELETE removes a key + tolerates 404', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    const store = httpPersistenceStore({ name: 'user-store', baseUrl: '/api/user', fetcher: fetcher as any });
    await expect(store.remove('layout-a')).resolves.toBeUndefined();
  });

  it('DELETE on baseUrl clears everything', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const store = httpPersistenceStore({ name: 'user-store', baseUrl: '/api/user', fetcher: fetcher as any });
    await store.clear();
    expect(fetcher).toHaveBeenCalledWith('/api/user', expect.objectContaining({ method: 'DELETE' }));
  });

  it('init() customizer wraps every request', async () => {
    const fetcher = vi.fn(async () => jsonResponse({}));
    const store = httpPersistenceStore({
      name: 'user-store',
      baseUrl: '/api/user',
      fetcher: fetcher as any,
      init: (op, init) => ({ ...init, headers: { ...init.headers, Authorization: `Bearer test-${op}` } }),
    });
    await store.read('k');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/user/k',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-read' }) }),
    );
  });

  it('urlForKey customizer changes the path strategy', async () => {
    const fetcher = vi.fn(async () => jsonResponse({}));
    const store = httpPersistenceStore({
      name: 'user-store',
      baseUrl: '/api/user',
      urlForKey: (base, key) => `${base}?id=${encodeURIComponent(key)}`,
      fetcher: fetcher as any,
    });
    await store.read('layout-a');
    expect(fetcher).toHaveBeenCalledWith('/api/user?id=layout-a', expect.anything());
  });
});
