import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Convert a `ToolDef`'s Zod schema into the JSON-Schema shape WebMCP's
 * `navigator.modelContext.registerTool` expects for `inputSchema`.
 *
 * Mirrors `zodToMcpSchema` in `@infra-tools/agentic-ui-mcp` — both target
 * the MCP `tools/list` dialect (top-level `type: 'object'`, no `$schema`,
 * no `definitions`). Kept as its own copy rather than a cross-package
 * import so neither package depends on the other; the logic is ~15 LOC
 * and stable. Keep the two in sync if the MCP dialect changes.
 */
export interface WebMcpInputSchema {
  type: 'object';
  properties: Record<string, object>;
  required?: string[];
  additionalProperties?: boolean;
}

export function zodToWebMcpSchema(schema: ZodTypeAny): WebMcpInputSchema {
  const raw = zodToJsonSchema(schema, { target: 'jsonSchema7' }) as Record<string, unknown>;
  // Strip fields MCP-dialect consumers reject.
  delete raw['$schema'];
  delete raw['definitions'];
  delete raw['$defs'];
  delete raw['description'];

  // Guarantee an object schema even when the Zod type wasn't a z.object.
  if (raw['type'] !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
  return {
    type: 'object',
    properties: (raw['properties'] as Record<string, object>) ?? {},
    ...(Array.isArray(raw['required']) ? { required: raw['required'] as string[] } : {}),
    ...(typeof raw['additionalProperties'] === 'boolean'
      ? { additionalProperties: raw['additionalProperties'] }
      : {}),
  };
}
