import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { PersistenceDef } from '../types/registry-defs';

/**
 * Registry of pluggable storage adapters. Default registrations:
 *  - 'localStorage' — synchronous browser storage, JSON-serialized.
 *  - 'sessionStorage' — same shape, scoped to the browser session.
 *  - 'memory' — in-memory Map (default for SSR / tests).
 *
 * Apps can register additional adapters (Dexie/IndexedDB, server-side store)
 * via `register(...)`. The chat shell reads/writes conversation history,
 * draft form values, and active backend selection through this registry.
 */
@Injectable({ providedIn: 'root' })
export class PersistenceRegistry extends RegistryBase<PersistenceDef> {
  protected readonly registryName = 'persistence';

  constructor() {
    super();
    this.register(memoryStore('memory'));
    if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
      this.register(webStorageStore('localStorage', globalThis.localStorage));
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.sessionStorage !== 'undefined') {
      this.register(webStorageStore('sessionStorage', globalThis.sessionStorage));
    }
  }
}

export function memoryStore(name = 'memory'): PersistenceDef {
  const map = new Map<string, unknown>();
  return {
    name,
    kind: 'kv',
    read: async (key) => map.get(key),
    write: async (key, value) => { map.set(key, value); },
    remove: async (key) => { map.delete(key); },
    clear: async () => { map.clear(); },
  };
}

export function webStorageStore(name: string, storage: Storage): PersistenceDef {
  return {
    name,
    kind: 'json',
    read: async (key) => {
      const raw = storage.getItem(key);
      if (raw === null) return undefined;
      try { return JSON.parse(raw); } catch { return raw; }
    },
    write: async (key, value) => {
      storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    remove: async (key) => { storage.removeItem(key); },
    clear: async () => { storage.clear(); },
  };
}

/**
 * IndexedDB-backed adapter. Same `read / write / remove / clear` contract
 * as `webStorageStore`, but:
 *
 * - **Capacity.** Multi-MB to GB depending on browser quota (vs. ~5 MB
 *   for `localStorage`). Useful when an adopter persists transcripts,
 *   dashboard chains, or large `SlotMap` versions over time.
 * - **Structured-clone semantics.** Stores `Date`, `Map`, `Set`,
 *   `ArrayBuffer`, etc. directly — no `JSON.stringify` roundtrip — so
 *   richer payloads survive a write/read cycle byte-for-byte.
 * - **Concurrent transactions.** Multiple writes don't block each other;
 *   each `write()` opens a short-lived read/write transaction.
 *
 * Not auto-registered by `PersistenceRegistry` — IndexedDB doesn't exist
 * in SSR and may be denied in private-browsing mode. Adopters opt in:
 *
 * ```ts
 * // app.config.ts — swap the store backing `'localStorage'` so existing
 * // stores ({@link WorkspaceLayoutStore}, {@link ProposedDashboardStore},
 * // chat transcript) flip over without their code changing.
 * const reg = inject(PersistenceRegistry);
 * reg.register(indexedDbStore('localStorage'));   // overrides the default
 * ```
 *
 * Or register under a NEW name + point a specific store at it:
 *
 * ```ts
 * reg.register(indexedDbStore('idb'));            // joins existing 'localStorage'
 * // Custom store reads/writes via reg.get('idb') instead.
 * ```
 *
 * @param name        Registry name (default `'indexedDb'`).
 * @param options     Database + store name + version. Defaults:
 *                    `dbName: 'agentic-ui'`, `storeName: 'kv'`, `version: 1`.
 */
export function indexedDbStore(
  name = 'indexedDb',
  options: { dbName?: string; storeName?: string; version?: number } = {},
): PersistenceDef {
  const dbName = options.dbName ?? 'agentic-ui';
  const storeName = options.storeName ?? 'kv';
  const dbVersion = options.version ?? 1;

  let dbPromise: Promise<IDBDatabase> | null = null;
  function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, dbVersion);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) {
          req.result.createObjectStore(storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function objectStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }

  function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    name,
    kind: 'kv',
    read: async (key) => {
      const store = await objectStore('readonly');
      const result = await promisifyRequest(store.get(key));
      // Match webStorageStore: missing key → undefined (not null).
      return result === null ? undefined : result;
    },
    write: async (key, value) => {
      const store = await objectStore('readwrite');
      await promisifyRequest(store.put(value, key));
    },
    remove: async (key) => {
      const store = await objectStore('readwrite');
      await promisifyRequest(store.delete(key));
    },
    clear: async () => {
      const store = await objectStore('readwrite');
      await promisifyRequest(store.clear());
    },
  };
}
