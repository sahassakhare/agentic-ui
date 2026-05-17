import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MfeRegistryClient } from './mfe-registry-source';
import { provideSpringBootMfeRegistry } from './spring-boot-mfe-registry';

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function fakeFetch(handler: (req: { url: string; init?: RequestInit }) => Response | Promise<Response>): typeof fetch & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return handler({ url, init });
  }) as typeof fetch & { calls: RecordedCall[] };
  fn.calls = calls;
  return fn;
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  const ok = init.ok ?? true;
  return {
    ok,
    status: init.status ?? (ok ? 200 : 500),
    statusText: init.statusText ?? '',
    json: async () => body,
  } as unknown as Response;
}

describe('provideSpringBootMfeRegistry — discover', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('hits the default REST path with the env query param', async () => {
    const fetchFn = fakeFetch(() => jsonResponse({ mfes: [] }));
    TestBed.configureTestingModule({
      providers: [provideSpringBootMfeRegistry({ url: 'https://registry.example', fetchFn })],
    });
    await TestBed.inject(MfeRegistryClient).discover('staging');
    expect(fetchFn.calls).toHaveLength(1);
    expect(fetchFn.calls[0]!.url).toBe('https://registry.example/mfes?env=staging');
  });

  it('passes Accept + auth headers to the request', async () => {
    const fetchFn = fakeFetch(() => jsonResponse({ mfes: [] }));
    TestBed.configureTestingModule({
      providers: [provideSpringBootMfeRegistry({
        url: 'https://registry.example',
        headers: { Authorization: 'Bearer abc' },
        fetchFn,
      })],
    });
    await TestBed.inject(MfeRegistryClient).discover('dev');
    const headers = fetchFn.calls[0]!.init?.headers as Record<string, string> | undefined;
    expect(headers?.['Accept']).toBe('application/json');
    expect(headers?.['Authorization']).toBe('Bearer abc');
  });

  it('normalizes records that use mfeId / remoteEntryUrl field aliases', async () => {
    const fetchFn = fakeFetch(() => jsonResponse({
      mfes: [
        // Spring Boot service flavor: mfeId + remoteEntryUrl + deploymentUrl
        { mfeId: 'bookings', version: '1.4.2', remoteEntryUrl: 'https://cdn/bookings/remoteEntry.json', deploymentUrl: 'https://cdn/bookings/' },
      ],
    }));
    TestBed.configureTestingModule({
      providers: [provideSpringBootMfeRegistry({ url: 'https://registry.example', fetchFn })],
    });
    const remotes = await TestBed.inject(MfeRegistryClient).discover('dev');
    expect(remotes).toHaveLength(1);
    expect(remotes[0]!.remoteName).toBe('bookings');
    expect(remotes[0]!.version).toBe('1.4.2');
    expect(remotes[0]!.remoteEntry).toBe('https://cdn/bookings/remoteEntry.json');
    // capabilityManifestResolver default = ${deploymentUrl}/capabilities.json
    expect(remotes[0]!.capabilityManifestUrl).toBe('https://cdn/bookings/capabilities.json');
  });

  it('drops records missing the required remoteEntry field', async () => {
    const fetchFn = fakeFetch(() => jsonResponse({
      mfes: [
        { remoteName: 'good', version: '1.0.0', remoteEntry: 'https://x/remoteEntry.json' },
        { remoteName: 'no-entry', version: '1.0.0' },
      ],
    }));
    TestBed.configureTestingModule({
      providers: [provideSpringBootMfeRegistry({ url: 'https://r', fetchFn })],
    });
    const remotes = await TestBed.inject(MfeRegistryClient).discover('dev');
    expect(remotes.map((r) => r.remoteName)).toEqual(['good']);
  });

  it('accepts a top-level array (not wrapped in {mfes})', async () => {
    const fetchFn = fakeFetch(() => jsonResponse([
      { remoteName: 'flat', version: '2.0.0', remoteEntry: 'https://x/remoteEntry.json' },
    ]));
    TestBed.configureTestingModule({
      providers: [provideSpringBootMfeRegistry({ url: 'https://r', fetchFn })],
    });
    const remotes = await TestBed.inject(MfeRegistryClient).discover('dev');
    expect(remotes).toHaveLength(1);
    expect(remotes[0]!.remoteName).toBe('flat');
  });

  it('falls back to capabilityManifestResolver when record lacks the field', async () => {
    const resolver = vi.fn((rec: Record<string, unknown>) => `${rec['deploymentUrl']}/custom-capabilities.json`);
    const fetchFn = fakeFetch(() => jsonResponse({
      mfes: [
        { remoteName: 'r1', version: '1.0.0', remoteEntry: 'https://x/remoteEntry.json', deploymentUrl: 'https://cdn/r1' },
      ],
    }));
    TestBed.configureTestingModule({
      providers: [provideSpringBootMfeRegistry({
        url: 'https://r',
        capabilityManifestResolver: resolver,
        fetchFn,
      })],
    });
    const remotes = await TestBed.inject(MfeRegistryClient).discover('dev');
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(remotes[0]!.capabilityManifestUrl).toBe('https://cdn/r1/custom-capabilities.json');
  });

  it('honors custom discoveryPath', async () => {
    const fetchFn = fakeFetch(() => jsonResponse({ mfes: [] }));
    TestBed.configureTestingModule({
      providers: [provideSpringBootMfeRegistry({
        url: 'https://r',
        discoveryPath: (env) => `/v2/discovery?environment=${env}`,
        fetchFn,
      })],
    });
    await TestBed.inject(MfeRegistryClient).discover('prod');
    expect(fetchFn.calls[0]!.url).toBe('https://r/v2/discovery?environment=prod');
  });

  it('throws on non-OK responses with status code in the message', async () => {
    const fetchFn = fakeFetch(() => jsonResponse({}, { ok: false, status: 503, statusText: 'Service Unavailable' }));
    TestBed.configureTestingModule({
      providers: [provideSpringBootMfeRegistry({ url: 'https://r', fetchFn })],
    });
    await expect(TestBed.inject(MfeRegistryClient).discover('dev')).rejects.toThrow(/503|Service Unavailable/);
  });
});
