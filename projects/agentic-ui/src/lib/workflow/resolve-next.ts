import type { ConditionalNext, DecisionNext, WorkflowCondition, WorkflowStep } from '../types/registry-defs';
import type { DecisionEvaluator } from './decision-evaluator';

/** True when `next` is the declarative {@link ConditionalNext} data form. */
export function isConditionalNext(next: WorkflowStep['next']): next is ConditionalNext {
  return typeof next === 'object' && next !== null && Array.isArray((next as ConditionalNext).branches);
}

/** True when `next` is the {@link DecisionNext} (branch on a governed decision) data form. */
export function isDecisionNext(next: WorkflowStep['next']): next is DecisionNext {
  return typeof next === 'object' && next !== null && typeof (next as DecisionNext).decision === 'string';
}

/** Evaluate one serializable condition against the aggregated workflow state. */
export function evalWorkflowCondition(c: WorkflowCondition, state: Readonly<Record<string, unknown>>): boolean {
  const v = state[c.field];
  switch (c.op) {
    case '==': return v === c.value;
    case '!=': return v !== c.value;
    case 'in': return Array.isArray(c.value) && (c.value as unknown[]).includes(v);
    case 'truthy': return Boolean(v);
    case 'falsy': return !v;
    default: return false;
  }
}

/**
 * Resolve a {@link WorkflowStep.next} to a concrete target (`string` step id, or
 * `null` for terminal), handling every form: unconditional string, terminal
 * null, a `(state)=>…` function, or the declarative {@link ConditionalNext}
 * (first matching branch wins, else `default`). This is the single place the
 * renderer consults, so all four forms behave identically.
 */
export function resolveNext(
  next: WorkflowStep['next'],
  state: Readonly<Record<string, unknown>>,
): string | null {
  if (next === null) return null;
  if (typeof next === 'string') return next;
  if (typeof next === 'function') return next(state);
  // DecisionNext can't evaluate synchronously — fall back to its `default`.
  // `resolveNextAsync` handles the real decision-driven branch.
  if (isDecisionNext(next)) return next.default;
  // ConditionalNext — first matching branch, else default.
  for (const b of next.branches) {
    if (evalWorkflowCondition(b.when, state)) return b.goto;
  }
  return next.default;
}

/**
 * Async variant of {@link resolveNext} that resolves a {@link DecisionNext} by
 * running the host {@link DecisionEvaluator} against the workflow state, then
 * mapping the chosen decision output through `cases` (else `default`). Every
 * non-decision form delegates to the pure synchronous {@link resolveNext}.
 */
export async function resolveNextAsync(
  next: WorkflowStep['next'],
  state: Readonly<Record<string, unknown>>,
  evaluator: DecisionEvaluator,
): Promise<string | null> {
  if (isDecisionNext(next)) {
    const outputs = await evaluator.evaluate(next.decision, state);
    if (outputs) {
      const value = next.output ? outputs[next.output] : Object.values(outputs)[0];
      if (value != null && next.cases[value] != null) return next.cases[value];
    }
    return next.default;
  }
  return resolveNext(next, state);
}
