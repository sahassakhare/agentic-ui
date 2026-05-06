import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { agenticDataSource } from '../factories/agentic-data-source';
import { DataSourceRegistry, UnknownDataSourceError } from './data-source-registry';

describe('DataSourceRegistry — F2 typed accessor', () => {
  let registry: DataSourceRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(DataSourceRegistry);
  });

  it('getTyped returns a typed view of a registered source', async () => {
    registry.register(
      agenticDataSource<{ prefix: string }, Promise<readonly string[]>>({
        name: 'users',
        kind: 'rest',
        adapter: async ({ prefix }) =>
          ['Sarah Chen', 'Marcus Osei'].filter((n) =>
            n.toLowerCase().includes(prefix.toLowerCase()),
          ),
      }),
    );

    const typed = registry.getTyped<{ prefix: string }, Promise<readonly string[]>>('users');
    expect(typed.name).toBe('users');
    expect(typed.kind).toBe('rest');
    const result = await typed.adapter({ prefix: 'Sa' });
    expect(result).toEqual(['Sarah Chen']);
  });

  it('getTyped throws UnknownDataSourceError with available names listed', () => {
    registry.register(
      agenticDataSource({ name: 'users', kind: 'rest', adapter: async () => [] }),
    );
    registry.register(
      agenticDataSource({ name: 'departments', kind: 'rest', adapter: async () => [] }),
    );

    let caught: unknown;
    try {
      registry.getTyped('nonexistent');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnknownDataSourceError);
    const err = caught as UnknownDataSourceError;
    expect(err.sourceName).toBe('nonexistent');
    expect(err.available).toEqual(expect.arrayContaining(['users', 'departments']));
    expect(err.message).toContain('"nonexistent"');
    expect(err.message).toContain('"users"');
  });

  it('missing returns names that are not registered', () => {
    registry.register(
      agenticDataSource({ name: 'users', kind: 'rest', adapter: async () => null }),
    );
    expect(registry.missing(['users'])).toEqual([]);
    expect(registry.missing(['users', 'departments', 'roles'])).toEqual([
      'departments',
      'roles',
    ]);
  });

  it('missing on empty input returns empty array (no work)', () => {
    expect(registry.missing([])).toEqual([]);
  });

  it('AC-F2-3 — swapping a source adapter does not change the typed accessor signature', async () => {
    // Mock adapter (test build).
    const dispose = registry.register(
      agenticDataSource<{ prefix: string }, Promise<readonly string[]>>({
        name: 'users',
        kind: 'rest',
        adapter: async () => ['mock-1', 'mock-2'],
      }),
    );
    let typed = registry.getTyped<{ prefix: string }, Promise<readonly string[]>>('users');
    expect(await typed.adapter({ prefix: '' })).toEqual(['mock-1', 'mock-2']);

    // Swap to a different adapter under the same name.
    dispose();
    registry.register(
      agenticDataSource<{ prefix: string }, Promise<readonly string[]>>({
        name: 'users',
        kind: 'rest',
        adapter: async ({ prefix }) => [`real-${prefix}`],
      }),
    );

    // Re-fetch the typed view; signature unchanged, behaviour swapped.
    typed = registry.getTyped<{ prefix: string }, Promise<readonly string[]>>('users');
    expect(await typed.adapter({ prefix: 'X' })).toEqual(['real-X']);
  });
});
