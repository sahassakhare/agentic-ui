import { Injectable } from '@angular/core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z, type ZodTypeAny } from 'zod';
import { RegistryBase } from './registry-base';
import type { SchemaTransformerDef, ToolDef } from '../types/registry-defs';

/**
 * Registry of schema-shape converters. Two transformers ship by default:
 *  - 'zod-to-json-schema' (zod → json-schema)
 *  - 'json-schema-to-zod' (json-schema → zod, lightweight subset)
 *
 * Used by:
 *  - tools.ts — to expose a Zod tool's parameters as JSON Schema for AG-UI.
 *  - {@link openApiToTools} — to import an OpenAPI document as a list of `ToolDef`s.
 *
 * Apps register richer converters (e.g., a full json-schema-to-zod) by calling
 * `register(...)` with a higher-priority `name`.
 */
@Injectable({ providedIn: 'root' })
export class SchemaTransformerRegistry extends RegistryBase<SchemaTransformerDef> {
  protected readonly registryName = 'schema-transformer';

  constructor() {
    super();
    this.register({
      name: 'zod-to-json-schema',
      from: 'zod',
      to: 'json-schema',
      transform: (input) => zodToJsonSchema(input as ZodTypeAny, { target: 'jsonSchema7' }) as object,
    });
    this.register({
      name: 'json-schema-to-zod',
      from: 'json-schema',
      to: 'zod',
      transform: (input) => jsonSchemaToZod(input as Record<string, unknown>),
    });
  }

  find(from: SchemaTransformerDef['from'], to: SchemaTransformerDef['to']): SchemaTransformerDef | undefined {
    return this.list().find((t) => t.from === from && t.to === to);
  }
}

/**
 * Lightweight JSON Schema → Zod converter. Handles `string`, `number`, `integer`,
 * `boolean`, `array`, and `object` (with required + properties). Falls back to
 * `z.unknown()` for shapes it doesn't recognize. For full coverage, register an
 * adapter on top of `json-schema-to-zod` (npm) or similar.
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.unknown();
  const type = schema['type'];
  if (Array.isArray(schema['enum'])) {
    return z.enum(schema['enum'] as [string, ...string[]]);
  }
  switch (type) {
    case 'string':  return z.string();
    case 'number':  return z.number();
    case 'integer': return z.number().int();
    case 'boolean': return z.boolean();
    case 'array': {
      const items = schema['items'];
      return z.array(items && typeof items === 'object' ? jsonSchemaToZod(items as Record<string, unknown>) : z.unknown());
    }
    case 'object': {
      const props = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
      const required = new Set((schema['required'] ?? []) as string[]);
      const shape: Record<string, ZodTypeAny> = {};
      for (const [k, v] of Object.entries(props)) {
        const inner = jsonSchemaToZod(v);
        shape[k] = required.has(k) ? inner : inner.optional();
      }
      return z.object(shape);
    }
    default: return z.unknown();
  }
}

export interface OpenApiOperation {
  readonly operationId: string;
  readonly summary?: string;
  readonly description?: string;
  readonly parameters?: readonly Record<string, unknown>[];
  readonly requestBody?: { readonly content?: Record<string, { readonly schema?: unknown }> };
}

/**
 * Converts an OpenAPI 3.x document into a list of `ToolDef`s — one per
 * operation. Each tool's handler is a stub that returns `undefined`; consumers
 * replace the handler when registering, or wire it through a DataSource.
 *
 * This is the "import" half of M5: an OpenAPI spec → instantly available tools
 * for the agent to invoke (with proper arg validation via Zod).
 */
export function openApiToTools(spec: { paths?: Record<string, Record<string, unknown>> }): ToolDef[] {
  const tools: ToolDef[] = [];
  const paths = spec.paths ?? {};
  for (const pathItem of Object.values(paths)) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      const operation = op as OpenApiOperation;
      const operationId = operation.operationId;
      if (!operationId) continue;
      const bodySchema = operation.requestBody?.content?.['application/json']?.schema;
      const schema = bodySchema ? jsonSchemaToZod(bodySchema as Record<string, unknown>) : z.object({});
      tools.push({
        name: operationId,
        description: operation.summary ?? operation.description ?? operationId,
        schema,
        handler: async () => undefined,
      });
    }
  }
  return tools;
}
