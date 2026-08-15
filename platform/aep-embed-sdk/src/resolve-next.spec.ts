import { describe, expect, it } from 'vitest';
import { evalWorkflowCondition, isConditionalNext, resolveNext, stepById } from './resolve-next.js';
import type { WorkflowStepJson } from './types.js';

describe('resolveNext', () => {
  it('returns a string target unchanged', () => {
    expect(resolveNext('review', {})).toBe('review');
  });

  it('returns null for a terminal step', () => {
    expect(resolveNext(null, {})).toBeNull();
  });

  it('picks the first matching branch', () => {
    const next: WorkflowStepJson['next'] = {
      branches: [
        { when: { field: 'priority', op: '==', value: 'high' }, goto: 'escalate' },
        { when: { field: 'category', op: 'in', value: ['fraud', 'legal'] }, goto: 'compliance' },
      ],
      default: 'review',
    };
    expect(resolveNext(next, { priority: 'high' })).toBe('escalate');
    expect(resolveNext(next, { category: 'legal' })).toBe('compliance');
  });

  it('falls through to default when no branch matches', () => {
    const next: WorkflowStepJson['next'] = {
      branches: [{ when: { field: 'priority', op: '==', value: 'high' }, goto: 'escalate' }],
      default: 'review',
    };
    expect(resolveNext(next, { priority: 'low' })).toBe('review');
  });

  it('default can be null (terminal on no-match)', () => {
    expect(resolveNext({ branches: [], default: null }, {})).toBeNull();
  });
});

describe('evalWorkflowCondition', () => {
  it('evaluates each operator', () => {
    expect(evalWorkflowCondition({ field: 'a', op: '==', value: 1 }, { a: 1 })).toBe(true);
    expect(evalWorkflowCondition({ field: 'a', op: '!=', value: 1 }, { a: 2 })).toBe(true);
    expect(evalWorkflowCondition({ field: 'a', op: 'in', value: [1, 2] }, { a: 2 })).toBe(true);
    expect(evalWorkflowCondition({ field: 'a', op: 'truthy' }, { a: 'x' })).toBe(true);
    expect(evalWorkflowCondition({ field: 'a', op: 'falsy' }, { a: '' })).toBe(true);
    expect(evalWorkflowCondition({ field: 'a', op: 'in', value: 'notarray' }, { a: 1 })).toBe(false);
  });
});

describe('isConditionalNext / stepById', () => {
  it('detects the conditional form', () => {
    expect(isConditionalNext({ branches: [], default: null })).toBe(true);
    expect(isConditionalNext('x')).toBe(false);
    expect(isConditionalNext(null)).toBe(false);
  });

  it('finds a step by id', () => {
    const steps: WorkflowStepJson[] = [
      { id: 's1', widget: 'w', next: 's2' },
      { id: 's2', widget: 'w', next: null },
    ];
    expect(stepById(steps, 's2')?.widget).toBe('w');
    expect(stepById(steps, 'ghost')).toBeUndefined();
  });
});
