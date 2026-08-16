/**
 * DMN-style decision table model + a pure evaluator. A decision is a first-class
 * governed capability (`kind:'decision'`): named inputs, named outputs, and a set
 * of rules (rows). Workflows/forms reference a decision by name for branching or
 * validation instead of embedding ad-hoc conditions — governed, testable,
 * business-authorable. FEEL is intentionally reduced to a small, safe operator set.
 */
export type DecisionOp = 'any' | '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in';
export type HitPolicy = 'first' | 'unique' | 'collect';
/** Data type of an input/output column. Drives typed comparison + the test panel. */
export type DecisionType = 'string' | 'number' | 'boolean' | 'date';

/** Operators valid for a given column type (drives the designer's op dropdown). */
export function opsForType(type: DecisionType | undefined): DecisionOp[] {
  switch (type) {
    case 'number': return ['any', '==', '!=', '>', '<', '>=', '<=', 'in'];
    case 'date': return ['any', '==', '!=', '>', '<', '>=', '<='];
    case 'boolean': return ['any', '==', '!='];
    default: return ['any', '==', '!=', '>', '<', '>=', '<=', 'in']; // string
  }
}

export interface DecisionField { name: string; label?: string; type?: DecisionType }
/** A cell in a rule: the condition on one input. `any` matches everything. */
export interface DecisionCell { op: DecisionOp; value?: string }
/** One rule (row): input conditions (`when`) → output values (`then`), + optional note. */
export interface DecisionRule { when: Record<string, DecisionCell>; then: Record<string, string>; annotation?: string }

export interface DecisionTable {
  inputs: DecisionField[];
  outputs: DecisionField[];
  rules: DecisionRule[];
  hitPolicy: HitPolicy;
}

export interface DecisionResult {
  /** Outputs of the first/unique match (hit policies first|unique), or the last collected. */
  outputs: Record<string, string> | null;
  /** All matches (hit policy collect). */
  matches: Record<string, string>[];
  matchedRules: number[];
  /** True when hitPolicy='unique' but more than one rule matched (author error). */
  conflict?: boolean;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

/**
 * Does an input value satisfy a rule cell, honoring the column `type`?
 * `number`/`date`/`boolean` use typed comparison; `string`/undefined keeps the
 * original behavior (string equality/in, numeric coercion for `>`/`<`) so existing
 * untyped decisions evaluate identically.
 */
export function cellMatches(cell: DecisionCell | undefined, value: unknown, type?: DecisionType): boolean {
  if (!cell || cell.op === 'any' || cell.value === undefined || cell.value === '') return true;
  const cv = cell.value;
  if (type === 'number') {
    const a = Number(value), b = Number(cv);
    if (cell.op === 'in') return cv.split(/[\s,]+/).filter(Boolean).map(Number).some((n) => n === a);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    switch (cell.op) {
      case '==': return a === b; case '!=': return a !== b;
      case '>': return a > b; case '<': return a < b; case '>=': return a >= b; case '<=': return a <= b;
      default: return false;
    }
  }
  if (type === 'date') {
    const a = Date.parse(String(value)), b = Date.parse(cv);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    switch (cell.op) {
      case '==': return a === b; case '!=': return a !== b;
      case '>': return a > b; case '<': return a < b; case '>=': return a >= b; case '<=': return a <= b;
      default: return false;
    }
  }
  if (type === 'boolean') {
    const a = toBool(value), b = toBool(cv);
    return cell.op === '!=' ? a !== b : a === b;
  }
  // string / undefined — original behavior (unchanged for back-compat).
  const sv = value == null ? '' : String(value);
  switch (cell.op) {
    case '==': return sv === cv;
    case '!=': return sv !== cv;
    case 'in': return cv.split(/[\s,]+/).filter(Boolean).includes(sv);
    case '>': case '<': case '>=': case '<=': {
      const a = Number(value), b = Number(cv);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return cell.op === '>' ? a > b : cell.op === '<' ? a < b : cell.op === '>=' ? a >= b : a <= b;
    }
    default: return false;
  }
}

/** Evaluate a decision table against an input context. */
export function evaluateDecision(table: DecisionTable, ctx: Record<string, unknown>): DecisionResult {
  const matches: Record<string, string>[] = [];
  const matchedRules: number[] = [];
  table.rules.forEach((rule, i) => {
    const ok = table.inputs.every((inp) => cellMatches(rule.when[inp.name], ctx[inp.name], inp.type));
    if (ok) { matches.push({ ...rule.then }); matchedRules.push(i); }
  });
  if (!matches.length) return { outputs: null, matches: [], matchedRules: [] };
  if (table.hitPolicy === 'collect') return { outputs: matches[matches.length - 1], matches, matchedRules };
  // first | unique → the first match wins. `unique` additionally flags a conflict
  // when the author's rules were not disjoint (more than one matched).
  const conflict = table.hitPolicy === 'unique' && matches.length > 1;
  return { outputs: matches[0], matches: [matches[0]], matchedRules: [matchedRules[0]], conflict };
}
