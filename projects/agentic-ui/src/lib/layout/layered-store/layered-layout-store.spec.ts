import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PersistenceRegistry, memoryStore } from '../../registries/persistence-registry';
import { LayoutMigratorChain } from '../migration';
import { LAYOUT_MIGRATOR } from '../migration/types';
import { LayeredLayoutStore } from './layered-layout-store';
import { LAYOUT_TIER, type LayoutTier } from './types';

function tier(over: Partial<LayoutTier> & Pick<LayoutTier, 'id' | 'source' | 'adapterName' | 'namespace'>): LayoutTier {
  return { ...over };
}

function provideTier(t: LayoutTier) {
  return { provide: LAYOUT_TIER, useValue: t, multi: true } as const;
}

describe('LayeredLayoutStore', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('returns null when no tier has the entry', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideTier(tier({ id: 'user', source: 'user-saved', adapterName: 'memory', namespace: 'test.user' })),
      ],
    });
    const store = TestBed.inject(LayeredLayoutStore);
    expect(await store.read('missing')).toBeNull();
  });

  it('reads from the first tier that has the entry', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideTier(tier({ id: 'user', source: 'user-saved', adapterName: 'user-store', namespace: 'test.user' })),
        provideTier(tier({ id: 'org', source: 'org-default', adapterName: 'org-store', namespace: 'test.org' })),
      ],
    });
    const reg = TestBed.inject(PersistenceRegistry);
    reg.register(memoryStore('user-store'));
    reg.register(memoryStore('org-store'));
    const store = TestBed.inject(LayeredLayoutStore);

    // Seed only the org tier — user tier is empty.
    await reg.get('org-store')!.write('test.org:layout-a', { schemaVersion: 1, name: 'layout-a', src: 'org' });
    const result = await store.read('layout-a');
    expect(result?.tier.id).toBe('org');
    expect((result?.value as any).src).toBe('org');
  });

  it('first tier wins on overlap (precedence by declaration order)', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideTier(tier({ id: 'user', source: 'user-saved', adapterName: 'user-store', namespace: 'test.user' })),
        provideTier(tier({ id: 'org', source: 'org-default', adapterName: 'org-store', namespace: 'test.org' })),
      ],
    });
    const reg = TestBed.inject(PersistenceRegistry);
    reg.register(memoryStore('user-store'));
    reg.register(memoryStore('org-store'));
    const store = TestBed.inject(LayeredLayoutStore);

    await reg.get('user-store')!.write('test.user:layout-a', { schemaVersion: 1, name: 'layout-a', src: 'user' });
    await reg.get('org-store')!.write('test.org:layout-a', { schemaVersion: 1, name: 'layout-a', src: 'org' });
    const result = await store.read('layout-a');
    expect(result?.tier.id).toBe('user');
    expect((result?.value as any).src).toBe('user');
  });

  it('readAll returns every tier that has the entry, in declaration order', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideTier(tier({ id: 'user', source: 'user-saved', adapterName: 'user-store', namespace: 'test.user' })),
        provideTier(tier({ id: 'org', source: 'org-default', adapterName: 'org-store', namespace: 'test.org' })),
      ],
    });
    const reg = TestBed.inject(PersistenceRegistry);
    reg.register(memoryStore('user-store'));
    reg.register(memoryStore('org-store'));
    const store = TestBed.inject(LayeredLayoutStore);

    await reg.get('user-store')!.write('test.user:layout-a', { schemaVersion: 1, src: 'user' });
    await reg.get('org-store')!.write('test.org:layout-a', { schemaVersion: 1, src: 'org' });
    const all = await store.readAll('layout-a');
    expect(all.map((r) => r.tier.id)).toEqual(['user', 'org']);
  });

  it('applies the migrator chain on read', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideTier(tier({ id: 'user', source: 'user-saved', adapterName: 'user-store', namespace: 'test.user' })),
        { provide: LAYOUT_MIGRATOR, useValue: { id: '0-to-1', from: 0, to: 1, migrate: (e: any) => ({ ...e, schemaVersion: 1, migrated: true }) }, multi: true },
      ],
    });
    const reg = TestBed.inject(PersistenceRegistry);
    reg.register(memoryStore('user-store'));
    const store = TestBed.inject(LayeredLayoutStore);

    // Seed at version 0 — chain should upgrade on read.
    await reg.get('user-store')!.write('test.user:layout-a', { schemaVersion: 0, name: 'layout-a' });
    const result = await store.read('layout-a');
    expect((result?.value as any).schemaVersion).toBe(1);
    expect((result?.value as any).migrated).toBe(true);
  });

  it('writeToTier persists through the named tier adapter', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideTier(tier({ id: 'user', source: 'user-saved', adapterName: 'user-store', namespace: 'test.user' })),
      ],
    });
    const reg = TestBed.inject(PersistenceRegistry);
    reg.register(memoryStore('user-store'));
    const store = TestBed.inject(LayeredLayoutStore);

    await store.writeToTier('user', 'layout-x', { schemaVersion: 1, name: 'layout-x' });
    const raw = await reg.get('user-store')!.read('test.user:layout-x');
    expect(raw).toEqual({ schemaVersion: 1, name: 'layout-x' });
  });

  it('writeToTier denies when canWrite returns false', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideTier(tier({ id: 'org', source: 'org-default', adapterName: 'org-store', namespace: 'test.org', canWrite: () => false })),
      ],
    });
    const reg = TestBed.inject(PersistenceRegistry);
    reg.register(memoryStore('org-store'));
    const store = TestBed.inject(LayeredLayoutStore);
    await expect(store.writeToTier('org', 'x', { schemaVersion: 1 })).rejects.toThrow(/read-only/);
  });

  it('folds tier.scope() value into the key', async () => {
    let userId: string | null = 'user-1';
    TestBed.configureTestingModule({
      providers: [
        provideTier(tier({
          id: 'user',
          source: 'user-saved',
          adapterName: 'user-store',
          namespace: 'test.user',
          scope: () => userId,
        })),
      ],
    });
    const reg = TestBed.inject(PersistenceRegistry);
    reg.register(memoryStore('user-store'));
    const store = TestBed.inject(LayeredLayoutStore);

    await store.writeToTier('user', 'layout-a', { schemaVersion: 1, owner: 'user-1' });
    // Same `name` under a different scope — should read as separate entry.
    userId = 'user-2';
    await store.writeToTier('user', 'layout-a', { schemaVersion: 1, owner: 'user-2' });

    userId = 'user-1';
    expect((await store.readFromTier('user', 'layout-a') as any).owner).toBe('user-1');
    userId = 'user-2';
    expect((await store.readFromTier('user', 'layout-a') as any).owner).toBe('user-2');
  });
});
