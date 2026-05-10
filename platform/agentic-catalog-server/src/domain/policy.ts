import { z } from 'zod';

/**
 * Policy bundle storage + decision request/response shapes for the
 * OPA integration. Slice OPA-A / ADR-040.
 *
 * The catalog stores rego bundles. An OPA sidecar (configured via
 * `OPA_URL` env) does the actual evaluation. The catalog forwards
 * decision requests to OPA's standard `POST /v1/data/{rule_path}`
 * endpoint and returns the result.
 */

const NameSchema = z
  .string()
  .min(1, 'name is required')
  .max(120, 'name must be ≤120 chars')
  .regex(/^[A-Za-z0-9_./-]+$/, 'name must match [A-Za-z0-9_./-]+');

const RulePathSchema = z
  .string()
  .min(1)
  .max(200)
  // OPA rule paths: dotted segments, optionally separated by /
  .regex(/^[A-Za-z0-9_./]+$/, 'rule_path must match [A-Za-z0-9_./]+');

export const PolicyBundleCreateSchema = z.object({
  name: NameSchema,
  regoSource: z.string().min(1, 'regoSource is required').max(1_000_000, 'regoSource exceeds 1MB cap'),
  description: z.string().max(2000).optional(),
  rulePath: RulePathSchema.optional(),
  isActive: z.boolean().optional(),
});
export type PolicyBundleCreate = z.infer<typeof PolicyBundleCreateSchema>;

export const PolicyBundleUpdateSchema = z.object({
  regoSource: z.string().min(1).max(1_000_000).optional(),
  description: z.string().max(2000).optional(),
  rulePath: RulePathSchema.optional(),
  isActive: z.boolean().optional(),
});
export type PolicyBundleUpdate = z.infer<typeof PolicyBundleUpdateSchema>;

export const PolicyBundleSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  name: z.string(),
  regoSource: z.string(),
  description: z.string().nullable(),
  rulePath: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string(),
});
export type PolicyBundle = z.infer<typeof PolicyBundleSchema>;

/**
 * Decision request — matches the standard OPA input envelope shape
 * (`{ input: { subject, resource, action, ... } }`). The catalog
 * forwards this verbatim under `input` to OPA.
 */
export const PolicyDecisionRequestSchema = z.object({
  subject: z.record(z.unknown()).optional(),
  resource: z.record(z.unknown()).optional(),
  action: z.string().optional(),
}).passthrough();
export type PolicyDecisionRequest = z.infer<typeof PolicyDecisionRequestSchema>;

/**
 * Decision response. OPA returns `{ result: <rule output> }`. The
 * catalog interprets the rule output: if it's `{ allow: true, ...
 * }` we surface those fields; otherwise we wrap as `{ allow:
 * <truthy>, raw: <result> }` so callers always get an `allow` flag.
 */
export interface PolicyDecisionResponse {
  readonly allow: boolean;
  readonly reason?: string;
  readonly obligations?: Record<string, unknown>;
  /** Echoed bundle name for traceability. */
  readonly bundle: string | null;
  /** Echoed rule path for traceability. */
  readonly rulePath: string | null;
  /** OPA's full `{result: ...}` payload, for debugging. */
  readonly raw?: unknown;
}
