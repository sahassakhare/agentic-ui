import { describe, expect, it } from 'vitest';
import { cellMatches, evaluateDecision, opsForType, type DecisionTable } from './decision-eval';

describe('cellMatches — typed comparison', () => {
  it('numbers compare numerically for all operators', () => {
    expect(cellMatches({ op: '>', value: '100' }, 25, 'number')).toBe(false);
    expect(cellMatches({ op: '>', value: '100' }, 250, 'number')).toBe(true);
    expect(cellMatches({ op: '==', value: '5' }, 5, 'number')).toBe(true);
    expect(cellMatches({ op: 'in', value: '1, 2, 3' }, 2, 'number')).toBe(true);
    expect(cellMatches({ op: '>', value: 'x' }, 5, 'number')).toBe(false); // NaN → no match
  });

  it('dates compare chronologically', () => {
    expect(cellMatches({ op: '>=', value: '2026-01-01' }, '2026-06-01', 'date')).toBe(true);
    expect(cellMatches({ op: '<', value: '2026-01-01' }, '2025-12-31', 'date')).toBe(true);
    expect(cellMatches({ op: '>', value: '2026-01-01' }, 'not-a-date', 'date')).toBe(false);
  });

  it('booleans compare truthiness', () => {
    expect(cellMatches({ op: '==', value: 'true' }, true, 'boolean')).toBe(true);
    expect(cellMatches({ op: '==', value: 'true' }, 'yes', 'boolean')).toBe(true);
    expect(cellMatches({ op: '!=', value: 'true' }, false, 'boolean')).toBe(true);
  });

  it('string/undefined keeps the original behavior (back-compat)', () => {
    // string equality + `in`
    expect(cellMatches({ op: '==', value: 'EU' }, 'EU')).toBe(true);
    expect(cellMatches({ op: 'in', value: 'EU, UK' }, 'UK')).toBe(true);
    // `>` on untyped values still coerces numerically (unchanged legacy behavior)
    expect(cellMatches({ op: '>', value: '10' }, 25)).toBe(true);
    expect(cellMatches({ op: '>', value: '10' }, 5)).toBe(false);
  });

  it('treats any / empty value as a match', () => {
    expect(cellMatches({ op: 'any' }, 'whatever', 'number')).toBe(true);
    expect(cellMatches({ op: '==', value: '' }, 'x')).toBe(true);
    expect(cellMatches(undefined, 'x')).toBe(true);
  });
});

describe('opsForType', () => {
  it('restricts operators per type', () => {
    expect(opsForType('boolean')).toEqual(['any', '==', '!=']);
    expect(opsForType('date')).not.toContain('in');
    expect(opsForType('number')).toContain('in');
    expect(opsForType(undefined)).toContain('in'); // string default
  });
});

describe('evaluateDecision — hit policies + typed inputs', () => {
  const table = (hitPolicy: DecisionTable['hitPolicy']): DecisionTable => ({
    hitPolicy,
    inputs: [{ name: 'amount', type: 'number' }, { name: 'region', type: 'string' }],
    outputs: [{ name: 'route' }],
    rules: [
      { when: { amount: { op: '>', value: '10000' } }, then: { route: 'senior' } },
      { when: { region: { op: 'in', value: 'EU, UK' } }, then: { route: 'eu-desk' } },
    ],
  });

  it('first: returns the first match', () => {
    const r = evaluateDecision(table('first'), { amount: 25000, region: 'EU' });
    expect(r.outputs).toEqual({ route: 'senior' });
    expect(r.matchedRules).toEqual([0]);
    expect(r.conflict).toBeFalsy();
  });

  it('unique: flags a conflict when >1 rule matches', () => {
    const r = evaluateDecision(table('unique'), { amount: 25000, region: 'EU' });
    expect(r.conflict).toBe(true);
  });

  it('unique: no conflict when exactly one matches', () => {
    const r = evaluateDecision(table('unique'), { amount: 5, region: 'EU' });
    expect(r.conflict).toBe(false);
    expect(r.outputs).toEqual({ route: 'eu-desk' });
  });

  it('collect: returns all matches', () => {
    const r = evaluateDecision(table('collect'), { amount: 25000, region: 'UK' });
    expect(r.matches).toHaveLength(2);
    expect(r.matchedRules).toEqual([0, 1]);
  });

  it('uses the column type: numeric amount is compared numerically, not lexically', () => {
    // '9' > '10000' lexically, but 9 < 10000 numerically → must NOT match rule 0.
    const r = evaluateDecision(table('first'), { amount: 9, region: 'US' });
    expect(r.outputs).toBeNull();
  });
});
