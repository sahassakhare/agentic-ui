import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * The shape MCP's `tools/list` expects for each tool's `inputSchema`.
 *
 * @remarks
 * MCP requires a JSON Schema "draft-07-ish" object schema — specifically,
 * the top-level must be `type: 'object'`. The `zodToJsonSchema` library
 * already produces that shape from a `z.object({...})`, but adds extra
 * fields MCP rejects (notably `$schema` and the default `additionalProperties: false`
 * being inconsistent across hosts). This helper produces a clean,
 * MCP-compatible schema.
 */
/**
 * MCP-compatible JSON Schema for a tool's input. Matches the shape the
 * MCP SDK's `Tool.inputSchema` field expects (mutable arrays — the SDK
 * doesn't use `readonly` modifiers).
 */
export interface McpInputSchema {
  type: 'object';
  properties: Record<string, object>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Convert a Zod schema (typically a `z.object({...})` from a `ToolDef`)
 * into an MCP-compatible JSON Schema.
 *
 * @remarks
 * Reuses `zod-to-json-schema` (already a transitive dep through
 * `@maverick/agentic-ui`) for the heavy lifting and post-processes the
 * output for the MCP dialect:
 *
 * - Strips the top-level `$schema` field — MCP `tools/list` consumers
 *   reject it as extraneous.
 * - Strips `definitions` / `$defs` / `description` at the top level if
 *   present (MCP's contract is the schema describes the input, not the
 *   tool itself).
 * - Asserts the output is an object schema; throws if a non-object
 *   schema slipped through (e.g., a `z.string()` directly — tools
 *   should always take an object).
 *
 * @param schema The Zod schema to convert. Must resolve to a JSON
 *               Schema with `type: 'object'`.
 * @param toolName Used for the error message when the schema is invalid.
 * @throws Error when the converted schema isn't an object schema.
 */
export function zodToMcpSchema(schema: ZodTypeAny, toolName: string): McpInputSchema {
  const converted = zodToJsonSchema(schema, { target: 'jsonSchema7' }) as Record<string, unknown>;

  // Strip MCP-incompatible top-level fields.
  const cleaned: Record<string, unknown> = { ...converted };
  delete cleaned['$schema'];
  delete cleaned['$defs'];
  delete cleaned['definitions'];
  delete cleaned['description'];
  delete cleaned['title'];

  if (cleaned['type'] !== 'object') {
    throw new Error(
      `[agentic-ui-mcp] Tool "${toolName}" has a non-object input schema (type=${String(cleaned['type'])}). ` +
      `MCP requires every tool's inputSchema to be an object schema. ` +
      `Wrap the parameters in z.object({...}).`,
    );
  }

  // Ensure `properties` is at least an empty object — MCP hosts
  // sometimes choke on a missing `properties` even when there are no
  // required args.
  if (cleaned['properties'] === undefined) cleaned['properties'] = {};

  return cleaned as unknown as McpInputSchema;
}
