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

export const RemoteSpecSchema = z.object({
  remoteName: z.string(),
  version: z.string(),
  /** URL of the remote's federation entry (remoteEntry.json / remoteEntry.js / remoteEntry.mjs). */
  remoteEntry: z.string(),
  /** URL of the remote's capabilities.json (sibling of remoteEntry, or absolute). */
  capabilityManifestUrl: z.string().optional(),
  env: z.string().optional(),
  healthStatus: z.enum(['healthy', 'degraded', 'down']).optional(),
});

export type RemoteSpec = z.infer<typeof RemoteSpecSchema>;
