import type { ApprovalEvent, TemplateApprovalState } from './types';

/**
 * ADR-046 D6 — pure-function state machine for template approval.
 * Encapsulates the legal transitions so registries can validate
 * actions without scattering business rules across consumers.
 *
 * Workflow diagram (per ADR-046 D6):
 *
 *   draft  ─submit─►  review  ─approve─►  approved
 *                       │
 *                       └─reject─►  rejected
 *
 *   * ─deprecate─►  deprecated
 *   approved ─revoke─►  draft  (admin override)
 *
 * All other transitions throw `ApprovalTransitionError`.
 */

export class ApprovalTransitionError extends Error {
  constructor(
    public readonly from: TemplateApprovalState,
    public readonly to: TemplateApprovalState,
    public readonly action: ApprovalEvent['action'],
  ) {
    super(
      `[ApprovalWorkflow] illegal transition: ${from} --${action}--> ${to}. ` +
      `See ADR-046 D6 for the legal state machine.`,
    );
    this.name = 'ApprovalTransitionError';
  }
}

/** Computes the target state for a given action + current state. */
export function nextState(
  current: TemplateApprovalState,
  action: ApprovalEvent['action'],
): TemplateApprovalState {
  // Deprecate is universal — any state can deprecate.
  if (action === 'deprecate') return 'deprecated';
  // Revoke is admin-only — from approved back to draft for a re-cycle.
  if (action === 'revoke') {
    if (current !== 'approved') {
      throw new ApprovalTransitionError(current, 'draft', action);
    }
    return 'draft';
  }
  switch (current) {
    case 'draft':
      if (action === 'submit') return 'review';
      break;
    case 'review':
      if (action === 'approve') return 'approved';
      if (action === 'reject') return 'rejected';
      break;
    case 'rejected':
      if (action === 'submit') return 'review';  // resubmit
      break;
    case 'approved':
    case 'deprecated':
    default:
      break;
  }
  throw new ApprovalTransitionError(current, 'draft', action);
}

/** Quick predicate: is the transition legal? Doesn't throw. */
export function canTransition(
  current: TemplateApprovalState,
  action: ApprovalEvent['action'],
): boolean {
  try {
    nextState(current, action);
    return true;
  } catch {
    return false;
  }
}
