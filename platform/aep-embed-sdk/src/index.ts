export { createEmbedClient, EmbedError } from './client.js';
export type { EmbedClient, EmbedClientConfig } from './client.js';
export { isConditionalNext, evalWorkflowCondition, resolveNext, stepById } from './resolve-next.js';
export type {
  PublishedManifest,
  ManifestWidget,
  WorkflowStepJson,
  ConditionalNext,
  WorkflowCondition,
} from './types.js';
