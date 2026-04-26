import type { ZodTypeAny, z } from 'zod';
import type { ActionContext, ActionDef } from '../types/registry-defs';

export interface AgenticActionConfig<TSchema extends ZodTypeAny> {
  readonly type: string;
  readonly description: string;
  readonly payloadSchema: TSchema;
  readonly effect: (payload: z.infer<TSchema>, ctx: ActionContext) => void | Promise<void>;
}

export function agenticAction<TSchema extends ZodTypeAny>(
  config: AgenticActionConfig<TSchema>,
): ActionDef<z.infer<TSchema>> {
  return {
    name: config.type,
    type: config.type,
    description: config.description,
    payloadSchema: config.payloadSchema,
    effect: async (payload, ctx) => Promise.resolve(config.effect(payload, ctx)),
  };
}
