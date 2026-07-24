import type { GraphElement } from './experience-graph';

/**
 * An authored workflow step (catalog metadata shape). `next` is a target step
 * id, or empty for a terminal step. The runtime `WorkflowStep` also allows a
 * function-of-state `next`; that isn't authorable in a form, so the studio
 * covers the common string/terminal case.
 */
export interface WorkflowStepDraft {
  id: string;
  widget: string;
  section?: string;
  /** Target step id, or '' for terminal. */
  next: string;
}

/**
 * Pure converter: a workflow's steps → cytoscape dependency-graph elements for
 * the live preview. Nodes are steps (the first step is the `root`; terminals
 * are `matched`, others neutral `unmet`→used only for colour). Edges follow
 * `next`; an edge to an unknown id renders as a dangling target node so typos
 * are visible.
 */
export function buildWorkflowGraphElements(steps: readonly WorkflowStepDraft[]): GraphElement[] {
  const els: GraphElement[] = [];
  const ids = new Set(steps.map((s) => s.id).filter(Boolean));
  const seen = new Set<string>();

  steps.forEach((step, i) => {
    if (!step.id) return;
    if (!seen.has(step.id)) {
      seen.add(step.id);
      const terminal = !step.next;
      els.push({
        group: 'nodes',
        data: {
          id: step.id,
          label: step.section ? `${step.id} · ${step.section}` : step.id,
          kind: step.widget || 'step',
          state: i === 0 ? 'root' : terminal ? 'matched' : 'unmet',
        },
        classes: i === 0 ? 'root' : terminal ? 'matched' : 'unmet',
      });
    }
    if (step.next) {
      const targetKnown = ids.has(step.next);
      if (!targetKnown && !seen.has(step.next)) {
        seen.add(step.next);
        els.push({
          group: 'nodes',
          data: { id: step.next, label: `${step.next} (?)`, kind: 'missing', state: 'unmet' },
          classes: 'unmet',
        });
      }
      els.push({
        group: 'edges',
        data: { id: `${step.id}->${step.next}`, source: step.id, target: step.next, optional: false },
        classes: 'required',
      });
    }
  });

  return els;
}

/** Serialize step drafts into the catalog body payload for a workflow capability. */
export function stepsToWorkflowBody(steps: readonly WorkflowStepDraft[]): Record<string, unknown> {
  return {
    workflow: {
      steps: steps
        .filter((s) => s.id && s.widget)
        .map((s) => ({
          id: s.id,
          widget: s.widget,
          ...(s.section ? { section: s.section } : {}),
          next: s.next || null,
        })),
    },
  };
}
