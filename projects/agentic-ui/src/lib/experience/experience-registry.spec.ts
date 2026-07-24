import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { ExperienceRegistry, type ExperienceDef } from './experience-registry';
import { ApprovalTransitionError } from '../layout/templates/approval-workflow';

const actor = { userId: 'u1', displayName: 'Reviewer' };

function experience(name: string, extra: Partial<ExperienceDef> = {}): ExperienceDef {
  return { name, title: name, goal: `accomplish ${name}`, ...extra };
}

describe('ExperienceRegistry (AEP Seam C)', () => {
  let reg: ExperienceRegistry;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    reg = TestBed.inject(ExperienceRegistry);
  });

  it('registers an experience with requires + defaults to draft', () => {
    reg.register(experience('legalIntake', {
      requires: [{ kind: 'form', name: 'customerSearch' }],
      intents: ['create matter'],
    }));
    expect(reg.get('legalIntake')?.requires).toEqual([{ kind: 'form', name: 'customerSearch' }]);
    expect(reg.stateOf('legalIntake')).toBe('draft');
    expect(reg.approved()).toEqual([]);
  });

  it('drives draft → review → approved and surfaces in approved()', () => {
    reg.register(experience('legalIntake'));
    reg.transition('legalIntake', 'submit', { actor });
    expect(reg.stateOf('legalIntake')).toBe('review');
    expect(reg.pendingReview().map((e) => e.name)).toEqual(['legalIntake']);

    reg.transition('legalIntake', 'approve', { actor, comment: 'looks good' });
    expect(reg.stateOf('legalIntake')).toBe('approved');
    expect(reg.approved().map((e) => e.name)).toEqual(['legalIntake']);

    const chain = reg.approvalChain('legalIntake');
    expect(chain.map((c) => c.action)).toEqual(['submit', 'approve']);
    expect(chain[1].comment).toBe('looks good');
  });

  it('rejects an illegal transition', () => {
    reg.register(experience('legalIntake'));
    // approve straight from draft is illegal
    expect(() => reg.transition('legalIntake', 'approve', { actor })).toThrow(ApprovalTransitionError);
  });

  it('throws for an unknown experience', () => {
    expect(() => reg.transition('ghost', 'submit', { actor })).toThrow(/not registered/);
  });

  it('honors an initial approvalState hint', () => {
    reg.register(experience('preApproved', { approvalState: 'approved' }));
    expect(reg.stateOf('preApproved')).toBe('approved');
    expect(reg.approved().map((e) => e.name)).toEqual(['preApproved']);
  });

  it('removeBySource drops the experience from approved()', () => {
    reg.register(experience('remoteExp', { source: 'remote:legal', approvalState: 'approved' }));
    expect(reg.approved().map((e) => e.name)).toEqual(['remoteExp']);
    reg.removeBySource('remote:legal');
    expect(reg.approved()).toEqual([]);
  });

  it('removeBySource prunes the approval overlay (no stale state / leak)', () => {
    reg.register(experience('remoteExp', { source: 'remote:legal' }));
    reg.transition('remoteExp', 'submit', { actor });
    expect(reg.stateOf('remoteExp')).toBe('review');
    reg.removeBySource('remote:legal');
    // Overlay pruned → back to the default, not the stale 'review'.
    expect(reg.stateOf('remoteExp')).toBe('draft');
    expect(reg.approvalChain('remoteExp')).toEqual([]);
  });

  it('a dropped first-wins re-registration does NOT corrupt the live approval state', () => {
    // Approve the original.
    reg.register(experience('exp', { approvalState: 'approved' }));
    expect(reg.stateOf('exp')).toBe('approved');
    // A federated remote re-registers the same name under first-wins → its def
    // is dropped; the live 'approved' state must survive (the H2 defect).
    reg.conflictPolicy = 'first-wins';
    reg.register(experience('exp', { source: 'remote:evil', approvalState: 'draft' }));
    expect(reg.stateOf('exp')).toBe('approved');
    expect(reg.approved().map((e) => e.name)).toEqual(['exp']);
  });

  it('transition still works after a replace re-registration', () => {
    reg.register(experience('exp'));
    reg.transition('exp', 'submit', { actor });
    expect(reg.stateOf('exp')).toBe('review');
  });
});
