import { describe, it, expect } from 'vitest';
import { resolveNext, resolveNextAsync, evalWorkflowCondition, isConditionalNext, isDecisionNext } from './resolve-next';
import type { ConditionalNext, DecisionNext } from '../types/registry-defs';
import type { DecisionEvaluator } from './decision-evaluator';

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

describe('isDecisionNext', () => {
  it('detects the decision-branch form only', () => {
    expect(isDecisionNext({ decision: 'route', cases: {}, default: null })).toBe(true);
    expect(isDecisionNext({ branches: [], default: null })).toBe(false);
    expect(isDecisionNext('review')).toBe(false);
    expect(isDecisionNext(null)).toBe(false);
  });
});

describe('resolveNextAsync — DecisionNext', () => {
  const dn: DecisionNext = {
    decision: 'route-approval',
    output: 'route',
    cases: { 'senior-review': 'escalation', 'auto-approve': 'done' },
    default: 'manual',
  };
  // Evaluator that echoes a fixed route based on the state's amount.
  const evaluator: DecisionEvaluator = {
    evaluate: async (name, input) =>
      name === 'route-approval'
        ? { route: Number(input['amount']) > 10000 ? 'senior-review' : 'auto-approve' }
        : null,
  };

  it('maps a decision output value to its case step', async () => {
    expect(await resolveNextAsync(dn, { amount: 25000 }, evaluator)).toBe('escalation');
    expect(await resolveNextAsync(dn, { amount: 100 }, evaluator)).toBe('done');
  });
  it('falls back to default when the output has no case', async () => {
    const other: DecisionEvaluator = { evaluate: async () => ({ route: 'unknown-value' }) };
    expect(await resolveNextAsync(dn, {}, other)).toBe('manual');
  });
  it('falls back to default when the decision does not evaluate', async () => {
    const none: DecisionEvaluator = { evaluate: async () => null };
    expect(await resolveNextAsync(dn, {}, none)).toBe('manual');
  });
  it('uses the first output when no output key is named', async () => {
    const noKey: DecisionNext = { decision: 'x', cases: { yes: 'a' }, default: 'b' };
    const ev: DecisionEvaluator = { evaluate: async () => ({ result: 'yes' }) };
    expect(await resolveNextAsync(noKey, {}, ev)).toBe('a');
  });
  it('delegates non-decision forms to the sync resolver', async () => {
    const ev: DecisionEvaluator = { evaluate: async () => null };
    expect(await resolveNextAsync('review', {}, ev)).toBe('review');
    expect(await resolveNextAsync(null, {}, ev)).toBeNull();
  });
});
