import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { agenticApproval } from '../factories/agentic-approval';
import type { Approval } from '../types/registry-defs';
import { ApprovalRegistry } from './approval-registry';

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: overrides.id ?? 'appr-1',
    toolName: overrides.toolName ?? 'exportProductionSet',
    args: overrides.args ?? { productionId: 'PROD-001' },
    requesterPersona: overrides.requesterPersona ?? 'paralegal',
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? '2026-05-07T00:00:00.000Z',
    signoffMessage: overrides.signoffMessage ?? 'Approve delivery?',
    ...overrides,
  };
}

describe('ApprovalRegistry (Capability F4)', () => {
  let registry: ApprovalRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ApprovalRegistry);
    registry.clearApprovals();
  });

  describe('policy registration (RegistryBase)', () => {
    it('registers and looks up policies by tool name', () => {
      registry.register(
        agenticApproval({
          tool: 'exportProductionSet',
          required: () => true,
          approverRoles: ['lead-counsel'],
          diffRenderer: 'diff-widget',
          signoffMessage: () => 'go?',
        }),
      );
      const def = registry.get('exportProductionSet');
      expect(def).toBeDefined();
      expect(def?.approverRoles).toEqual(['lead-counsel']);
    });
  });

  describe('enqueue / getApproval / byStatus', () => {
    it('enqueues a pending approval', () => {
      const a = makeApproval();
      registry.enqueue(a);
      expect(registry.getApproval('appr-1')).toEqual(a);
      expect(registry.byStatus('pending')).toEqual([a]);
    });

    it('throws on enqueue with a non-pending status', () => {
      expect(() =>
        registry.enqueue(makeApproval({ status: 'approved' })),
      ).toThrow(/requires status='pending'/);
    });

    it('throws on duplicate id', () => {
      registry.enqueue(makeApproval());
      expect(() => registry.enqueue(makeApproval())).toThrow(/already enqueued/);
    });

    it('byStatus filters and orders by createdAt', () => {
      registry.enqueue(makeApproval({ id: 'b', createdAt: '2026-05-07T00:00:02.000Z' }));
      registry.enqueue(makeApproval({ id: 'a', createdAt: '2026-05-07T00:00:01.000Z' }));
      expect(registry.byStatus('pending').map((a) => a.id)).toEqual(['a', 'b']);
    });
  });

  describe('pendingForApprover', () => {
    it('returns only approvals whose policy lists the persona in approverRoles', () => {
      registry.register(
        agenticApproval({
          tool: 'exportProductionSet',
          required: () => true,
          approverRoles: ['lead-counsel'],
          diffRenderer: 'diff',
          signoffMessage: () => 'go?',
        }),
      );
      registry.register(
        agenticApproval({
          tool: 'releaseLegalHold',
          required: () => true,
          approverRoles: ['associate', 'lead-counsel'],
          diffRenderer: 'diff',
          signoffMessage: () => 'release?',
        }),
      );
      registry.enqueue(makeApproval({ id: 'export-1', toolName: 'exportProductionSet' }));
      registry.enqueue(makeApproval({ id: 'release-1', toolName: 'releaseLegalHold' }));

      expect(registry.pendingForApprover('paralegal').map((a) => a.id)).toEqual([]);
      expect(
        registry.pendingForApprover('associate').map((a) => a.id),
      ).toEqual(['release-1']);
      expect(
        registry.pendingForApprover('lead-counsel').map((a) => a.id).sort(),
      ).toEqual(['export-1', 'release-1']);
    });

    it('skips approvals whose policy is no longer registered', () => {
      registry.enqueue(makeApproval());
      // No policy registered → no approvers can act on this approval.
      expect(registry.pendingForApprover('lead-counsel')).toEqual([]);
    });
  });

  describe('transition', () => {
    beforeEach(() => {
      registry.enqueue(makeApproval());
    });

    it('transitions pending → approved with approverPersona + decidedAt', () => {
      const updated = registry.transition('appr-1', 'approved', {
        approverPersona: 'lead-counsel',
        decidedAt: '2026-05-07T00:01:00.000Z',
      });
      expect(updated.status).toBe('approved');
      expect(updated.approverPersona).toBe('lead-counsel');
      expect(updated.decidedAt).toBe('2026-05-07T00:01:00.000Z');
    });

    it('transitions pending → rejected with comment', () => {
      const updated = registry.transition('appr-1', 'rejected', {
        approverPersona: 'lead-counsel',
        comment: 'scope too broad',
      });
      expect(updated.status).toBe('rejected');
      expect(updated.comment).toBe('scope too broad');
    });

    it('throws when transitioning an unknown approval', () => {
      expect(() =>
        registry.transition('nope', 'approved', { approverPersona: 'x' }),
      ).toThrow(/not found/);
    });

    it('throws when transitioning an already-decided approval', () => {
      registry.transition('appr-1', 'approved', { approverPersona: 'lead-counsel' });
      expect(() =>
        registry.transition('appr-1', 'rejected', { approverPersona: 'lead-counsel' }),
      ).toThrow(/already approved/);
    });
  });
});
