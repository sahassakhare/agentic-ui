import { TestBed } from '@angular/core/testing';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  indexedDbStore,
  memoryStore,
  PersistenceRegistry,
  webStorageStore,
} from './persistence-registry';

describe('PersistenceRegistry — adapter factories', () => {
  describe('memoryStore', () => {
    it('round-trips primitives + objects through read/write/remove/clear', async () => {
      const store = memoryStore('mem-test');
      expect(await store.read('missing')).toBeUndefined();
      await store.write('k1', 'hello');
      await store.write('k2', { nested: [1, 2, 3] });
      expect(await store.read('k1')).toBe('hello');
      expect(await store.read('k2')).toEqual({ nested: [1, 2, 3] });
      await store.remove('k1');
      expect(await store.read('k1')).toBeUndefined();
      await store.clear();
      expect(await store.read('k2')).toBeUndefined();
    });
  });

  describe('webStorageStore', () => {
    it('json-serializes through a Storage-shaped backend', async () => {
      const fake = new Map<string, string>();
      const storage: Storage = {
        get length() { return fake.size; },
        key: (i) => Array.from(fake.keys())[i] ?? null,
        clear: () => fake.clear(),
        getItem: (k) => fake.get(k) ?? null,
        setItem: (k, v) => { fake.set(k, v); },
        removeItem: (k) => { fake.delete(k); },
      };
      const store = webStorageStore('ws-test', storage);
      await store.write('obj', { a: 1, b: 'two' });
      // JSON-roundtrip preserves shape but stores as a string under the hood.
      expect(fake.get('obj')).toBe('{"a":1,"b":"two"}');
      expect(await store.read('obj')).toEqual({ a: 1, b: 'two' });
      // String values bypass JSON.stringify.
      await store.write('raw', 'plain');
      expect(fake.get('raw')).toBe('plain');
      expect(await store.read('raw')).toBe('plain');
      // Missing → undefined (not null).
      expect(await store.read('nope')).toBeUndefined();
    });
  });

  describe('indexedDbStore', () => {
    // Each test runs against an isolated DB name so fake-indexeddb state
    // doesn't bleed between cases.
    let dbCounter = 0;
    function freshStore() {
      dbCounter += 1;
      return indexedDbStore('idb-test', { dbName: `agentic-ui-test-${dbCounter}` });
    }

    it('round-trips primitives + objects', async () => {
      const store = freshStore();
      expect(await store.read('missing')).toBeUndefined();
      await store.write('k1', 'hello');
      await store.write('k2', { nested: [1, 2, 3] });
      expect(await store.read('k1')).toBe('hello');
      expect(await store.read('k2')).toEqual({ nested: [1, 2, 3] });
    });

    it('preserves structured-clone types that JSON would lose', async () => {
      const store = freshStore();
      const when = new Date('2026-05-15T12:00:00.000Z');
      await store.write('date', when);
      const back = await store.read('date');
      // IndexedDB stores via structured clone, so Date survives as Date —
      // unlike webStorageStore which would serialize to ISO string.
      expect(back).toBeInstanceOf(Date);
      expect((back as Date).toISOString()).toBe(when.toISOString());
    });

    it('removes single keys without touching siblings', async () => {
      const store = freshStore();
      await store.write('a', 1);
      await store.write('b', 2);
      await store.remove('a');
      expect(await store.read('a')).toBeUndefined();
      expect(await store.read('b')).toBe(2);
    });

    it('clear() wipes the entire store', async () => {
      const store = freshStore();
      await store.write('a', 1);
      await store.write('b', 2);
      await store.clear();
      expect(await store.read('a')).toBeUndefined();
      expect(await store.read('b')).toBeUndefined();
    });
  });

  describe('PersistenceRegistry — registration + swap pattern', () => {
    beforeEach(() => TestBed.resetTestingModule());

    it('seeds memory adapter; indexedDbStore can be registered + listed', () => {
      TestBed.configureTestingModule({});
      const reg = TestBed.inject(PersistenceRegistry);
      // 'memory' is always seeded by the constructor.
      expect(reg.get('memory')).toBeDefined();
      // Adopter registers an IDB adapter under a fresh name.
      reg.register(indexedDbStore('idb', { dbName: 'agentic-ui-reg-test' }));
      expect(reg.get('idb')?.kind).toBe('kv');
    });

    it('replaces the default localStorage adapter when registered under the same name', async () => {
      TestBed.configureTestingModule({});
      const reg = TestBed.inject(PersistenceRegistry);
      // Swap pattern — adopter overrides the default 'localStorage' name
      // with an IDB adapter. Existing stores that look up by name get IDB
      // without their code changing.
      reg.register(indexedDbStore('localStorage', { dbName: 'agentic-ui-swap-test' }));
      const adapter = reg.get('localStorage');
      expect(adapter?.kind).toBe('kv');
      await adapter?.write('probe', { swapped: true });
      expect(await adapter?.read('probe')).toEqual({ swapped: true });
    });
  });
});
