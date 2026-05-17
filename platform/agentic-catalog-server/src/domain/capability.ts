import { z } from 'zod';

/**
 * Allowed capability kinds. Mirrors the 15-registry taxonomy from
 * the runtime tier ([projects/agentic-ui/src/lib/registries](
 * ../../../../projects/agentic-ui/src/lib/registries)) — adding a
 * new registry requires adding a new kind here AND a migration.
 */
export const CAPABILITY_KINDS = [
  'tool',
  'component',
  'capability',
  'backend',
  'mfe',
  'action',
  'intent',
  'form',
  'datasource',
  'validation',
  'persistence',
  'layout',
  'schema-transformer',
  'approval',
  'operation',
] as const;

export const CapabilityKindSchema = z.enum(CAPABILITY_KINDS);
export type CapabilityKind = z.infer<typeof CapabilityKindSchema>;

/**
 * Lifecycle states a catalog entry transitions through. Mirrors
 * `RegistryEntry.lifecycle` (ADR-014). The runtime treats absent as
 * `'published'`; the catalog stores it explicitly.
 */
export const LifecycleSchema = z.enum(['draft', 'published', 'deprecated', 'disabled']);
export type Lifecycle = z.infer<typeof LifecycleSchema>;

/**
 * Capability identifier — `${kind}:${name}` is unique within a tenant.
 * Names follow the same constraints as runtime registry entries:
 * non-empty, no whitespace, ≤120 chars.
 */
export const CapabilityNameSchema = z
  .string()
  .min(1, 'name is required')
  .max(120, 'name must be ≤120 chars')
  .regex(/^[A-Za-z0-9_./:@-]+$/, 'name must match [A-Za-z0-9_./:@-]+');

/**
 * Full capability shape as stored + returned by the catalog. The
 * `body` field is opaque JSONB carrying the runtime's `RegistryEntry`-
 * shaped payload — kind-specific fields (handler URL for tools,
 * widget chunk hash for components, etc.) live there.
 *
 * Catalog metadata (id, audit timestamps, soft-delete) lives at the
 * top level for indexing.
 */
export const CapabilitySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1).max(120),
  kind: CapabilityKindSchema,
  name: CapabilityNameSchema,
  body: z.record(z.string(), z.unknown()),
  lifecycle: LifecycleSchema,
  owner: z.string().max(120).nullable(),
  tags: z.array(z.string().max(60)).max(32),
  requiredHostVersion: z.string().max(40).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().min(1).max(120),
  softDeletedAt: z.string().datetime().nullable(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * Inputs to `POST /v1/catalogs/{tenant}/capabilities`. Server fills
 * id, timestamps, createdBy (from JWT), softDeletedAt.
 */
export const CapabilityCreateSchema = z.object({
  kind: CapabilityKindSchema,
  name: CapabilityNameSchema,
  body: z.record(z.string(), z.unknown()),
  lifecycle: LifecycleSchema.default('published'),
  owner: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(60)).max(32).default([]),
  requiredHostVersion: z.string().max(40).nullable().optional(),
});
export type CapabilityCreate = z.infer<typeof CapabilityCreateSchema>;

/**
 * Inputs to `PATCH /v1/catalogs/{tenant}/capabilities/{id}`. Every
 * field is optional. `kind` and `name` are immutable post-create —
 * change either by deleting + re-creating with a fresh id.
 */
export const CapabilityUpdateSchema = z.object({
  body: z.record(z.string(), z.unknown()).optional(),
  lifecycle: LifecycleSchema.optional(),
  owner: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(60)).max(32).optional(),
  requiredHostVersion: z.string().max(40).nullable().optional(),
});
export type CapabilityUpdate = z.infer<typeof CapabilityUpdateSchema>;

/**
 * Filter params for `GET /v1/catalogs/{tenant}/capabilities`.
 */
export const CapabilityListQuerySchema = z.object({
  kind: CapabilityKindSchema.optional(),
  lifecycle: LifecycleSchema.optional(),
  owner: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(), // free-text on name
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  includeDeleted: z.coerce.boolean().default(false),
});
export type CapabilityListQuery = z.infer<typeof CapabilityListQuerySchema>;
