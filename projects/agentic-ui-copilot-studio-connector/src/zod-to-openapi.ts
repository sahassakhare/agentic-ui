import type { OpenApiSchema } from './types.js';

/**
 * Translate a Zod schema into a Power Platform Connector-compatible
 * OpenAPI 3 schema fragment (ADR-042 D2).
 *
 * Subset supported (matches the Zod features the catalog tools
 * actually use):
 *   - z.string  ->  { type: 'string' } + minLength/maxLength/format
 *   - z.number  ->  { type: 'number' } + minimum/maximum
 *   - z.boolean ->  { type: 'boolean' }
 *   - z.enum    ->  { type: 'string', enum: [...] }
 *   - z.array   ->  { type: 'array', items: ... }
 *   - z.object  ->  { type: 'object', properties: {...}, required: [...] }
 *   - .optional ->  drops the key from `required[]`
 *   - .nullable ->  `nullable: true`
 *   - .describe ->  `description`
 *   - .default  ->  `default`
 *
 * Unsupported types (`z.union`, `z.intersection`, custom refines,
 * transforms) fall back to `{ additionalProperties: true }` with
 * a warning so the action is still importable -- the host
 * re-validates inputs server-side (D2 safety net).
 *
 * We duck-type against Zod's `_def` AST so this lib doesn't lock
 * to a specific Zod version. Adopters on an arbitrary Zod
 * release can pass their schemas through unchanged.
 */
export interface ZodToOpenApiOptions {
  /** Optional logger for unsupported-type warnings. Defaults to
   *  `console.warn`. */
  readonly onUnsupported?: (typeName: string, path: readonly string[]) => void;
}

interface ZodLike {
  _def?: {
    typeName?: string;
    description?: string;
    innerType?: ZodLike;
    type?: ZodLike;
    valueType?: ZodLike;
    values?: Record<string, string | number>;
    checks?: Array<{ kind: string; value?: number; regex?: RegExp }>;
    shape?: () => Record<string, ZodLike>;
    defaultValue?: () => unknown;
    coerce?: boolean;
  };
}

export function zodToOpenApi(
  schema: unknown,
  options: ZodToOpenApiOptions = {},
): OpenApiSchema {
  return translate(schema as ZodLike, [], options);
}

function translate(
  z: ZodLike,
  path: readonly string[],
  options: ZodToOpenApiOptions,
): OpenApiSchema {
  if (!z || typeof z !== 'object' || !z._def) {
    return fallback(path, 'non-zod', options);
  }
  const def = z._def;
  const typeName = def.typeName ?? '';

  switch (typeName) {
    case 'ZodString': {
      const out: OpenApiSchema = { type: 'string' };
      if (def.description) out.description = def.description;
      for (const check of def.checks ?? []) {
        if (check.kind === 'min' && typeof check.value === 'number') out.minLength = check.value;
        if (check.kind === 'max' && typeof check.value === 'number') out.maxLength = check.value;
        if (check.kind === 'email') out.format = 'email';
        if (check.kind === 'url') out.format = 'uri';
        if (check.kind === 'uuid') out.format = 'uuid';
        if (check.kind === 'datetime') out.format = 'date-time';
      }
      return out;
    }
    case 'ZodNumber': {
      const out: OpenApiSchema = { type: 'number' };
      if (def.description) out.description = def.description;
      for (const check of def.checks ?? []) {
        if (check.kind === 'min' && typeof check.value === 'number') out.minimum = check.value;
        if (check.kind === 'max' && typeof check.value === 'number') out.maximum = check.value;
        if (check.kind === 'int') out.type = 'integer';
      }
      return out;
    }
    case 'ZodBoolean': {
      const out: OpenApiSchema = { type: 'boolean' };
      if (def.description) out.description = def.description;
      return out;
    }
    case 'ZodEnum':
    case 'ZodNativeEnum': {
      // values is { name -> value } in Zod; values are the
      // OpenAPI enum members. Filter strings/numbers/booleans.
      const raw = Object.values(def.values ?? {});
      const values = raw.filter(
        (v): v is string | number =>
          typeof v === 'string' || typeof v === 'number',
      );
      const out: OpenApiSchema = { type: 'string', enum: values };
      if (def.description) out.description = def.description;
      return out;
    }
    case 'ZodArray': {
      const items = def.type
        ? translate(def.type, [...path, '[]'], options)
        : { additionalProperties: true };
      const out: OpenApiSchema = { type: 'array', items };
      if (def.description) out.description = def.description;
      return out;
    }
    case 'ZodObject': {
      const shape = def.shape ? def.shape() : {};
      const properties: Record<string, OpenApiSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        const childSchema = translate(child, [...path, key], options);
        properties[key] = childSchema;
        if (!isOptional(child)) required.push(key);
      }
      const out: OpenApiSchema = { type: 'object', properties };
      if (required.length > 0) out.required = required;
      if (def.description) out.description = def.description;
      return out;
    }
    case 'ZodOptional': {
      // Render the inner type; `required[]` placement is decided
      // by the parent ObjectShape walk.
      return def.innerType
        ? translate(def.innerType, path, options)
        : fallback(path, 'ZodOptional-empty', options);
    }
    case 'ZodNullable': {
      const inner = def.innerType
        ? translate(def.innerType, path, options)
        : fallback(path, 'ZodNullable-empty', options);
      return { ...inner, nullable: true };
    }
    case 'ZodDefault': {
      const inner = def.innerType
        ? translate(def.innerType, path, options)
        : fallback(path, 'ZodDefault-empty', options);
      const def_ = def.defaultValue ? def.defaultValue() : undefined;
      return def_ === undefined ? inner : { ...inner, default: def_ };
    }
    case 'ZodEffects': {
      // Refinements + transforms wrap an inner type. Translate
      // the inner; the refinement itself isn't expressible in
      // OpenAPI keywords. Server-side re-validation is the
      // safety net (ADR-042 D2 trade-off).
      return def.innerType
        ? translate(def.innerType, path, options)
        : fallback(path, 'ZodEffects-empty', options);
    }
    default:
      return fallback(path, typeName || 'unknown', options);
  }
}

function isOptional(z: ZodLike): boolean {
  const tn = z._def?.typeName ?? '';
  if (tn === 'ZodOptional' || tn === 'ZodDefault') return true;
  return false;
}

function fallback(
  path: readonly string[],
  reason: string,
  options: ZodToOpenApiOptions,
): OpenApiSchema {
  const notify = options.onUnsupported ?? defaultUnsupportedNotifier;
  notify(reason, path);
  return { additionalProperties: true };
}

function defaultUnsupportedNotifier(typeName: string, path: readonly string[]): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[zodToOpenApi] unsupported Zod type ${JSON.stringify(typeName)} ` +
      `at path ${path.join('.') || '(root)'} -- emitting permissive ` +
      `additionalProperties:true. Server-side re-validation required.`,
  );
}
