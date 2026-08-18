/**
 * DMN-style decision table model + a pure evaluator — the runtime copy of the
 * Studio's `decision/decision-eval.ts` (identical, zero imports). Kept local to
 * the Hub so the runtime doesn't cross-import the Studio app. A decision is a
 * governed `kind:'decision'` capability: named inputs → named outputs via rules.
 */
export type DecisionOp = 'any' | '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in';
export type HitPolicy = 'first' | 'unique' | 'collect';
export type DecisionType = 'string' | 'number' | 'boolean' | 'date';

export interface DecisionField { name: string; label?: string; type?: DecisionType }
export interface DecisionCell { op: DecisionOp; value?: string }
export interface DecisionRule { when: Record<string, DecisionCell>; then: Record<string, string>; annotation?: string }

export interface DecisionTable {
  inputs: DecisionField[];
  outputs: DecisionField[];
  rules: DecisionRule[];
  hitPolicy: HitPolicy;
}

export interface DecisionResult {
  outputs: Record<string, string> | null;
  matches: Record<string, string>[];
  matchedRules: number[];
  conflict?: boolean;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

/** Does an input value satisfy a rule cell, honoring the column `type`? */
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
  (table.rules ?? []).forEach((rule, i) => {
    const ok = (table.inputs ?? []).every((inp) => cellMatches(rule.when?.[inp.name], ctx[inp.name], inp.type));
    if (ok) { matches.push({ ...rule.then }); matchedRules.push(i); }
  });
  if (!matches.length) return { outputs: null, matches: [], matchedRules: [] };
  if (table.hitPolicy === 'collect') return { outputs: matches[matches.length - 1], matches, matchedRules };
  const conflict = table.hitPolicy === 'unique' && matches.length > 1;
  return { outputs: matches[0], matches: [matches[0]], matchedRules: [matchedRules[0]], conflict };
}
