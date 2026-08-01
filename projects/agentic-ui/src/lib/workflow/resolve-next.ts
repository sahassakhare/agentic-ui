import type { ConditionalNext, WorkflowCondition, WorkflowStep } from '../types/registry-defs';

/** True when `next` is the declarative {@link ConditionalNext} data form. */
export function isConditionalNext(next: WorkflowStep['next']): next is ConditionalNext {
  return typeof next === 'object' && next !== null && Array.isArray((next as ConditionalNext).branches);
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
  // ConditionalNext — first matching branch, else default.
  for (const b of next.branches) {
    if (evalWorkflowCondition(b.when, state)) return b.goto;
  }
  return next.default;
}
