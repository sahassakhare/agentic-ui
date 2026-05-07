import { z, type ZodTypeAny } from 'zod';
import { parseCompositionExpression } from '../composition/composition-expression';
import type { CompositionEntry, FormDef, FormFieldUi } from '../types/registry-defs';

/**
 * Schema-mode form: validate a flat field map with a single Zod schema.
 * Existing shape — preserved for backwards compatibility.
 */
export interface AgenticSchemaFormConfig<TSchema extends ZodTypeAny> {
  readonly name: string;
  readonly description: string;
  readonly fieldsSchema: TSchema;
  readonly ui?: Readonly<Record<string, FormFieldUi>>;
  readonly submit: (values: z.infer<TSchema>) => Promise<void> | void;
  readonly composition?: never;
}

/**
 * Composition-mode form (Capability F1): the form is assembled at runtime
 * from an ordered list of registered widgets. Each widget renders its own
 * section; values are aggregated by widget name at submit time.
 */
export interface AgenticCompositionFormConfig {
  readonly name: string;
  readonly description: string;
  readonly composition: readonly CompositionEntry[];
  readonly ui?: Readonly<Record<string, FormFieldUi>>;
  readonly submit: (values: Readonly<Record<string, unknown>>) => Promise<void> | void;
  readonly fieldsSchema?: never;
}

export type AgenticFormConfig<TSchema extends ZodTypeAny = ZodTypeAny> =
  | AgenticSchemaFormConfig<TSchema>
  | AgenticCompositionFormConfig;

/**
 * Thrown by `agenticForm({...})` when a composition entry is malformed
 * (mutual-exclusion violations, missing widget name, or invalid `if` DSL).
 *
 * Carries `formName` and `entryIndex` so the IDE can underline the offending
 * entry. When the cause is an invalid DSL expression, `cause` is set to the
 * underlying `CompositionExpressionError` (which carries source + position).
 */
export class FormCompositionError extends Error {
  constructor(
    message: string,
    public readonly formName: string,
    public readonly entryIndex: number,
    options?: { cause?: unknown },
  ) {
    super(`[${formName}] composition[${entryIndex}]: ${message}`);
    this.name = 'FormCompositionError';
    if (options?.cause !== undefined) {
      // Preserve underlying error for callers that want details.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function isCompositionConfig<TSchema extends ZodTypeAny>(
  config: AgenticFormConfig<TSchema>,
): config is AgenticCompositionFormConfig {
  return Array.isArray((config as AgenticCompositionFormConfig).composition);
}

function normalizeCompositionEntry(
  entry: CompositionEntry,
  formName: string,
  index: number,
): CompositionEntry {
  if (typeof entry !== 'object' || entry === null) {
    throw new FormCompositionError('Entry must be an object', formName, index);
  }
  if (typeof entry.widget !== 'string' || !IDENTIFIER_RE.test(entry.widget)) {
    throw new FormCompositionError(
      `Entry must reference a registered widget by name (got ${JSON.stringify(entry.widget)})`,
      formName,
      index,
    );
  }
  if (entry.if !== undefined && entry.predicate !== undefined) {
    throw new FormCompositionError(
      "Provide either 'if' (DSL string) or 'predicate' (function), not both",
      formName,
      index,
    );
  }
  if (entry.if !== undefined) {
    let compiled: ReturnType<typeof parseCompositionExpression>;
    try {
      compiled = parseCompositionExpression(entry.if);
    } catch (cause) {
      throw new FormCompositionError(
        `Invalid 'if' expression`,
        formName,
        index,
        { cause },
      );
    }
    return {
      widget: entry.widget,
      section: entry.section,
      // Drop `if` after compiling — renderer only consumes `predicate`.
      predicate: compiled,
    };
  }
  if (entry.predicate !== undefined && typeof entry.predicate !== 'function') {
    throw new FormCompositionError(
      `'predicate' must be a function (got ${typeof entry.predicate})`,
      formName,
      index,
    );
  }
  return {
    widget: entry.widget,
    section: entry.section,
    predicate: entry.predicate,
  };
}

/**
 * Permissive passthrough schema synthesized for composition forms. The
 * renderer aggregates per-widget values into an unconstrained record; widget
 * propsSchemas perform per-section validation independently.
 */
const COMPOSITION_FIELDS_SCHEMA: ZodTypeAny = z.record(z.string(), z.unknown());

export function agenticForm(
  config: AgenticCompositionFormConfig,
): FormDef<Readonly<Record<string, unknown>>>;
export function agenticForm<TSchema extends ZodTypeAny>(
  config: AgenticSchemaFormConfig<TSchema>,
): FormDef<z.infer<TSchema>>;
export function agenticForm<TSchema extends ZodTypeAny>(
  config: AgenticFormConfig<TSchema>,
): FormDef<unknown> {
  if (isCompositionConfig(config)) {
    if (config.composition.length === 0) {
      throw new FormCompositionError(
        'Composition must contain at least one entry',
        config.name,
        0,
      );
    }
    const seenWidgets = new Set<string>();
    const normalized: CompositionEntry[] = [];
    for (let i = 0; i < config.composition.length; i++) {
      const entry = normalizeCompositionEntry(config.composition[i], config.name, i);
      if (seenWidgets.has(entry.widget)) {
        throw new FormCompositionError(
          `Widget '${entry.widget}' appears more than once`,
          config.name,
          i,
        );
      }
      seenWidgets.add(entry.widget);
      normalized.push(entry);
    }
    const submit = config.submit;
    return {
      name: config.name,
      description: config.description,
      fieldsSchema: COMPOSITION_FIELDS_SCHEMA,
      ui: config.ui,
      composition: normalized,
      submit: async (values) =>
        Promise.resolve(submit(values as Readonly<Record<string, unknown>>)),
    };
  }

  // Schema mode (existing behaviour preserved).
  const submit = config.submit;
  return {
    name: config.name,
    description: config.description,
    fieldsSchema: config.fieldsSchema,
    ui: config.ui,
    submit: async (values) => Promise.resolve(submit(values as z.infer<TSchema>)),
  };
}
