import { z } from 'zod';

/**
 * Usage meter — per-tenant stream of consumption events. Hosts post
 * events as work is performed; queries aggregate over an arbitrary
 * window. The catalog stores **units, not currency** — pricing is a
 * host concern (`tokens × $/token` is a deployment-specific decision).
 *
 * See [ADR-018](../../../../../docs/adr/0018-usage-meter.md).
 */

const KindSchema = z
  .string()
  .min(1, 'kind is required')
  .max(120, 'kind must be ≤120 chars')
  // Conservative regex — namespaced kebab-case-with-dots is the
  // canonical convention. Free strings would still work but we'd
  // prefer hosts pick deterministic identifiers.
  .regex(/^[a-z0-9._-]+$/, 'kind must match [a-z0-9._-]+');

const QuantitySchema = z
  .number()
  .int('quantity must be an integer')
  .nonnegative('quantity must be ≥0')
  // Postgres BIGINT max is 2^63 - 1; JS safe integer is ~2^53.
  // Stay inside the safe-integer window.
  .max(Number.MAX_SAFE_INTEGER, 'quantity exceeds JS safe integer range');

const TagsSchema = z
  .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .refine((t) => Object.keys(t).length <= 32, 'at most 32 tag keys')
  .default({});

export const UsageEventCreateSchema = z.object({
  kind: KindSchema,
  quantity: QuantitySchema,
  tags: TagsSchema,
  /**
   * Optional idempotency key. Lets hosts retry POSTs without
   * double-counting. Unique per tenant — repeated POSTs with the
   * same key resolve to the original row.
   */
  idempotencyKey: z.string().min(1).max(200).optional(),
  /**
   * Optional client-side timestamp (ISO 8601). When omitted the
   * server stamps `now()` at insert time. Useful for batch hosts
   * that submit events out-of-band from when they happened.
   */
  occurredAt: z.string().datetime().optional(),
});
export type UsageEventCreate = z.infer<typeof UsageEventCreateSchema>;

export const UsageEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  occurredAt: z.string().datetime(),
  kind: z.string(),
  quantity: z.number().int(),
  tags: z.record(z.unknown()),
  idempotencyKey: z.string().nullable(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

export const UsageQuerySchema = z.object({
  /**
   * Inclusive lower bound (ISO 8601). Defaults to "no lower bound."
   */
  from: z.string().datetime().optional(),
  /**
   * Exclusive upper bound (ISO 8601). Defaults to "now."
   */
  to: z.string().datetime().optional(),
  /**
   * Optional kind filter. When omitted, every kind is summed and
   * returned in the breakdown.
   */
  kind: KindSchema.optional(),
});
export type UsageQuery = z.infer<typeof UsageQuerySchema>;

export const UsageAggregateSchema = z.object({
  /** Window applied to the query — echoed back so callers can verify. */
  from: z.string().datetime().nullable(),
  to: z.string().datetime().nullable(),
  /**
   * Sum of `quantity` per `kind` over the requested window. Empty
   * object when no events match.
   */
  byKind: z.record(z.number().int()),
  /** Total event count (rows, not summed quantity). */
  totalEvents: z.number().int(),
  /** Total summed quantity across every kind. */
  totalQuantity: z.number().int(),
});
export type UsageAggregate = z.infer<typeof UsageAggregateSchema>;
