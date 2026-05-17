import type { ZodTypeAny, z } from 'zod';
import type { ToolContext, ToolDef } from '../types/registry-defs';

export interface AgenticToolConfig<TSchema extends ZodTypeAny, TResult> {
  readonly name: string;
  readonly description: string;
  readonly schema: TSchema;
  readonly handler: (args: z.infer<TSchema>, ctx: ToolContext) => Promise<TResult> | TResult;
  readonly executeIn?: 'host' | 'remote';
  /**
   * Capability F5 opt-in (r3 plan §9.5). Marks a tool as long-running
   * so tooling (telemetry, the `/operations` route, MCP descriptions)
   * can show "may take time" affordances proactively. The chat shell
   * does not require it — calling `ctx.startOperation` works without
   * the flag — but setting it documents intent.
   */
  readonly longRunning?: boolean;
}

/**
 * Type-safe factory for client-side tool definitions. The Zod schema is
 * inferred so the handler receives a strongly-typed `args` argument.
 */
export function agenticTool<TSchema extends ZodTypeAny, TResult>(
  config: AgenticToolConfig<TSchema, TResult>,
): ToolDef<z.infer<TSchema>, TResult> {
  return {
    name: config.name,
    description: config.description,
    schema: config.schema,
    handler: async (args: z.infer<TSchema>, ctx: ToolContext) => Promise.resolve(config.handler(args, ctx)),
    executeIn: config.executeIn ?? 'host',
    ...(config.longRunning !== undefined ? { longRunning: config.longRunning } : {}),
  };
}
