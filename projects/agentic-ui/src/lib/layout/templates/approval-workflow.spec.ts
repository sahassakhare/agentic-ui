import { describe, expect, it } from 'vitest';
import {
  ApprovalTransitionError,
  canTransition,
  nextState,
} from './approval-workflow';

describe('approval workflow state machine', () => {
  describe('legal transitions', () => {
    it('draft -> review via submit', () => {
      expect(nextState('draft', 'submit')).toBe('review');
    });
    it('review -> approved via approve', () => {
      expect(nextState('review', 'approve')).toBe('approved');
    });
    it('review -> rejected via reject', () => {
      expect(nextState('review', 'reject')).toBe('rejected');
    });
    it('rejected -> review via resubmit', () => {
      expect(nextState('rejected', 'submit')).toBe('review');
    });
    it('any state -> deprecated via deprecate', () => {
      for (const state of ['draft', 'review', 'approved', 'rejected', 'deprecated'] as const) {
        expect(nextState(state, 'deprecate')).toBe('deprecated');
      }
    });
    it('approved -> draft via revoke (admin override)', () => {
      expect(nextState('approved', 'revoke')).toBe('draft');
    });
  });

  describe('illegal transitions throw', () => {
    it('draft -> approved directly fails (must submit first)', () => {
      expect(() => nextState('draft', 'approve')).toThrow(ApprovalTransitionError);
    });
    it('approved cannot be approved again', () => {
      expect(() => nextState('approved', 'approve')).toThrow(ApprovalTransitionError);
    });
    it('draft cannot be revoked', () => {
      expect(() => nextState('draft', 'revoke')).toThrow(ApprovalTransitionError);
    });
    it('rejected cannot be approved directly (must resubmit)', () => {
      expect(() => nextState('rejected', 'approve')).toThrow(ApprovalTransitionError);
    });
  });

  describe('canTransition predicate matches state-machine outcomes', () => {
    it('returns true for legal transitions, false for illegal', () => {
      expect(canTransition('draft', 'submit')).toBe(true);
      expect(canTransition('draft', 'approve')).toBe(false);
      expect(canTransition('approved', 'revoke')).toBe(true);
      expect(canTransition('rejected', 'approve')).toBe(false);
    });
  });
});
