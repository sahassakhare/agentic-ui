/**
 * Pure compilation helpers for turning a Studio-authored form body into the
 * pieces `agenticForm(...)` needs. Kept dependency-light (only `zod` + a
 * type-only import) so it's unit-testable without Angular or the lib runtime.
 * Consumed by `CatalogFormSource`.
 */
import { z, type ZodTypeAny } from 'zod';
import type { FormActionDef } from '@infra-tools/agentic-ui';

/** Inline field constraints an author sets in the Form Designer. */
export interface CatalogFieldValidation {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  readonly email?: boolean;
}

/** A field validator resolved by name from a `kind:'validation'` rule. */
export type FieldValidator = (value: unknown) => string | null;

/** One authored field (mirrors the Studio's `SchemaField`, runtime-local). */
export interface CatalogFormField {
  readonly name: string;
  readonly type?:
    | 'text' | 'email' | 'number' | 'date' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'section';
  readonly required?: boolean;
  readonly options?: readonly string[];
  readonly validation?: CatalogFieldValidation;
  /** Names of `kind:'validation'` rules to enforce on this field. */
  readonly validators?: readonly string[];
}

/**
 * Compile the designer's `SchemaField[]` into a Zod object schema. Total by
 * design — an unknown field type or a bad pattern degrades to a permissive
 * node rather than throwing, so one malformed field can't blank the form.
 */
export function fieldsToZod(
  fields: readonly CatalogFormField[],
  resolveRule?: (name: string) => FieldValidator | undefined,
): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const f of fields) {
    if (!f?.name || f.type === 'section') continue;
    const kind = f.type ?? 'text';
    let node: ZodTypeAny;
    switch (kind) {
      case 'number':
        node = z.number();
        break;
      case 'checkbox':
        node = z.boolean();
        break;
      case 'email':
        node = z.string().email();
        break;
      case 'select':
      case 'radio':
        node = f.options && f.options.length > 0
          ? z.enum(f.options as [string, ...string[]])
          : z.string();
        break;
      case 'text':
      case 'textarea':
      case 'date':
        node = z.string();
        break;
      default:
        node = z.unknown();
    }
    node = applyConstraints(node, f.validation);
    node = applyNamedValidators(node, f.validators, resolveRule);
    if (!f.required) node = node.optional();
    shape[f.name] = node;
  }
  return z.object(shape);
}

/** Fold named `kind:'validation'` rules onto a field as Zod refinements. */
function applyNamedValidators(
  node: ZodTypeAny,
  validators: readonly string[] | undefined,
  resolveRule: ((name: string) => FieldValidator | undefined) | undefined,
): ZodTypeAny {
  if (!validators?.length || !resolveRule) return node;
  let n = node;
  for (const name of validators) {
    const validate = resolveRule(name);
    if (!validate) continue; // rule not (yet) registered — don't block the field
    // An empty optional field passes; the rule only judges a present value.
    n = n.refine(
      (val) => val == null || validate(val) == null,
      (val) => ({ message: validate(val) ?? 'Invalid value' }),
    );
  }
  return n;
}

/** Fold inline constraints onto a string/number node; ignore anything invalid. */
function applyConstraints(node: ZodTypeAny, v: CatalogFieldValidation | undefined): ZodTypeAny {
  if (!v) return node;
  try {
    if (node instanceof z.ZodString) {
      let s = node;
      if (v.minLength != null) s = s.min(v.minLength);
      if (v.maxLength != null) s = s.max(v.maxLength);
      if (v.email) s = s.email();
      if (v.pattern) s = s.regex(new RegExp(v.pattern));
      return s;
    }
    if (node instanceof z.ZodNumber) {
      let n = node;
      if (v.min != null) n = n.min(v.min);
      if (v.max != null) n = n.max(v.max);
      return n;
    }
  } catch {
    // e.g. an invalid regex pattern — keep the unconstrained node.
  }
  return node;
}

/**
 * Resolve the authored action bar. Prefer the new `actions[]`; otherwise map a
 * legacy `submit` target string: `usage-event` (or none) → the synthesized
 * default (undefined → agenticForm adds a plain Submit); any other value is a
 * governed tool name → a Submit that dispatches that tool.
 */
export function resolveActions(
  actions: readonly FormActionDef[] | undefined,
  legacySubmit: string | undefined,
): readonly FormActionDef[] | undefined {
  if (actions && actions.length > 0) return actions;
  if (legacySubmit && legacySubmit !== 'usage-event') {
    return [{ kind: 'tool', label: 'Submit', tool: legacySubmit }];
  }
  return undefined;
}
