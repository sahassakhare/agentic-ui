import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { MfeRegistryClient, provideStaticJsonMfeRegistry } from './mfe-registry-source';

function fakeFetch(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): typeof fetch {
  return (async () => {
    const ok = init.ok ?? true;
    return {
      ok,
      status: init.status ?? (ok ? 200 : 500),
      statusText: init.statusText ?? '',
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

describe('provideStaticJsonMfeRegistry + MfeRegistryClient.discover', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('parses a valid {remotes: RemoteSpec[]} document', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideStaticJsonMfeRegistry({
          url: '/mfes.json',
          fetchFn: fakeFetch({
            remotes: [
              { remoteName: 'bookings', version: '1.0.0', remoteEntry: 'http://r:4201/remoteEntry.json' },
              { remoteName: 'loyalty',  version: '0.4.2', remoteEntry: 'http://r:4202/remoteEntry.json', env: 'dev' },
            ],
          }),
        }),
      ],
    });
    const client = TestBed.inject(MfeRegistryClient);
    const remotes = await client.discover('dev');
    expect(remotes).toHaveLength(2);
    expect(remotes[0]!.remoteName).toBe('bookings');
    expect(remotes[1]!.env).toBe('dev');
  });

  it('drops malformed entries via Zod validation but keeps the rest', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideStaticJsonMfeRegistry({
          url: '/mfes.json',
          fetchFn: fakeFetch({
            remotes: [
              { remoteName: 'good', version: '1.0.0', remoteEntry: 'http://x/remoteEntry.json' },
              { remoteName: 'missing-entry', version: '1.0.0' },
              { wholly: 'invalid' },
            ],
          }),
        }),
      ],
    });
    const remotes = await TestBed.inject(MfeRegistryClient).discover('dev');
    expect(remotes).toHaveLength(1);
    expect(remotes[0]!.remoteName).toBe('good');
  });

  it('returns [] when the document has no remotes array', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideStaticJsonMfeRegistry({ url: '/x.json', fetchFn: fakeFetch({}) }),
      ],
    });
    const remotes = await TestBed.inject(MfeRegistryClient).discover('dev');
    expect(remotes).toEqual([]);
  });

  it('throws when the fetch returns a non-OK response', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideStaticJsonMfeRegistry({
          url: '/mfes.json',
          fetchFn: fakeFetch({}, { ok: false, status: 404, statusText: 'Not Found' }),
        }),
      ],
    });
    await expect(TestBed.inject(MfeRegistryClient).discover('dev')).rejects.toThrow(/404|Not Found/);
  });

  it('throws a friendly error when no MfeRegistrySource is configured', async () => {
    TestBed.configureTestingModule({});
    await expect(TestBed.inject(MfeRegistryClient).discover('dev'))
      .rejects.toThrow(/No MfeRegistrySource configured/);
  });
});
