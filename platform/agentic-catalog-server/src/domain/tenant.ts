import { z } from 'zod';

/**
 * Tenant lifecycle — platform-level (NOT per-tenant scoped).
 * Only `platform-admin` callers may create / patch / suspend / delete
 * tenants. See [ADR-020](../../../../../docs/adr/0020-tenant-lifecycle.md).
 *
 * The tenant id is the durable handle other catalog tables FK against
 * (`tenant_id` in capabilities, mfe_remotes, role_mappings,
 * usage_events, catalog_audit). It's also what callers put on the
 * `tenant_id` JWT claim. So changing it is forbidden — once minted,
 * the id is the contract.
 */

const TenantIdSchema = z
  .string()
  .min(1, 'tenant id is required')
  .max(120, 'tenant id must be ≤120 chars')
  // Conservative — kebab-case, alphanumeric, dots, underscores. No
  // spaces, no slashes (path-injection risk on /v1/catalogs/{tenant}/*).
  .regex(/^[a-zA-Z0-9_.-]+$/, 'tenant id must match [a-zA-Z0-9_.-]+');

const DisplayNameSchema = z
  .string()
  .min(1, 'display name is required')
  .max(200, 'display name must be ≤200 chars');

const TenantStatusSchema = z.enum(['active', 'suspended', 'deleted']);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

/**
 * Quota knobs. All fields are optional — operators set only what
 * they want to enforce. Hosts read these via the catalog client and
 * make policy decisions (rate-limit, hard-cap, alert) at their own
 * boundary. The catalog server records but does not enforce; quota
 * enforcement is host policy. See ADR-020 D4.
 */
export const TenantQuotaSchema = z.object({
  /** Per-month token budget (LLM tokens, summed). */
  monthlyTokens: z.number().int().nonnegative().optional(),
  /** Per-month tool-invocation count. */
  monthlyToolInvocations: z.number().int().nonnegative().optional(),
  /** Maximum number of capabilities (any kind) the tenant may register. */
  maxCapabilities: z.number().int().nonnegative().optional(),
  /** Maximum MFE remotes the tenant may register. */
  maxMfeRemotes: z.number().int().nonnegative().optional(),
}).passthrough();
export type TenantQuota = z.infer<typeof TenantQuotaSchema>;

export const TenantSchema = z.object({
  id: TenantIdSchema,
  displayName: DisplayNameSchema,
  status: TenantStatusSchema,
  quotas: TenantQuotaSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  onboardedAt: z.string().datetime().nullable(),
  onboardedBy: z.string().nullable(),
  suspendedAt: z.string().datetime().nullable(),
  suspendedBy: z.string().nullable(),
  suspendedReason: z.string().nullable(),
  deletedAt: z.string().datetime().nullable(),
});
export type Tenant = z.infer<typeof TenantSchema>;

export const TenantCreateSchema = z.object({
  id: TenantIdSchema,
  displayName: DisplayNameSchema,
  quotas: TenantQuotaSchema.default({}),
});
export type TenantCreate = z.infer<typeof TenantCreateSchema>;

/**
 * Patch shape. `id` is **immutable** (FK target) — operators rename
 * by clone-and-deprecate, not in-place rename. `status` transitions
 * go through dedicated endpoints (`POST /:id/suspend`,
 * `POST /:id/activate`) so the lifecycle audit shows reason +
 * actor, which a generic PATCH would muddle.
 */
export const TenantUpdateSchema = z.object({
  displayName: DisplayNameSchema.optional(),
  quotas: TenantQuotaSchema.optional(),
});
export type TenantUpdate = z.infer<typeof TenantUpdateSchema>;

export const TenantSuspendSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type TenantSuspend = z.infer<typeof TenantSuspendSchema>;
