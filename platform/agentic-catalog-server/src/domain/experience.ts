import { z } from 'zod';

/**
 * Experience catalog domain (AEP Seam F). Mirrors the runtime
 * `ExperienceDef` (projects/agentic-ui/src/lib/experience). The catalog
 * stores business-intent Experiences — a goal plus declared capability
 * requirements — decoupled from implementation. Catalog metadata (id,
 * approval state, audit timestamps, soft-delete) lives in dedicated
 * columns; the ExperienceDef payload lives in `body` JSONB.
 */

export const ExperienceNameSchema = z
  .string()
  .min(1, 'name is required')
  .max(120, 'name must be ≤120 chars')
  .regex(/^[A-Za-z0-9_./:@-]+$/, 'name must match [A-Za-z0-9_./:@-]+');

/** Approval workflow states — mirrors ADR-046 D6 / the runtime template catalog. */
export const ApprovalStateSchema = z.enum(['draft', 'review', 'approved', 'rejected', 'deprecated']);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

/** A capability requirement declared by an experience (Seam A). */
export const CapabilityRequirementSchema = z.object({
  kind: z.string().min(1).max(60),
  name: z.string().max(120).optional(),
  tag: z.string().max(60).optional(),
  optional: z.boolean().optional(),
  reason: z.string().max(280).optional(),
});
export type CapabilityRequirement = z.infer<typeof CapabilityRequirementSchema>;

/** One entry in an experience's approval chain (audit). */
export const ApprovalEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  actor: z.object({ userId: z.string(), displayName: z.string().optional() }),
  action: z.enum(['submit', 'approve', 'reject', 'deprecate', 'revoke']),
  fromState: ApprovalStateSchema,
  toState: ApprovalStateSchema,
  comment: z.string().max(1000).optional(),
});
export type ApprovalEvent = z.infer<typeof ApprovalEventSchema>;
export type ApprovalAction = ApprovalEvent['action'];

/** The ExperienceDef payload stored in `body`. */
export const ExperienceBodySchema = z.object({
  intents: z.array(z.string().max(120)).max(64).optional(),
  requires: z.array(CapabilityRequirementSchema).max(128).optional(),
  produces: z.array(z.string().max(120)).max(64).optional(),
  defaultLayout: z.string().max(120).optional(),
  policies: z.array(z.string().max(200)).max(64).optional(),
  personas: z.array(z.string().max(120)).max(64).optional(),
  scopes: z.array(z.string().max(120)).max(64).optional(),
});
export type ExperienceBody = z.infer<typeof ExperienceBodySchema>;

/** Full experience shape as stored + returned. */
export const ExperienceSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1).max(120),
  name: ExperienceNameSchema,
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(2000),
  body: ExperienceBodySchema,
  approvalState: ApprovalStateSchema,
  approvalChain: z.array(ApprovalEventSchema),
  owner: z.string().max(120).nullable(),
  tags: z.array(z.string().max(60)).max(32),
  version: z.string().max(40).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().min(1).max(120),
  softDeletedAt: z.string().datetime().nullable(),
});
export type Experience = z.infer<typeof ExperienceSchema>;

/** Inputs to `POST …/experiences`. */
export const ExperienceCreateSchema = z.object({
  name: ExperienceNameSchema,
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(2000),
  body: ExperienceBodySchema.default({}),
  approvalState: ApprovalStateSchema.default('draft'),
  owner: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(60)).max(32).default([]),
  version: z.string().max(40).nullable().optional(),
});
export type ExperienceCreate = z.infer<typeof ExperienceCreateSchema>;

/** Inputs to `PATCH …/experiences/{id}`. `name` is immutable post-create. */
export const ExperienceUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  goal: z.string().min(1).max(2000).optional(),
  body: ExperienceBodySchema.optional(),
  owner: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(60)).max(32).optional(),
  version: z.string().max(40).nullable().optional(),
});
export type ExperienceUpdate = z.infer<typeof ExperienceUpdateSchema>;

/** Inputs to `POST …/experiences/{id}/transition`. */
export const ExperienceTransitionSchema = z.object({
  action: z.enum(['submit', 'approve', 'reject', 'deprecate', 'revoke']),
  comment: z.string().max(1000).optional(),
});
export type ExperienceTransition = z.infer<typeof ExperienceTransitionSchema>;

/** Filter params for `GET …/experiences`. */
export const ExperienceListQuerySchema = z.object({
  approvalState: ApprovalStateSchema.optional(),
  owner: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(), // free-text on name / title
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  includeDeleted: z.coerce.boolean().default(false),
});
export type ExperienceListQuery = z.infer<typeof ExperienceListQuerySchema>;

/**
 * Server-side copy of the approval state machine (ADR-046 D6). Kept in
 * sync with `projects/agentic-ui/src/lib/layout/templates/approval-workflow.ts`.
 * Throws {@link ApprovalTransitionError} on an illegal transition.
 */
export class ApprovalTransitionError extends Error {
  constructor(
    public readonly from: ApprovalState,
    public readonly action: ApprovalAction,
  ) {
    super(`[ExperienceApproval] illegal transition: ${from} --${action}-->. See ADR-046 D6.`);
    this.name = 'ApprovalTransitionError';
  }
}

export function nextApprovalState(current: ApprovalState, action: ApprovalAction): ApprovalState {
  if (action === 'deprecate') return 'deprecated';
  if (action === 'revoke') {
    if (current !== 'approved') throw new ApprovalTransitionError(current, action);
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
      if (action === 'submit') return 'review';
      break;
  }
  throw new ApprovalTransitionError(current, action);
}
