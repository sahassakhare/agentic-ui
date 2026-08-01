import type { GraphElement } from './experience-graph';

/**
 * An authored workflow step (catalog metadata shape). `next` is a target step
 * id, or empty for a terminal step. The runtime `WorkflowStep` also allows a
 * function-of-state `next`; that isn't authorable in a form, so the studio
 * covers the common string/terminal case.
 */
/** One authored conditional branch: when `field op value` → go to `goto`. */
export interface WorkflowBranchDraft {
  field: string;
  op: '==' | '!=' | 'in' | 'truthy' | 'falsy';
  /** Comparison value (CSV for `in`); ignored for truthy/falsy. */
  value: string;
  goto: string;
}

export interface WorkflowStepDraft {
  id: string;
  widget: string;
  section?: string;
  /** Simple target step id, or '' for terminal. Used when not conditional. */
  next: string;
  /** When true, the step branches on state via {@link branches} + {@link defaultNext}. */
  conditional?: boolean;
  branches?: WorkflowBranchDraft[];
  /** Fallback target when no branch matches; '' → terminal. */
  defaultNext?: string;
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
          next: encodeNext(s),
        })),
    },
  };
}

/** Encode a step's transition: a declarative ConditionalNext when it branches, else a string/null. */
function encodeNext(s: WorkflowStepDraft): unknown {
  const branches = (s.branches ?? []).filter((b) => b.goto && (b.op === 'truthy' || b.op === 'falsy' || b.field));
  if (s.conditional && branches.length) {
    return {
      branches: branches.map((b) => ({
        when: {
          field: b.field,
          op: b.op,
          ...(b.op === 'in'
            ? { value: b.value.split(',').map((v) => v.trim()).filter(Boolean) }
            : b.op === 'truthy' || b.op === 'falsy'
              ? {}
              : { value: coerce(b.value) }),
        },
        goto: b.goto,
      })),
      default: s.defaultNext || null,
    };
  }
  return s.next || null;
}

/** Best-effort scalar coercion so `== true` / `== 3` compare correctly at runtime. */
function coerce(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}
