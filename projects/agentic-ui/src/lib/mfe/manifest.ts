import { z } from 'zod';

export const CapabilityManifestSchema = z.object({
  remoteName: z.string(),
  version: z.string(),
  exposes: z.object({
    tools: z.array(z.string()).default([]),
    components: z.array(z.string()).default([]),
    actions: z.array(z.string()).default([]).optional(),
    forms: z.array(z.string()).default([]).optional(),
    prompts: z.array(z.string()).default([]).optional(),
  }),
  manifestUrl: z.string().optional(),
});

// `CapabilityManifest` interface is the canonical type — re-export from `types/`.
export type { CapabilityManifest } from '../types/registry-defs';

/**
 * Which federation runtime built the remote, so a single registry can mix them.
 * `native-federation` (default) is loaded directly; `module-federation` (MF 2.0,
 * @module-federation/runtime) and `module-federation-1` (webpack MF 1.0) are
 * loaded via a host-provided loader — see `createRemoteLoader`.
 */
export const FEDERATION_TYPES = ['native-federation', 'module-federation', 'module-federation-1'] as const;
export type FederationType = (typeof FEDERATION_TYPES)[number];

export const RemoteSpecSchema = z.object({
  remoteName: z.string(),
  version: z.string(),
  /** URL of the remote's federation entry (remoteEntry.json / remoteEntry.js / remoteEntry.mjs). */
  remoteEntry: z.string(),
  /** How the remote was built. Absent = `native-federation` (back-compat). */
  type: z.enum(FEDERATION_TYPES).optional(),
  /** URL of the remote's capabilities.json (sibling of remoteEntry, or absolute). */
  capabilityManifestUrl: z.string().optional(),
  env: z.string().optional(),
  healthStatus: z.enum(['healthy', 'degraded', 'down']).optional(),
});

export type RemoteSpec = z.infer<typeof RemoteSpecSchema>;
