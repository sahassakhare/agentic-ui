import type { ZodTypeAny } from 'zod';
import type { IntentDef, IntentTarget } from '../types/registry-defs';

export interface AgenticIntentConfig {
  readonly id: string;
  readonly description: string;
  readonly examples: readonly string[];
  readonly schema: ZodTypeAny;
  readonly mapsTo: IntentTarget;
}

export function agenticIntent(config: AgenticIntentConfig): IntentDef {
  return {
    name: config.id,
    id: config.id,
    description: config.description,
    examples: config.examples,
    schema: config.schema,
    mapsTo: config.mapsTo,
  };
}
