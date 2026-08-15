import { describe, it, expect } from 'vitest';
import { resolveNext, evalWorkflowCondition, isConditionalNext } from './resolve-next';
import type { ConditionalNext } from '../types/registry-defs';

/**
 * Conditional-branch workflow transitions (gap B3). `resolveNext` is the single
 * place the renderer consults, so all four `next` forms must behave identically.
 */
describe('resolveNext', () => {
  it('advances unconditionally on a string', () => {
    expect(resolveNext('review', {})).toBe('review');
  });
  it('is terminal on null', () => {
    expect(resolveNext(null, {})).toBeNull();
  });
  it('branches via a (state)=>… function', () => {
    const fn = (s: Record<string, unknown>) => (s['flagged'] ? 'fraud' : 'review');
    expect(resolveNext(fn, { flagged: true })).toBe('fraud');
    expect(resolveNext(fn, { flagged: false })).toBe('review');
  });

  const branching: ConditionalNext = {
    branches: [
      { when: { field: 'priority', op: '==', value: 'high' }, goto: 'escalation' },
      { when: { field: 'category', op: 'in', value: ['fraud', 'legal'] }, goto: 'compliance' },
    ],
    default: 'review',
  };

  it('takes the first matching declarative branch', () => {
    expect(resolveNext(branching, { priority: 'high' })).toBe('escalation');
    expect(resolveNext(branching, { category: 'fraud' })).toBe('compliance');
  });
  it('falls through to default when no branch matches', () => {
    expect(resolveNext(branching, { priority: 'low', category: 'travel' })).toBe('review');
  });
  it('a null default is terminal', () => {
    expect(resolveNext({ branches: [{ when: { field: 'x', op: 'truthy' }, goto: 'a' }], default: null }, { x: 0 })).toBeNull();
  });
});

describe('evalWorkflowCondition', () => {
  it('handles ==, !=, in, truthy, falsy', () => {
    expect(evalWorkflowCondition({ field: 'a', op: '==', value: 1 }, { a: 1 })).toBe(true);
    expect(evalWorkflowCondition({ field: 'a', op: '!=', value: 1 }, { a: 2 })).toBe(true);
    expect(evalWorkflowCondition({ field: 'a', op: 'in', value: [1, 2] }, { a: 2 })).toBe(true);
    expect(evalWorkflowCondition({ field: 'a', op: 'truthy' }, { a: 'x' })).toBe(true);
    expect(evalWorkflowCondition({ field: 'a', op: 'falsy' }, { a: '' })).toBe(true);
  });
});

describe('isConditionalNext', () => {
  it('detects the declarative form only', () => {
    expect(isConditionalNext({ branches: [], default: null })).toBe(true);
    expect(isConditionalNext('review')).toBe(false);
    expect(isConditionalNext(null)).toBe(false);
    expect(isConditionalNext(() => null)).toBe(false);
  });
});
