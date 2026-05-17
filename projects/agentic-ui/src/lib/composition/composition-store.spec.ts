import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { CompositionStore } from './composition-store';

describe('CompositionStore', () => {
  let store: CompositionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CompositionStore] });
    store = TestBed.inject(CompositionStore);
  });

  describe('read / write / drop', () => {
    it('returns undefined for an unset slot', () => {
      expect(store.read('a')).toBeUndefined();
    });

    it('round-trips a string', () => {
      store.write('a', 'hello');
      expect(store.read('a')).toBe('hello');
    });

    it('round-trips an object', () => {
      store.write('id', { name: 'Sarah', email: 's@a.com' });
      expect(store.read('id')).toEqual({ name: 'Sarah', email: 's@a.com' });
    });

    it('drop removes a slot, leaves others intact', () => {
      store.write('a', 1);
      store.write('b', 2);
      store.drop('a');
      expect(store.read('a')).toBeUndefined();
      expect(store.read('b')).toBe(2);
    });

    it('drop on an unset slot is a no-op (no thrown error, snapshot unchanged)', () => {
      const before = store.snapshot();
      store.drop('nope');
      expect(store.snapshot()).toBe(before);
    });

    it('clear empties the store', () => {
      store.write('a', 1);
      store.write('b', 2);
      store.clear();
      expect(store.snapshot()).toEqual({});
    });
  });

  describe('snapshot / values signal', () => {
    it('snapshot is a stable reference until the next write', () => {
      const s1 = store.snapshot();
      const s2 = store.snapshot();
      expect(s1).toBe(s2);
      store.write('a', 1);
      expect(store.snapshot()).not.toBe(s1);
    });

    it('values signal reflects writes', () => {
      store.write('a', 1);
      expect(store.values()['a']).toBe(1);
      store.write('a', 2);
      expect(store.values()['a']).toBe(2);
    });
  });

  describe('isDirty', () => {
    it('unset slot is clean', () => {
      expect(store.isDirty('nope')).toBe(false);
    });

    it('null and undefined are clean', () => {
      store.write('a', null);
      store.write('b', undefined);
      expect(store.isDirty('a')).toBe(false);
      expect(store.isDirty('b')).toBe(false);
    });

    it('empty string is clean; non-empty string is dirty', () => {
      store.write('e', '');
      store.write('s', 'x');
      expect(store.isDirty('e')).toBe(false);
      expect(store.isDirty('s')).toBe(true);
    });

    it('boolean: false is clean (default checkbox); true is dirty', () => {
      store.write('f', false);
      store.write('t', true);
      expect(store.isDirty('f')).toBe(false);
      expect(store.isDirty('t')).toBe(true);
    });

    it('numbers — including 0 and NaN — are dirty (real values)', () => {
      store.write('zero', 0);
      store.write('nan', Number.NaN);
      store.write('one', 1);
      expect(store.isDirty('zero')).toBe(true);
      expect(store.isDirty('nan')).toBe(true);
      expect(store.isDirty('one')).toBe(true);
    });

    it('empty array / object / Set / Map are clean', () => {
      store.write('arr', []);
      store.write('obj', {});
      store.write('set', new Set());
      store.write('map', new Map());
      expect(store.isDirty('arr')).toBe(false);
      expect(store.isDirty('obj')).toBe(false);
      expect(store.isDirty('set')).toBe(false);
      expect(store.isDirty('map')).toBe(false);
    });

    it('non-empty array / object / Set / Map are dirty', () => {
      store.write('arr', [1]);
      store.write('obj', { x: 1 });
      store.write('set', new Set([1]));
      store.write('map', new Map([['k', 1]]));
      expect(store.isDirty('arr')).toBe(true);
      expect(store.isDirty('obj')).toBe(true);
      expect(store.isDirty('set')).toBe(true);
      expect(store.isDirty('map')).toBe(true);
    });
  });
});
