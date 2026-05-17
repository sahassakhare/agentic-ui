import { describe, expect, it, vi, beforeEach } from 'vitest';
import { run } from './cli.js';

beforeEach(() => {
  // Stub fetch globally — every test below uses run() which builds
  // its own catalog client via the global fetch.
  vi.restoreAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

describe('cli — top-level', () => {
  it('help returns 0', async () => {
    const code = await run(['help']);
    expect(code).toBe(0);
  });

  it('version returns 0', async () => {
    const code = await run(['version']);
    expect(code).toBe(0);
  });

  it('unknown command returns 1', async () => {
    const code = await run(['nonsense']);
    expect(code).toBe(1);
  });
});

describe('cli — dispatch', () => {
  it('mvk health hits /healthz with disabled mode', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
      expect(url).toContain('/healthz');
      return new Response(JSON.stringify({ status: 'ok', authMode: 'disabled' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const code = await run([
      'health',
      '--catalog-url', 'http://localhost:8080',
      '--auth-mode', 'disabled',
    ]);
    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('mvk usage falls back to the _default aggregate command', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
      expect(url).toContain('/v1/catalogs/acme/usage');
      return new Response(JSON.stringify({
        from: null, to: null, byKind: {}, totalEvents: 0, totalQuantity: 0,
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const code = await run([
      'usage',
      '--catalog-url', 'http://localhost:8080',
      '--auth-mode', 'disabled',
      '--tenant', 'acme',
    ]);
    expect(code).toBe(0);
  });

  it('mvk tenant get <id> resolves the right URL', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
      expect(url).toContain('/v1/tenants/acme');
      return new Response(JSON.stringify({ id: 'acme', displayName: 'Acme', status: 'active' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const code = await run([
      'tenant', 'get', 'acme',
      '--catalog-url', 'http://localhost:8080',
      '--auth-mode', 'disabled',
    ]);
    expect(code).toBe(0);
  });

  it('mvk tenant delete without --force exits 1', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const code = await run([
      'tenant', 'delete', 'acme',
      '--catalog-url', 'http://localhost:8080',
      '--auth-mode', 'disabled',
    ]);
    expect(code).toBe(1);
  });

  it('mvk audit verify returns 2 when chain is broken', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      valid: false,
      checkedRows: 5,
      chainHead: null,
      brokenAt: { chainPosition: 6, reason: 'entry_hash mismatch' },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const code = await run([
      'audit', 'verify',
      '--catalog-url', 'http://localhost:8080',
      '--auth-mode', 'disabled',
      '--tenant', 'acme',
    ]);
    expect(code).toBe(2);
  });

  it('mvk capability list emits a 422 detail message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ title: 'Unprocessable Entity', detail: 'kind required' }), {
        status: 422,
      }),
    ));
    const code = await run([
      'capability', 'list',
      '--catalog-url', 'http://localhost:8080',
      '--auth-mode', 'disabled',
      '--tenant', 'acme',
    ]);
    // 422 → CatalogError → exit code 2 (HTTP 4xx).
    expect(code).toBe(2);
  });
});
