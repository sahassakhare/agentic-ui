import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { TileResultCache, tileCacheKey } from './tile-result-cache';

describe('TileResultCache', () => {
  it('read returns undefined for unknown keys', () => {
    TestBed.configureTestingModule({});
    const cache = TestBed.inject(TileResultCache);
    expect(cache.read('nope', 5000)).toBeUndefined();
  });

  it('write + read returns the cached value within TTL', () => {
    TestBed.configureTestingModule({});
    const cache = TestBed.inject(TileResultCache);
    cache.write('k', { count: 47 });
    expect(cache.read('k', 60_000)).toEqual({ count: 47 });
  });

  it('read returns undefined for ttlMs <= 0 (cache disabled)', () => {
    TestBed.configureTestingModule({});
    const cache = TestBed.inject(TileResultCache);
    cache.write('k', 1);
    expect(cache.read('k', 0)).toBeUndefined();
    expect(cache.read('k', -1)).toBeUndefined();
  });

  it('expires entries past TTL and evicts on read', async () => {
    TestBed.configureTestingModule({});
    const cache = TestBed.inject(TileResultCache);
    cache.write('k', 'v');
    expect(cache.size()).toBe(1);
    // Wait 10ms past a 5ms TTL.
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.read('k', 5)).toBeUndefined();
    expect(cache.size()).toBe(0);    // lazy-evicted on read
  });

  it('invalidate drops a single entry; clear drops all', () => {
    TestBed.configureTestingModule({});
    const cache = TestBed.inject(TileResultCache);
    cache.write('a', 1);
    cache.write('b', 2);
    cache.invalidate('a');
    expect(cache.read('a', 60_000)).toBeUndefined();
    expect(cache.read('b', 60_000)).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('track invokes the factory once + caches the result', async () => {
    TestBed.configureTestingModule({});
    const cache = TestBed.inject(TileResultCache);
    let calls = 0;
    const factory = async (): Promise<number> => {
      calls += 1;
      return 42;
    };
    const first = await cache.track('k', factory);
    expect(first).toBe(42);
    expect(calls).toBe(1);
    expect(cache.read('k', 60_000)).toBe(42);
  });

  it('track dedupes concurrent calls — one factory invocation for N concurrent waits', async () => {
    TestBed.configureTestingModule({});
    const cache = TestBed.inject(TileResultCache);
    let calls = 0;
    const factory = async (): Promise<number> => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return 7;
    };
    const [a, b, c] = await Promise.all([
      cache.track('shared', factory),
      cache.track('shared', factory),
      cache.track('shared', factory),
    ]);
    expect(calls).toBe(1);
    expect([a, b, c]).toEqual([7, 7, 7]);
  });

  it('track releases the in-flight slot after the factory rejects', async () => {
    TestBed.configureTestingModule({});
    const cache = TestBed.inject(TileResultCache);
    let calls = 0;
    const failing = async (): Promise<never> => {
      calls += 1;
      throw new Error('boom');
    };
    await expect(cache.track('k', failing)).rejects.toThrow('boom');
    expect(calls).toBe(1);
    expect(cache.inflightFor('k')).toBeUndefined();
    // Second call hits the factory again — cache has nothing to serve.
    await expect(cache.track('k', failing)).rejects.toThrow('boom');
    expect(calls).toBe(2);
  });
});

describe('tileCacheKey', () => {
  it('produces a stable key per (kind, identifier, args)', () => {
    expect(tileCacheKey('tool', 'computeThroughput', { week: '2026-W19' })).toBe(
      'tool|computeThroughput|{"week":"2026-W19"}',
    );
  });

  it('orders args keys deterministically — different key order, same hash', () => {
    const a = tileCacheKey('tool', 'sum', { x: 1, y: 2 });
    const b = tileCacheKey('tool', 'sum', { y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it('different identifiers / kinds / args produce different keys', () => {
    expect(tileCacheKey('tool', 'a', {})).not.toBe(tileCacheKey('tool', 'b', {}));
    expect(tileCacheKey('tool', 'a', {})).not.toBe(tileCacheKey('data', 'a', {}));
    expect(tileCacheKey('tool', 'a', { x: 1 })).not.toBe(tileCacheKey('tool', 'a', { x: 2 }));
  });
});
