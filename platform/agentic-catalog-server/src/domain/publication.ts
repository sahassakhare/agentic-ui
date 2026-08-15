import { z } from 'zod';

/**
 * Publishing domain (headless consumption). A publication pins an APPROVED
 * experience's version and freezes a self-contained render **manifest** that
 * external portals fetch anonymously via an origin-pinned embed key. This is a
 * separate axis from approval — see `domain/experience.ts` for the approval
 * state machine, which publishing never touches.
 *
 * The manifest shape is mirrored (by hand, tested against fixtures) in the
 * framework-agnostic SDK at `platform/aep-embed-sdk/src/types.ts` — keep the
 * two in lockstep.
 */

/** A serializable branch condition (mirrors the runtime `WorkflowCondition`). */
export const WorkflowConditionSchema = z.object({
  field: z.string().min(1).max(120),
  op: z.enum(['==', '!=', 'in', 'truthy', 'falsy']),
  value: z.unknown().optional(),
});
export type WorkflowCondition = z.infer<typeof WorkflowConditionSchema>;

/** Declarative conditional transition: first matching branch wins, else default. */
export const ConditionalNextSchema = z.object({
  branches: z.array(z.object({ when: WorkflowConditionSchema, goto: z.string().min(1).max(120) })).max(64),
  default: z.string().min(1).max(120).nullable(),
});
export type ConditionalNext = z.infer<typeof ConditionalNextSchema>;

/**
 * One workflow step as it appears in a published manifest. `next` is a target
 * step id, terminal (null), or a {@link ConditionalNextSchema}. The runtime's
 * `(state) => …` function form is intentionally absent — it cannot survive JSON.
 */
export const WorkflowStepJsonSchema = z.object({
  id: z.string().min(1).max(120),
  widget: z.string().min(1).max(120),
  section: z.string().max(200).optional(),
  next: z.union([z.string().max(120), z.null(), ConditionalNextSchema]),
});
export type WorkflowStepJson = z.infer<typeof WorkflowStepJsonSchema>;

/** A widget the portal must supply an implementation for, keyed by `name`. */
export const ManifestWidgetSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().min(1).max(60),
  /** Serializable props hint (JSON-schema-ish) if the capability declared one. */
  propsSchema: z.unknown().optional(),
});
export type ManifestWidget = z.infer<typeof ManifestWidgetSchema>;

/** The frozen, self-contained render manifest served to external portals. */
export const PublishedManifestSchema = z.object({
  experience: z.object({
    name: z.string(),
    title: z.string(),
    goal: z.string(),
    defaultLayout: z.string().optional(),
  }),
  workflow: z.object({ steps: z.array(WorkflowStepJsonSchema) }).nullable(),
  widgets: z.array(ManifestWidgetSchema),
  publishedVersionNo: z.number().int().nonnegative(),
  publishedAt: z.string(),
});
export type PublishedManifest = z.infer<typeof PublishedManifestSchema>;
/** Alias: the stored snapshot and the served manifest are the same shape. */
export const PublishedBundleSchema = PublishedManifestSchema;
export type PublishedBundle = PublishedManifest;

/** Input to `POST …/experiences/:id/publish`. */
export const PublishRequestSchema = z.object({
  /**
   * Origins allowed to embed this publication (exact scheme+host+port match on
   * the request `Origin` header). Empty ⇒ no browser origin is allowed (the
   * manifest is still reachable by non-browser/server-side callers, which send
   * no `Origin`).
   */
  allowedOrigins: z.array(z.string().url().max(200)).max(32).default([]),
});
export type PublishRequest = z.infer<typeof PublishRequestSchema>;

/** Publication row as returned to the writer (never includes the raw key). */
export const PublicationSchema = z.object({
  id: z.string().uuid(),
  experienceId: z.string().uuid(),
  experienceName: z.string(),
  publishedVersionNo: z.number().int(),
  keyPrefix: z.string(),
  allowedOrigins: z.array(z.string()),
  status: z.enum(['active', 'revoked']),
  publishedAt: z.string(),
  publishedBy: z.string(),
});
export type Publication = z.infer<typeof PublicationSchema>;
