import { describe, expect, it } from 'vitest';
import { validateWorkflow } from './workflow-validate';
import type { JourneyFlowStep } from '../journey-flow.component';

const step = (id: string, next: JourneyFlowStep['next'], widget = 'w'): JourneyFlowStep => ({ id, widget, section: id, next });

describe('validateWorkflow', () => {
  it('passes a clean linear workflow', () => {
    const issues = validateWorkflow([step('a', 'b'), step('b', null)]);
    expect(issues).toEqual([]);
  });

  it('passes a clean branching workflow', () => {
    const issues = validateWorkflow([
      step('triage', { branches: [{ when: { field: 'p', op: 'truthy' }, goto: 'esc' }], default: 'done' }),
      step('esc', 'done'),
      step('done', null),
    ]);
    expect(issues).toEqual([]);
  });

  it('flags a dangling string next target as an error', () => {
    const issues = validateWorkflow([step('a', 'ghost'), step('b', null)]);
    expect(issues.some((i) => i.level === 'error' && /unknown step/.test(i.message))).toBe(true);
  });

  it('flags a dangling branch goto/default as an error', () => {
    const issues = validateWorkflow([
      step('a', { branches: [{ when: { field: 'x', op: 'truthy' }, goto: 'nope' }], default: 'gone' }),
      step('b', null),
    ]);
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(2);
  });

  it('warns about an unreachable step', () => {
    const issues = validateWorkflow([step('a', null), step('orphan', null)]);
    expect(issues.some((i) => i.level === 'warn' && /unreachable/.test(i.message))).toBe(true);
  });

  it('warns when there is no reachable terminal (loop)', () => {
    const issues = validateWorkflow([step('a', 'b'), step('b', 'a')]);
    expect(issues.some((i) => /never terminates/.test(i.message))).toBe(true);
  });

  it('errors on a missing widget and a duplicate id', () => {
    const issues = validateWorkflow([step('a', null, ''), step('a', null)]);
    expect(issues.some((i) => /no component\/form/.test(i.message))).toBe(true);
    expect(issues.some((i) => /Duplicate step id/.test(i.message))).toBe(true);
  });

  it('returns nothing for an empty workflow', () => {
    expect(validateWorkflow([])).toEqual([]);
  });
});
