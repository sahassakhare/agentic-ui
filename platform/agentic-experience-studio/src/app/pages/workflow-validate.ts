/**
 * Static validation for an authored workflow graph — surfaced in the Workflow
 * Designer before save so authoring errors (dead branch targets, unreachable
 * steps, non-terminating loops) are caught in the Studio rather than silently
 * dropped by the runtime bridge (which rejects a malformed graph). Pure +
 * dependency-light so it's unit-testable.
 */
import type { JourneyFlowStep } from '../journey-flow.component';

export interface WorkflowIssue {
  level: 'error' | 'warn';
  message: string;
  stepId?: string;
}

/** The step ids a step can transition to (string next, or branch gotos + default). */
function targetsOf(step: JourneyFlowStep): string[] {
  const n = step.next;
  if (n == null) return [];
  if (typeof n === 'string') return [n];
  if (typeof n === 'function') return []; // dynamic — can't statically resolve
  const out = n.branches.map((b) => b.goto).filter(Boolean);
  if (n.default) out.push(n.default);
  return out;
}

/** Validate the resolved step graph; returns errors + warnings (empty = clean). */
export function validateWorkflow(steps: readonly JourneyFlowStep[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (!steps.length) return issues;

  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) issues.push({ level: 'error', message: `Duplicate step id “${s.id}”`, stepId: s.id });
    ids.add(s.id);
  }
  for (const s of steps) {
    if (!s.widget) issues.push({ level: 'error', message: `Step “${s.section || s.id}” has no component/form`, stepId: s.id });
  }
  // Dangling transition targets.
  for (const s of steps) {
    for (const t of targetsOf(s)) {
      if (!ids.has(t)) issues.push({ level: 'error', message: `Step “${s.section || s.id}” points at unknown step “${t}”`, stepId: s.id });
    }
  }
  // Reachability from the first step.
  const reachable = new Set<string>();
  const stack = [steps[0].id];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const st = steps.find((x) => x.id === id);
    if (st) for (const t of targetsOf(st)) if (ids.has(t)) stack.push(t);
  }
  for (const s of steps) {
    if (!reachable.has(s.id)) issues.push({ level: 'warn', message: `Step “${s.section || s.id}” is unreachable`, stepId: s.id });
  }
  // At least one reachable terminal (a step with no outgoing target).
  const anyTerminal = steps.some((s) => reachable.has(s.id) && targetsOf(s).length === 0);
  if (!anyTerminal) issues.push({ level: 'warn', message: 'No reachable end — the journey never terminates (possible loop).' });

  return issues;
}
