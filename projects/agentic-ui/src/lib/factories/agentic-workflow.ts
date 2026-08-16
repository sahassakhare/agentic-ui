import { z, type ZodTypeAny } from 'zod';
import type {
  ConditionalNext,
  FormDef,
  WorkflowCtx,
  WorkflowDef,
  WorkflowStep,
} from '../types/registry-defs';

/** A step's `next` is a declarative branch object (vs a string/null/function). */
function isConditionalNext(next: unknown): next is ConditionalNext {
  return typeof next === 'object' && next !== null && Array.isArray((next as ConditionalNext).branches);
}

/**
 * Configuration accepted by {@link agenticWorkflow}.
 *
 * Provisional surface (r3 plan §9.3.3) — workflow definitions register
 * through `FormRegistry` for now; promotion to a top-level
 * `WorkflowRegistry` is an ARB decision at F3 exit. This factory keeps
 * the call shape stable across that decision.
 */
export interface AgenticWorkflowConfig {
  readonly name: string;
  readonly description?: string;
  readonly steps: readonly WorkflowStep[];
  readonly onComplete: (
    state: Readonly<Record<string, unknown>>,
    ctx: WorkflowCtx,
  ) => Promise<unknown>;
}

/**
 * Thrown when the workflow's step graph is malformed at registration time
 * (per AC-F1-3-style early surfacing). Catches duplicate step ids, empty
 * step arrays, and `next` strings that don't reference a real step.
 */
export class AgenticWorkflowError extends Error {
  constructor(
    message: string,
    public readonly workflowName: string,
    public readonly stepId?: string,
  ) {
    super(stepId ? `[${workflowName}] step '${stepId}': ${message}` : `[${workflowName}] ${message}`);
    this.name = 'AgenticWorkflowError';
  }
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Permissive passthrough schema synthesized for workflow forms. Each
 * step widget validates its own propsSchema independently.
 */
const WORKFLOW_FIELDS_SCHEMA: ZodTypeAny = z.record(z.string(), z.unknown());

function validateStep(step: WorkflowStep, workflowName: string): void {
  if (typeof step !== 'object' || step === null) {
    throw new AgenticWorkflowError('Step must be an object', workflowName);
  }
  if (typeof step.id !== 'string' || !IDENTIFIER_RE.test(step.id)) {
    throw new AgenticWorkflowError(
      `Step id ${JSON.stringify(step.id)} is not a valid identifier`,
      workflowName,
    );
  }
  if (typeof step.widget !== 'string' || !IDENTIFIER_RE.test(step.widget)) {
    throw new AgenticWorkflowError(
      `Step widget ${JSON.stringify(step.widget)} is not a valid registered name`,
      workflowName,
      step.id,
    );
  }
  if (
    step.next !== null &&
    typeof step.next !== 'string' &&
    typeof step.next !== 'function' &&
    !isConditionalNext(step.next)
  ) {
    throw new AgenticWorkflowError(
      "Step `next` must be a string, null, a function, or a { branches, default } object",
      workflowName,
      step.id,
    );
  }
}

/**
 * Factory for workflow form definitions (Capability F3 — provisional).
 *
 * Synthesizes a `FormDef` with `workflow` metadata; `submit` is a no-op
 * shim because workflow renderers run `workflow.onComplete` on terminal
 * step Next instead of routing through `submit`. The synthesized
 * `fieldsSchema` is a permissive passthrough — per-step widgets validate
 * their own props.
 *
 * Validates at registration time:
 *   - non-empty `steps` array
 *   - unique step ids (per workflow)
 *   - every string `next` target references a real step
 *   - widget + id identifier shapes
 *
 * Throws {@link AgenticWorkflowError} on any of the above before any UI mounts.
 */
export function agenticWorkflow(config: AgenticWorkflowConfig): FormDef {
  if (!Array.isArray(config.steps) || config.steps.length === 0) {
    throw new AgenticWorkflowError('Workflow must contain at least one step', config.name);
  }

  const seen = new Set<string>();
  for (const step of config.steps) {
    validateStep(step, config.name);
    if (seen.has(step.id)) {
      throw new AgenticWorkflowError(
        `Duplicate step id ${JSON.stringify(step.id)}`,
        config.name,
        step.id,
      );
    }
    seen.add(step.id);
  }

  // Verify string / branch `next` targets reference real steps. Function-`next`
  // is dynamic — its result is validated at transition time by the
  // workflow renderer, which surfaces a clear error then.
  for (const step of config.steps) {
    if (typeof step.next === 'string' && !seen.has(step.next)) {
      throw new AgenticWorkflowError(
        `Step \`next\` references unknown step ${JSON.stringify(step.next)}`,
        config.name,
        step.id,
      );
    } else if (isConditionalNext(step.next)) {
      for (const branch of step.next.branches) {
        if (typeof branch.goto !== 'string' || !seen.has(branch.goto)) {
          throw new AgenticWorkflowError(
            `Branch \`goto\` references unknown step ${JSON.stringify(branch.goto)}`,
            config.name,
            step.id,
          );
        }
      }
      if (step.next.default !== null && !seen.has(step.next.default)) {
        throw new AgenticWorkflowError(
          `Branch \`default\` references unknown step ${JSON.stringify(step.next.default)}`,
          config.name,
          step.id,
        );
      }
    }
  }

  const workflow: WorkflowDef = {
    steps: config.steps,
    onComplete: config.onComplete,
  };

  return {
    name: config.name,
    description: config.description ?? '',
    fieldsSchema: WORKFLOW_FIELDS_SCHEMA,
    workflow,
    // submit is unused in workflow mode — provide a Promise-returning shim
    // to honour the FormDef contract for any caller that introspects.
    submit: async () => undefined,
  };
}
