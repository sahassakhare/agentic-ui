import { Injectable } from '@angular/core';

/**
 * Cross-instance cache of tile invocation results.
 *
 * Two dashboard tiles that reference the same tool with the same args
 * (or the same data source with the same query) within `cacheTtlMs`
 * should dedupe to **one** underlying fetch — that's the whole point
 * of [ADR-044 D7](../../../../docs/adr/0044-dashboard-registry.md)'s
 * tile-cache discussion. Without this, the production-throughput
 * dashboard's three "weekly throughput" tiles fire the same tool
 * three times per refresh; with this, they fire it once and serve
 * the rest from the in-memory cache.
 *
 * The cache lives in `providedIn: 'root'`, so every `<mvk-dashboard-tile>`
 * instance reads from the same map. Keys are deterministic strings
 * based on `{kind, tool|source, JSON.stringify(args|query)}`.
 *
 * @see [ADR-044 P3.C](../../../../docs/adr/0044-dashboard-registry.md#p3c--live--queryable--drillable-1-week)
 */
@Injectable({ providedIn: 'root' })
export class TileResultCache {
  private readonly entries = new Map<string, CacheEntry>();
  /** In-flight requests indexed by cache key — dedupe concurrent fires. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Return the cached value if it exists and is younger than
   * `ttlMs`. Returns `undefined` for misses, stale entries, or
   * `ttlMs <= 0`.
   */
  read(key: string, ttlMs: number): unknown | undefined {
    if (ttlMs <= 0) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.fetchedAt >= ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Write a value to the cache. Eviction happens lazily on read. */
  write(key: string, value: unknown): void {
    this.entries.set(key, { value, fetchedAt: Date.now() });
  }

  /**
   * If a fetch is already in-flight for this key, return its
   * promise (so N concurrent callers share one underlying call).
   * Otherwise undefined — caller should invoke + write through
   * `track()`.
   */
  inflightFor(key: string): Promise<unknown> | undefined {
    return this.inflight.get(key);
  }

  /**
   * Invoke `factory()`, registering its promise as in-flight so
   * concurrent calls share it. Writes the resolved value to the
   * cache. Errors propagate.
   */
  async track(key: string, factory: () => Promise<unknown>): Promise<unknown> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = factory()
      .then((value) => {
        this.write(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Drop an entry (e.g. when the host knows the underlying data changed). */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  /** Drop everything. Useful for tests + persona switches. */
  clear(): void {
    this.entries.clear();
  }

  /** Diagnostic: number of cached entries. */
  size(): number {
    return this.entries.size;
  }
}

interface CacheEntry {
  readonly value: unknown;
  readonly fetchedAt: number;
}

/** Build the deterministic key used by `TileResultCache`. */
export function tileCacheKey(
  kind: 'tool' | 'data',
  identifier: string,
  argsOrQuery: unknown,
): string {
  return `${kind}|${identifier}|${stableStringify(argsOrQuery)}`;
}

/** JSON.stringify with sorted keys so `{a:1,b:2}` and `{b:2,a:1}` produce the same key. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = (v as Record<string, unknown>)[k];
    }
    return sorted;
  });
}
