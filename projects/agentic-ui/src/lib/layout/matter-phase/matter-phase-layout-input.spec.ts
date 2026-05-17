import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MatterPhaseLayoutInput } from './matter-phase-layout-input';
import {
  ACTIVE_MATTER_PHASE_SIGNAL,
  MATTER_PHASE_LAYOUT_RULES,
  type MatterPhaseLayoutRule,
} from './types';

function setup(rules: readonly MatterPhaseLayoutRule[], phase: string | null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: MATTER_PHASE_LAYOUT_RULES, useValue: rules },
      { provide: ACTIVE_MATTER_PHASE_SIGNAL, useValue: signal<string | null>(phase).asReadonly() },
    ],
  });
  return TestBed.inject(MatterPhaseLayoutInput);
}

describe('MatterPhaseLayoutInput', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('returns no rules when no phase is set', () => {
    const input = setup([{ phase: 'review', slots: {} }], null);
    expect(input.evaluate()).toEqual([]);
  });

  it('fires rules whose `phase` matches', () => {
    const input = setup(
      [
        { phase: 'review',     slots: { primary: { component: 'reviewQueue' } } },
        { phase: 'production', slots: { primary: { component: 'productionThroughput' } } },
      ],
      'review',
    );
    const rules = input.evaluate();
    expect(rules).toHaveLength(1);
    expect(rules[0].slots).toEqual({ primary: { component: 'reviewQueue' } });
  });

  it('skips rules with non-matching phase', () => {
    const input = setup(
      [{ phase: 'collection', slots: { primary: { component: 'intake' } } }],
      'review',
    );
    expect(input.evaluate()).toEqual([]);
  });

  it('emits source = "matter-phase" and a deterministic id', () => {
    const input = setup(
      [{ phase: 'review', slots: { sidebar: { component: 'privilege' } } }],
      'review',
    );
    const [rule] = input.evaluate();
    expect(rule.source).toBe('matter-phase');
    expect(rule.id).toBe('matter-phase:review#0');
  });

  it('respects priority + reason fields', () => {
    const input = setup(
      [{
        phase: 'review',
        slots: { primary: { component: 'x' } },
        priority: 5,
        reason: 'custom reason',
      }],
      'review',
    );
    const [rule] = input.evaluate();
    expect(rule.priority).toBe(5);
    expect(rule.reason).toBe('custom reason');
  });

  it('propagates evictSlots', () => {
    const input = setup(
      [{ phase: 'production', slots: {}, evictSlots: ['footer'] }],
      'production',
    );
    const [rule] = input.evaluate();
    expect(rule.evictSlots).toEqual(['footer']);
  });
});
