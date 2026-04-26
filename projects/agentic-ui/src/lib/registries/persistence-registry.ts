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
