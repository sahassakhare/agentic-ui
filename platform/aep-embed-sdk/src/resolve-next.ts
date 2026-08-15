import type { ConditionalNext, WorkflowCondition, WorkflowStepJson } from './types.js';

/**
 * Branch walker — ported verbatim from the runtime lib
 * (`projects/agentic-ui/src/lib/workflow/resolve-next.ts`) but typed against the
 * local, serializable {@link WorkflowStepJson} (no Angular import, and no
 * `(state) => …` function form, which JSON drops). A shared-fixture test keeps
 * the two copies in agreement.
 */

/** True when `next` is the declarative {@link ConditionalNext} data form. */
export function isConditionalNext(next: WorkflowStepJson['next']): next is ConditionalNext {
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
 * Resolve a step's `next` to a concrete target (`string` step id, or `null` for
 * terminal): unconditional string, terminal null, or the declarative
 * {@link ConditionalNext} (first matching branch wins, else `default`).
 */
export function resolveNext(
  next: WorkflowStepJson['next'],
  state: Readonly<Record<string, unknown>>,
): string | null {
  if (next === null) return null;
  if (typeof next === 'string') return next;
  for (const b of next.branches) {
    if (evalWorkflowCondition(b.when, state)) return b.goto;
  }
  return next.default;
}

/** Convenience: look up a step by id in a manifest's workflow. */
export function stepById(steps: readonly WorkflowStepJson[], id: string): WorkflowStepJson | undefined {
  return steps.find((s) => s.id === id);
}
