import { z } from 'zod';

/**
 * Agent registry — per-tenant AgenticBackend deployments.
 *
 * See [ADR-039](../../../../../docs/adr/0039-agent-auto-registration.md).
 *
 * Distinct from `mfe_remotes` (federation manifests; manifest-driven
 * status) — agents are the runtime-level callable backends, with
 * heartbeat-driven status. The runtime tier wires
 * `provideAgUiBackend({url})` etc. to one of these; this table is
 * what the ops console renders so operators can see "is the gemini
 * coordinator alive".
 */

const NameSchema = z
  .string()
  .min(1, 'name is required')
  .max(120, 'name must be ≤120 chars')
  .regex(/^[A-Za-z0-9_./-]+$/, 'name must match [A-Za-z0-9_./-]+');

const KindSchema = z.enum(['ag-ui', 'hashbrown', 'a2ui', 'mcp', 'custom']);
const StatusSchema = z.enum(['active', 'degraded', 'inactive']);

export const AgentCreateSchema = z.object({
  name: NameSchema,
  kind: KindSchema,
  manifestUrl: z.string().url('manifestUrl must be a valid URL'),
  version: z.string().optional(),
  requiredHostVersion: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
});
export type AgentCreate = z.infer<typeof AgentCreateSchema>;

export const AgentUpdateSchema = z.object({
  manifestUrl: z.string().url().optional(),
  version: z.string().optional(),
  requiredHostVersion: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  status: StatusSchema.optional(),
});
export type AgentUpdate = z.infer<typeof AgentUpdateSchema>;

export const AgentHeartbeatSchema = z.object({
  status: StatusSchema.optional(),
});
export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;

export const AgentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  name: z.string(),
  kind: KindSchema,
  manifestUrl: z.string(),
  version: z.string().nullable(),
  requiredHostVersion: z.string().nullable(),
  capabilities: z.array(z.string()),
  status: StatusSchema,
  lastHealthAt: z.string().datetime().nullable(),
  registeredBy: z.string(),
  registeredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  softDeletedAt: z.string().datetime().nullable(),
});
export type Agent = z.infer<typeof AgentSchema>;
