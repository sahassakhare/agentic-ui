import type { PersistenceDef } from '../../types/registry-defs';

/**
 * Adopter-supplied wiring for `httpPersistenceStore`. The implementation
 * stays runtime-agnostic — adopters bring their fetch implementation +
 * auth strategy + URL shape. Defaults are sensible for a REST-style
 * KV endpoint at `${baseUrl}/${encodeURIComponent(key)}` with JSON
 * request/response bodies.
 */
export interface HttpPersistenceOptions {
  /** Adapter name to register under (e.g. `'user-store'`, `'matter-store'`). */
  readonly name: string;
  /**
   * Base URL — keys are appended via the `urlForKey` strategy. Default
   * strategy: `${baseUrl}/${encodeURIComponent(key)}`. Override
   * `urlForKey` for path-shape variants (e.g. `?key=` query, nested
   * `/users/:id/layouts/:name` REST shape).
   */
  readonly baseUrl: string;
  /** Override the default `${baseUrl}/${encodeURIComponent(key)}` strategy. */
  readonly urlForKey?: (baseUrl: string, key: string) => string;
  /**
   * Per-request init customizer. Use for auth headers, signal
   * cancellation, etag handling. Receives the default init the
   * adapter would have used + the operation kind for branching.
   */
  readonly init?: (op: 'read' | 'write' | 'remove' | 'clear', defaultInit: RequestInit) => RequestInit;
  /** Fetch impl — defaults to `globalThis.fetch`. */
  readonly fetcher?: typeof fetch;
  /**
   * When the server responds with 404 to a `read`, treat as missing
   * (return undefined). When false, 404 throws. Default true.
   */
  readonly missingIs404?: boolean;
}

/**
 * ADR-046 D3 — server-side persistence adapter. Drop-in replacement
 * for `webStorageStore` / `indexedDbStore` when the host has a
 * backend that serves layout / dashboard / preference data over HTTP.
 *
 * Same `PersistenceDef` contract as the existing adapters — registering
 * one under a name like `'user-store'` lets adopters bind the
 * `user-saved` `LayoutTier` to it via `provideLayoutTiers` with zero
 * other code changes.
 *
 * Wire pattern (in app.config):
 *
 * ```ts
 * provideEnvironmentInitializer(() => {
 *   const reg = inject(PersistenceRegistry);
 *   reg.register(httpPersistenceStore({
 *     name: 'user-store',
 *     baseUrl: '/api/user-layouts',
 *     init: (op, init) => ({ ...init, headers: { ...init.headers, Authorization: `Bearer ${getToken()}` } }),
 *   }));
 * }),
 * ```
 *
 * Server contract (default `urlForKey` strategy):
 * - `GET  /api/user-layouts/{key}` → 200 + JSON body | 404 → missing
 * - `PUT  /api/user-layouts/{key}` (body: JSON value) → 204
 * - `DELETE /api/user-layouts/{key}` → 204 (404 tolerated)
 * - `DELETE /api/user-layouts` → 204 (clears all keys)
 *
 * Adopters with non-REST-style backends override `urlForKey` and shape
 * `init` to match their API.
 */
export function httpPersistenceStore(options: HttpPersistenceOptions): PersistenceDef {
  const f = options.fetcher ?? ((...args) => globalThis.fetch(...args));
  const urlFor = options.urlForKey ?? defaultUrlForKey;
  const missingIs404 = options.missingIs404 ?? true;

  function makeInit(op: 'read' | 'write' | 'remove' | 'clear', baseInit: RequestInit): RequestInit {
    return options.init ? options.init(op, baseInit) : baseInit;
  }

  return {
    name: options.name,
    kind: 'json',
    read: async (key) => {
      const init = makeInit('read', { method: 'GET' });
      const res = await f(urlFor(options.baseUrl, key), init);
      if (res.status === 404 && missingIs404) return undefined;
      if (!res.ok) {
        throw new Error(`[httpPersistenceStore:${options.name}] read failed for "${key}" (${res.status})`);
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) return res.json();
      const text = await res.text();
      if (text.length === 0) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    write: async (key, value) => {
      const init = makeInit('write', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      const res = await f(urlFor(options.baseUrl, key), init);
      if (!res.ok) {
        throw new Error(`[httpPersistenceStore:${options.name}] write failed for "${key}" (${res.status})`);
      }
    },
    remove: async (key) => {
      const init = makeInit('remove', { method: 'DELETE' });
      const res = await f(urlFor(options.baseUrl, key), init);
      if (!res.ok && res.status !== 404) {
        throw new Error(`[httpPersistenceStore:${options.name}] remove failed for "${key}" (${res.status})`);
      }
    },
    clear: async () => {
      const init = makeInit('clear', { method: 'DELETE' });
      const res = await f(options.baseUrl, init);
      if (!res.ok && res.status !== 404) {
        throw new Error(`[httpPersistenceStore:${options.name}] clear failed (${res.status})`);
      }
    },
  };
}

function defaultUrlForKey(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(key)}`;
}
