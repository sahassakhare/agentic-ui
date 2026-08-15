/**
 * DMN-style decision table model + a pure evaluator. A decision is a first-class
 * governed capability (`kind:'decision'`): named inputs, named outputs, and a set
 * of rules (rows). Workflows/forms reference a decision by name for branching or
 * validation instead of embedding ad-hoc conditions — governed, testable,
 * business-authorable. FEEL is intentionally reduced to a small, safe operator set.
 */
export type DecisionOp = 'any' | '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in';
export type HitPolicy = 'first' | 'unique' | 'collect';

export interface DecisionField { name: string; label?: string }
/** A cell in a rule: the condition on one input. `any` matches everything. */
export interface DecisionCell { op: DecisionOp; value?: string }
/** One rule (row): input conditions (`when`) → output values (`then`). */
export interface DecisionRule { when: Record<string, DecisionCell>; then: Record<string, string> }

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
}

/** Does an input value satisfy a rule cell? Numbers compared numerically when possible. */
export function cellMatches(cell: DecisionCell | undefined, value: unknown): boolean {
  if (!cell || cell.op === 'any' || cell.value === undefined || cell.value === '') return true;
  const sv = value == null ? '' : String(value);
  const cv = cell.value;
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
    const ok = table.inputs.every((inp) => cellMatches(rule.when[inp.name], ctx[inp.name]));
    if (ok) { matches.push({ ...rule.then }); matchedRules.push(i); }
  });
  if (!matches.length) return { outputs: null, matches: [], matchedRules: [] };
  if (table.hitPolicy === 'collect') return { outputs: matches[matches.length - 1], matches, matchedRules };
  // first | unique → the first match wins (unique assumes the author kept rules disjoint)
  return { outputs: matches[0], matches: [matches[0]], matchedRules: [matchedRules[0]] };
}
