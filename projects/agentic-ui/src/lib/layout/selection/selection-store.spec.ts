import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SelectionStore } from './selection-store';
import { SelectionLayoutInput } from './selection-layout-input';
import { SELECTION_LAYOUT_RULES, type SelectionLayoutRule } from './types';

describe('SelectionStore', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('starts empty', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(SelectionStore);
    expect(store.selection()).toBeNull();
  });

  it('set + clear round-trip', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(SelectionStore);
    store.set({ kind: 'document', ids: ['doc-1', 'doc-2'] });
    expect(store.selection()?.kind).toBe('document');
    expect(store.selection()?.ids).toEqual(['doc-1', 'doc-2']);
    store.clear();
    expect(store.selection()).toBeNull();
  });

  it('patchMetadata merges without overwriting kind/ids', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(SelectionStore);
    store.set({ kind: 'document', ids: ['doc-1'], metadata: { tag: 'privilege' } });
    store.patchMetadata({ priority: 'high' });
    expect(store.selection()?.kind).toBe('document');
    expect(store.selection()?.ids).toEqual(['doc-1']);
    expect(store.selection()?.metadata).toEqual({ tag: 'privilege', priority: 'high' });
  });

  it('patchMetadata is no-op when no selection is active', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(SelectionStore);
    store.patchMetadata({ foo: 'bar' });
    expect(store.selection()).toBeNull();
  });
});

describe('SelectionLayoutInput', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function setupWithRules(rules: readonly SelectionLayoutRule[]) {
    TestBed.configureTestingModule({
      providers: [{ provide: SELECTION_LAYOUT_RULES, useValue: rules }],
    });
    return {
      store: TestBed.inject(SelectionStore),
      input: TestBed.inject(SelectionLayoutInput),
    };
  }

  it('returns no rules when no selection is active', () => {
    const { input } = setupWithRules([
      { kind: 'document', slots: {} },
    ]);
    expect(input.evaluate()).toEqual([]);
  });

  it('fires the matching kind + count rule', () => {
    const { store, input } = setupWithRules([
      { kind: 'document', minCount: 1, maxCount: 1, slots: { primary: { component: 'docPreview' } } },
    ]);
    store.set({ kind: 'document', ids: ['doc-1'] });
    const rules = input.evaluate();
    expect(rules).toHaveLength(1);
    expect(rules[0].slots).toEqual({ primary: { component: 'docPreview' } });
  });

  it('skips rules whose kind doesnt match', () => {
    const { store, input } = setupWithRules([
      { kind: 'document', slots: {} },
      { kind: 'custodian', slots: { primary: { component: 'custodianCard' } } },
    ]);
    store.set({ kind: 'custodian', ids: ['cust-1'] });
    const rules = input.evaluate();
    expect(rules).toHaveLength(1);
    expect(rules[0].slots).toEqual({ primary: { component: 'custodianCard' } });
  });

  it('respects minCount + maxCount bounds', () => {
    const { store, input } = setupWithRules([
      { kind: 'document', minCount: 2, maxCount: 5, slots: { primary: { component: 'multiDoc' } } },
    ]);
    store.set({ kind: 'document', ids: ['d1'] });
    expect(input.evaluate()).toEqual([]);  // count=1 below min
    store.set({ kind: 'document', ids: ['d1', 'd2', 'd3'] });
    expect(input.evaluate()).toHaveLength(1);
    store.set({ kind: 'document', ids: Array.from({ length: 6 }, (_, i) => `d${i}`) });
    expect(input.evaluate()).toEqual([]);  // count=6 above max
  });

  it('uses the reason from the rule when supplied', () => {
    const { store, input } = setupWithRules([
      { kind: 'document', slots: {}, reason: 'one-doc focus mode' },
    ]);
    store.set({ kind: 'document', ids: ['d1'] });
    expect(input.evaluate()[0].reason).toBe('one-doc focus mode');
  });
});
