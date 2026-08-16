import { z, type ZodTypeAny } from 'zod';
import { parseCompositionExpression } from '../composition/composition-expression';
import type {
  CompositionEntry,
  FormActionDef,
  FormDef,
  FormFieldUi,
} from '../types/registry-defs';

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
  /** Optional action bar; when omitted a single Submit button is synthesized. */
  readonly actions?: readonly FormActionDef[];
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
  /** Optional action bar; when omitted a single Submit button is synthesized. */
  readonly actions?: readonly FormActionDef[];
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

/** Every valid `FormActionDef.kind`. */
const FORM_ACTION_KINDS = ['submit', 'reset', 'cancel', 'tool', 'action', 'navigate', 'emit'] as const;

/**
 * Thrown by `agenticForm({...})` when an `actions[]` entry is malformed
 * (unknown kind, empty label, or a missing/invalid governed target). Carries
 * `formName` + `actionIndex` so authoring errors point at the offending button.
 */
export class FormActionError extends Error {
  constructor(
    message: string,
    public readonly formName: string,
    public readonly actionIndex: number,
  ) {
    super(`[${formName}] actions[${actionIndex}]: ${message}`);
    this.name = 'FormActionError';
  }
}

/**
 * Validate + normalize one action-bar entry. Strips unknown fields and keeps
 * only the shape for the entry's `kind`, so untrusted catalog input can't smuggle
 * extra properties onto a `FormActionDef`.
 */
function normalizeFormAction(
  action: FormActionDef,
  formName: string,
  index: number,
): FormActionDef {
  if (typeof action !== 'object' || action === null) {
    throw new FormActionError('Entry must be an object', formName, index);
  }
  const kind = (action as FormActionDef).kind;
  if (!FORM_ACTION_KINDS.includes(kind as (typeof FORM_ACTION_KINDS)[number])) {
    throw new FormActionError(`Unknown action kind ${JSON.stringify(kind)}`, formName, index);
  }
  if (typeof action.label !== 'string' || action.label.trim() === '') {
    throw new FormActionError('Action must have a non-empty label', formName, index);
  }
  const base = { label: action.label, style: action.style } as const;
  switch (action.kind) {
    case 'tool':
      if (typeof action.tool !== 'string' || !IDENTIFIER_RE.test(action.tool)) {
        throw new FormActionError(
          `'tool' must name a registered tool (got ${JSON.stringify(action.tool)})`,
          formName,
          index,
        );
      }
      return { kind: 'tool', ...base, tool: action.tool, args: action.args };
    case 'action':
      if (typeof action.action !== 'string' || !IDENTIFIER_RE.test(action.action)) {
        throw new FormActionError(
          `'action' must name a registered action (got ${JSON.stringify(action.action)})`,
          formName,
          index,
        );
      }
      return { kind: 'action', ...base, action: action.action, payload: action.payload };
    case 'navigate':
      if (typeof action.to !== 'string' || action.to.trim() === '') {
        throw new FormActionError("'navigate' requires a non-empty 'to'", formName, index);
      }
      return { kind: 'navigate', ...base, to: action.to };
    case 'emit':
      if (typeof action.event !== 'string' || action.event.trim() === '') {
        throw new FormActionError("'emit' requires a non-empty 'event'", formName, index);
      }
      return { kind: 'emit', ...base, event: action.event, detail: action.detail };
    default:
      // submit | reset | cancel — no extra fields.
      return { kind: action.kind, ...base };
  }
}

/**
 * Resolve an optional `actions[]` config into a normalized, always-present list.
 * When omitted, synthesize the classic single Submit so old forms are unchanged.
 */
function resolveFormActions(
  raw: readonly FormActionDef[] | undefined,
  formName: string,
): readonly FormActionDef[] {
  if (raw === undefined) return [{ kind: 'submit', label: 'Submit' }];
  return raw.map((a, i) => normalizeFormAction(a, formName, i));
}

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
      actions: resolveFormActions(config.actions, config.name),
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
    actions: resolveFormActions(config.actions, config.name),
    submit: async (values) => Promise.resolve(submit(values as z.infer<TSchema>)),
  };
}
