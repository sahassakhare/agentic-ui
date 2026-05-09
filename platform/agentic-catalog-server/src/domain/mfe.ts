import { z } from 'zod';

/**
 * Federation manifest entry — one per remote per tenant. Read by the
 * runtime tier's `RestMfeRegistrySource` adapter (future) so federated
 * remotes can be discovered through the catalog instead of static
 * `mfes.json`.
 */
export const MfeRemoteSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1).max(120),
  name: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  manifestUrl: z.string().url().max(500),
  version: z.string().max(40).nullable(),
  requiredHostVersion: z.string().max(40).nullable(),
  exposes: z.record(z.string(), z.array(z.string())),
  status: z.enum(['active', 'inactive', 'degraded']),
  lastHealthAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MfeRemote = z.infer<typeof MfeRemoteSchema>;

export const MfeRemoteCreateSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  manifestUrl: z.string().url().max(500),
  version: z.string().max(40).nullable().optional(),
  requiredHostVersion: z.string().max(40).nullable().optional(),
  exposes: z.record(z.string(), z.array(z.string())).default({}),
  status: z.enum(['active', 'inactive', 'degraded']).default('active'),
});
export type MfeRemoteCreate = z.infer<typeof MfeRemoteCreateSchema>;

export const MfeRemoteUpdateSchema = z.object({
  manifestUrl: z.string().url().max(500).optional(),
  version: z.string().max(40).nullable().optional(),
  requiredHostVersion: z.string().max(40).nullable().optional(),
  exposes: z.record(z.string(), z.array(z.string())).optional(),
  status: z.enum(['active', 'inactive', 'degraded']).optional(),
});
export type MfeRemoteUpdate = z.infer<typeof MfeRemoteUpdateSchema>;
