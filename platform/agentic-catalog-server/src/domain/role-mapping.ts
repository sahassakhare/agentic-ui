import { z } from 'zod';

/**
 * IdP-claim → runtime-persona mapping. Per-tenant, RLS-isolated.
 * Resolution flow ([ADR-016](../../../../docs/adr/0016-iam-role-mapping.md)):
 *
 * 1. Runtime adapter extracts claims from the user's JWT (typically
 *    a `groups` array).
 * 2. Adapter sends `POST /v1/catalogs/{tenant}/role-mappings/resolve`
 *    with the claim values.
 * 3. Catalog server matches against `role_mappings`, returns the
 *    highest-priority `runtime_persona` (ties broken by created_at).
 * 4. Adapter sets `AGENTIC_ACTIVE_PERSONA` to the resolved value.
 */

/**
 * Persona identifier — non-empty, ASCII-only-by-convention. Typical
 * values are short kebab-case strings (`lead-counsel`, `paralegal`).
 */
const PersonaIdSchema = z
  .string()
  .min(1, 'runtime_persona is required')
  .max(120, 'runtime_persona must be ≤120 chars');

/**
 * Claim-path identifier — typically `groups` but can be a dotted
 * path like `https://my.domain/claims.groups` (Auth0 namespaced
 * claims). Server-side resolution does *not* deeply traverse JSON
 * structure today; the path is matched literally against a single
 * top-level claim. Nested-path support is a v0.2 extension.
 */
const ClaimPathSchema = z
  .string()
  .min(1, 'claim_path is required')
  .max(200, 'claim_path must be ≤200 chars');

const ClaimValueSchema = z
  .string()
  .min(1, 'claim_value is required')
  .max(400, 'claim_value must be ≤400 chars');

export const RoleMappingSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1).max(120),
  claimPath: ClaimPathSchema,
  claimValue: ClaimValueSchema,
  runtimePersona: PersonaIdSchema,
  priority: z.number().int().min(0).max(10_000),
  enabled: z.boolean(),
  description: z.string().max(500).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().min(1).max(120),
});
export type RoleMapping = z.infer<typeof RoleMappingSchema>;

export const RoleMappingCreateSchema = z.object({
  claimPath: ClaimPathSchema.default('groups'),
  claimValue: ClaimValueSchema,
  runtimePersona: PersonaIdSchema,
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true),
  description: z.string().max(500).nullable().optional(),
});
export type RoleMappingCreate = z.infer<typeof RoleMappingCreateSchema>;

export const RoleMappingUpdateSchema = z.object({
  runtimePersona: PersonaIdSchema.optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(500).nullable().optional(),
});
export type RoleMappingUpdate = z.infer<typeof RoleMappingUpdateSchema>;

/**
 * Resolution request. Runtime adapter posts this with the claim
 * values it pulled from the JWT.
 */
export const ResolveRequestSchema = z.object({
  /**
   * Claim path to resolve against. Defaults to `'groups'`. Must
   * match an existing `role_mapping.claim_path` for a result.
   */
  claimPath: z.string().min(1).max(200).default('groups'),
  /**
   * Claim values pulled from the JWT. The catalog matches each
   * value against the configured mappings; the highest-priority
   * match wins (ties broken by created_at).
   */
  claimValues: z.array(z.string().min(1).max(400)).max(64),
});
export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

export const ResolveResponseSchema = z.object({
  /**
   * The resolved persona, or `null` when no enabled mapping
   * matched. Hosts decide what to do with `null` — typically
   * fall back to a configured default.
   */
  runtimePersona: z.string().nullable(),
  /**
   * Subset of input `claimValues` that produced the winning
   * mapping. Empty array when `runtimePersona` is `null`.
   * Multiple values appear when the winning mapping was tied on
   * priority + created_at (rare but possible after an admin
   * bulk-import).
   */
  matchedClaimValues: z.array(z.string()),
  /** UUID of the mapping that won, or `null` when no match. */
  mappingId: z.string().uuid().nullable(),
  /**
   * Priority of the winning mapping. Useful for ops dashboards
   * that want to show "highest priority that matched".
   */
  priority: z.number().int().nullable(),
});
export type ResolveResponse = z.infer<typeof ResolveResponseSchema>;
