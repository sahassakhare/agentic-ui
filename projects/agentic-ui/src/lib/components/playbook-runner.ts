import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  Signal,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ToolRegistry } from '../registries/tool-registry';
import { AGENTIC_TELEMETRY_SINK, type AgenticTelemetrySink } from '../telemetry/telemetry-sink';
import type {
  PlaybookDef,
  PlaybookRun,
  PlaybookStep,
  PlaybookStepState,
} from '../types/registry-defs';

/**
 * Handle to an in-flight playbook run. Hosts subscribe to `state`
 * (a `Signal<PlaybookRun>`) to drive UI and call `cancel()` /
 * `approve()` / `skip()` to drive the run.
 */
export interface RunningPlaybook {
  /** Live snapshot of the run. */
  readonly state: Signal<PlaybookRun>;
  /** Promise that resolves when the run reaches a terminal state. */
  readonly done: Promise<PlaybookRun>;
  /** Halt the run as soon as the currently-running step (if any) finishes. */
  cancel(): void;
  /**
   * Approve the step that is currently `awaiting-approval`. No-op
   * when no step is awaiting approval.
   */
  approve(): void;
  /**
   * Skip the step that is currently `awaiting-approval` (record it as
   * `skipped` and advance). No-op when no step is awaiting approval.
   */
  skip(): void;
}

/**
 * Fires a `PlaybookDef`'s steps in order, capturing each step's
 * result + duration into a live `PlaybookRun` snapshot. Hosts bind
 * the snapshot signal to `<mvk-playbook-runner [run]="...">` for UI.
 *
 * Persona scope flows through `ToolRegistry.get()` automatically —
 * if the active persona can't see a step's tool, the runner records
 * the step as `failed` with a "tool not visible to this persona"
 * message and aborts (unless `step.continueOnError`).
 *
 * Every step fire is a separate tool invocation, so the chain-hash
 * audit naturally captures *playbook + step index + tool + args +
 * result* via the existing telemetry sink. Opposing counsel can
 * reconstruct the playbook's full trajectory.
 *
 * @see [post-chat-surfaces-plan §4 Workflow G](../../../../docs/plans/post-chat-surfaces-plan.md#4-complex-workflows-worth-modelling)
 *
 * @example
 * ```ts
 * const runner = inject(PlaybookRunner);
 * const def = inject(PlaybookRegistry).get('initial-privilege-pass')!;
 * const handle = runner.start(def);
 *
 * effect(() => {
 *   const run = handle.state();
 *   if (run.overall === 'success') console.log('done', run);
 * });
 *
 * // Or await directly:
 * const final = await handle.done;
 * ```
 */
@Injectable({ providedIn: 'root' })
export class PlaybookRunner {
  private readonly tools = inject(ToolRegistry);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);

  start(def: PlaybookDef): RunningPlaybook {
    const startedAt = new Date().toISOString();
    const initialSteps: PlaybookStepState[] = def.steps.map((s) => ({
      stepId: s.id,
      status: s.requiresApproval ? ('awaiting-approval' as const) : ('pending' as const),
    }));
    const state = signal<PlaybookRun>({
      playbookName: def.name,
      version: def.version,
      startedAt,
      steps: initialSteps,
      overall: 'running',
    });

    let cancelRequested = false;
    let approveResolver: ((decision: 'approve' | 'skip') => void) | null = null;

    const cancel = (): void => {
      cancelRequested = true;
      // If the loop is paused on an approval, resolve immediately as skip.
      if (approveResolver) {
        approveResolver('skip');
        approveResolver = null;
      }
    };

    const approve = (): void => {
      if (approveResolver) {
        approveResolver('approve');
        approveResolver = null;
      }
    };

    const skip = (): void => {
      if (approveResolver) {
        approveResolver('skip');
        approveResolver = null;
      }
    };

    const waitForApproval = (): Promise<'approve' | 'skip'> =>
      new Promise((resolve) => {
        approveResolver = resolve;
      });

    const done: Promise<PlaybookRun> = (async () => {
      for (let i = 0; i < def.steps.length; i++) {
        if (cancelRequested) {
          state.update((r) => withTrailingCancelled(r, i));
          break;
        }
        const step = def.steps[i]!;

        if (step.requiresApproval) {
          // Mark this step awaiting + others ahead as pending. Wait.
          state.update((r) => withStepStatus(r, i, 'awaiting-approval'));
          const decision = await waitForApproval();
          if (cancelRequested) {
            state.update((r) => withTrailingCancelled(r, i));
            break;
          }
          if (decision === 'skip') {
            state.update((r) =>
              withStepUpdate(r, i, {
                status: 'skipped',
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
              }),
            );
            continue;
          }
          // fall through to invoke
        }

        state.update((r) =>
          withStepUpdate(r, i, { status: 'running', startedAt: new Date().toISOString() }),
        );

        const outcome = await invokeStep(this.tools, this.telemetry, def, i, step);

        if (outcome.kind === 'success') {
          state.update((r) =>
            withStepUpdate(r, i, {
              status: 'success',
              result: outcome.result,
              finishedAt: new Date().toISOString(),
            }),
          );
        } else {
          state.update((r) =>
            withStepUpdate(r, i, {
              status: 'failed',
              error: outcome.error,
              finishedAt: new Date().toISOString(),
            }),
          );
          if (!step.continueOnError) {
            // Mark remaining steps as cancelled.
            state.update((r) => withTrailingCancelled(r, i + 1));
            break;
          }
        }
      }

      // Compute the overall status from the final step states.
      state.update((r) => ({ ...r, overall: overallFrom(r.steps, cancelRequested) }));
      return state();
    })();

    return { state, done, cancel, approve, skip };
  }
}

interface StepSuccess { readonly kind: 'success'; readonly result: unknown }
interface StepFailure { readonly kind: 'failure'; readonly error: string }

async function invokeStep(
  tools: ToolRegistry,
  telemetry: AgenticTelemetrySink,
  def: PlaybookDef,
  index: number,
  step: PlaybookStep,
): Promise<StepSuccess | StepFailure> {
  const toolDef = tools.get(step.tool);
  if (!toolDef) {
    telemetry.emit('agentic.tool_call.end', {
      'agentic.tool.name': step.tool,
      'agentic.tool.origin': 'playbook',
      'agentic.playbook.name': def.name,
      'agentic.playbook.step.id': step.id,
      'agentic.playbook.step.index': index,
      'agentic.tool.success': false,
    });
    return { kind: 'failure', error: `Tool "${step.tool}" not visible to this persona` };
  }

  const span = telemetry.startSpan('agentic.tool_call.start', {
    'agentic.tool.name': step.tool,
    'agentic.tool.origin': 'playbook',
    'agentic.playbook.name': def.name,
    'agentic.playbook.version': def.version ?? '',
    'agentic.playbook.step.id': step.id,
    'agentic.playbook.step.index': index,
  });
  try {
    const ctx = buildPlaybookToolContext(def, index);
    const result = await toolDef.handler(step.args, ctx);
    span.end({ 'agentic.tool.success': true });
    return { kind: 'success', result };
  } catch (err) {
    span.recordError(err);
    span.end({ 'agentic.tool.success': false });
    return { kind: 'failure', error: err instanceof Error ? err.message : String(err) };
  }
}

function withStepStatus(run: PlaybookRun, index: number, status: PlaybookStepState['status']): PlaybookRun {
  return withStepUpdate(run, index, { status });
}

function withStepUpdate(
  run: PlaybookRun,
  index: number,
  patch: Partial<PlaybookStepState>,
): PlaybookRun {
  const steps = run.steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
  return { ...run, steps };
}

function withTrailingCancelled(run: PlaybookRun, startIndex: number): PlaybookRun {
  const steps = run.steps.map((s, i) =>
    i < startIndex || s.status === 'success' || s.status === 'failed' || s.status === 'skipped'
      ? s
      : { ...s, status: 'cancelled' as const },
  );
  return { ...run, steps };
}

function overallFrom(steps: readonly PlaybookStepState[], cancelRequested: boolean): PlaybookRun['overall'] {
  if (cancelRequested && steps.some((s) => s.status === 'cancelled')) return 'cancelled';
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  if (steps.every((s) => s.status === 'success' || s.status === 'skipped')) return 'success';
  return 'running';
}

function buildPlaybookToolContext(def: PlaybookDef, stepIndex: number): never {
  return {
    threadId: `playbook:${def.name}:${def.version ?? '-'}`,
    runId: `playbook-run-${def.name}-${Date.now()}`,
    toolCallId: `playbook-call-${def.name}-${stepIndex}-${Date.now()}`,
    signal: new AbortController().signal,
    startOperation: () => `playbook-op-${Date.now()}`,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  } as never;
}

/** Step-level event emitted by the runner UI when the user clicks an action. */
export interface PlaybookRunnerAction {
  readonly action: 'cancel' | 'approve' | 'skip';
}

/**
 * Renders a `PlaybookRun` snapshot — Pillar 3 P5 of
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Step-by-step progress list with per-step status icons + collapsible
 * result snippets. Approve / Skip / Cancel buttons surface contextually:
 *
 * - **Approve / Skip** show when any step is `awaiting-approval`.
 * - **Cancel** shows while the overall status is `running`.
 *
 * Dispatch-agnostic same as every other surface — emits typed
 * `(action)` events; host calls the matching method on its
 * `RunningPlaybook` handle (`approve()` / `skip()` / `cancel()`).
 *
 * @example
 * ```ts
 * @Component({
 *   imports: [PlaybookRunnerComponent],
 *   template: `
 *     <mvk-playbook-runner
 *       [run]="handle.state()"
 *       (action)="onAction($event)" />
 *   `,
 * })
 * class MyPage {
 *   readonly handle = inject(PlaybookRunner).start(this.def);
 *   onAction(ev: PlaybookRunnerAction): void {
 *     switch (ev.action) {
 *       case 'cancel':  this.handle.cancel(); return;
 *       case 'approve': this.handle.approve(); return;
 *       case 'skip':    this.handle.skip(); return;
 *     }
 *   }
 * }
 * ```
 */
@Component({
  selector: 'mvk-playbook-runner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (run(); as r) {
      <section class="runner" [attr.data-status]="r.overall" aria-label="Playbook runner">
        <header class="head">
          <h3 class="title">{{ r.playbookName }}</h3>
          @if (r.version) {
            <span class="ver">{{ r.version }}</span>
          }
          <span class="status-pill" [attr.data-status]="r.overall">{{ overallLabel() }}</span>
          @if (r.overall === 'running') {
            <button type="button" class="cancel-btn" (click)="emit('cancel')">Cancel</button>
          }
        </header>

        <ol class="steps" role="list">
          @for (s of r.steps; track s.stepId; let i = $index) {
            <li class="step" [attr.data-status]="s.status">
              <span class="bullet" [attr.data-status]="s.status" aria-hidden="true">{{ bullet(s.status) }}</span>
              <div class="step-body">
                <header class="step-head">
                  <span class="step-title">{{ titleFor(i) }}</span>
                  <span class="step-status" [attr.data-status]="s.status">{{ statusLabel(s.status) }}</span>
                </header>
                @if (s.error) {
                  <p class="error">{{ s.error }}</p>
                }
                @if (s.status === 'success' && hasResult(s)) {
                  <details class="result">
                    <summary>Result</summary>
                    <pre>{{ stringifyResult(s.result) }}</pre>
                  </details>
                }
                @if (s.status === 'awaiting-approval') {
                  <div class="approval" role="group" aria-label="Step approval">
                    <button type="button" class="approve-btn" (click)="emit('approve')">Approve</button>
                    <button type="button" class="skip-btn" (click)="emit('skip')">Skip</button>
                  </div>
                }
              </div>
            </li>
          }
        </ol>
      </section>
    } @else {
      <section class="runner empty">No run.</section>
    }
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; }
    .runner {
      background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem;
      padding: 0.9rem 1.1rem; font-size: 0.9rem;
    }
    .runner.empty { color: #9ca3af; padding: 2rem; text-align: center; }
    .runner[data-status="success"] { border-color: #86efac; }
    .runner[data-status="failed"] { border-color: #fca5a5; }
    .runner[data-status="cancelled"] { border-color: #fcd34d; }
    .head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.7rem; }
    .title { margin: 0; font-size: 1rem; font-weight: 700; color: #111827; }
    .ver { color: #6b7280; font-family: ui-monospace, monospace; font-size: 0.78rem; }
    .status-pill {
      padding: 0.1rem 0.55rem; border-radius: 999px;
      background: #e5e7eb; color: #4b5563;
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .status-pill[data-status="running"] { background: #dbeafe; color: #1e40af; }
    .status-pill[data-status="success"] { background: #dcfce7; color: #166534; }
    .status-pill[data-status="failed"] { background: #fee2e2; color: #991b1b; }
    .status-pill[data-status="cancelled"] { background: #fef3c7; color: #92400e; }
    .cancel-btn {
      margin-left: auto;
      padding: 0.3rem 0.7rem; font: inherit; font-size: 0.75rem; font-weight: 600;
      background: white; border: 1px solid #e5e7eb; border-radius: 0.35rem;
      color: #4b5563; cursor: pointer;
    }
    .cancel-btn:hover { background: #f3f4f6; }
    .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .step { display: grid; grid-template-columns: 1.5rem 1fr; gap: 0.6rem; align-items: start; padding: 0.4rem 0; }
    .step + .step { border-top: 1px solid #f3f4f6; padding-top: 0.55rem; }
    .bullet {
      display: inline-flex; align-items: center; justify-content: center;
      width: 1.5rem; height: 1.5rem; border-radius: 50%;
      background: #e5e7eb; color: #6b7280;
      font-size: 0.75rem; font-weight: 700;
    }
    .bullet[data-status="running"] { background: #2563eb; color: white; animation: pulse 1.6s ease-in-out infinite; }
    .bullet[data-status="success"] { background: #16a34a; color: white; }
    .bullet[data-status="failed"] { background: #dc2626; color: white; }
    .bullet[data-status="cancelled"] { background: #fbbf24; color: white; }
    .bullet[data-status="awaiting-approval"] { background: #f59e0b; color: white; }
    .bullet[data-status="skipped"] { background: #d1d5db; color: white; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 4px rgba(37, 99, 235, 0); } }
    .step-body { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
    .step-head { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
    .step-title { font-weight: 600; color: #111827; font-size: 0.9rem; }
    .step-status {
      padding: 0.05rem 0.45rem; border-radius: 999px;
      font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
      background: #f3f4f6; color: #4b5563;
    }
    .step-status[data-status="success"] { background: #dcfce7; color: #166534; }
    .step-status[data-status="failed"]  { background: #fee2e2; color: #991b1b; }
    .step-status[data-status="running"] { background: #dbeafe; color: #1e40af; }
    .step-status[data-status="awaiting-approval"] { background: #fef3c7; color: #92400e; }
    .step-status[data-status="cancelled"] { background: #fef3c7; color: #92400e; }
    .error { margin: 0.15rem 0 0; color: #991b1b; font-size: 0.8rem; }
    .result { font-size: 0.82rem; }
    .result summary { cursor: pointer; color: #4b5563; }
    .result pre {
      margin: 0.3rem 0 0; padding: 0.5rem 0.7rem;
      background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0.35rem;
      overflow: auto; font-size: 0.75rem; line-height: 1.4;
    }
    .approval { display: flex; gap: 0.35rem; margin-top: 0.35rem; }
    .approve-btn, .skip-btn {
      padding: 0.3rem 0.7rem; font: inherit; font-size: 0.78rem; font-weight: 600;
      border-radius: 0.35rem; cursor: pointer; border: 0;
    }
    .approve-btn { background: #16a34a; color: white; }
    .approve-btn:hover { background: #15803d; }
    .skip-btn { background: white; color: #4b5563; border: 1px solid #e5e7eb; }
    .skip-btn:hover { background: #f3f4f6; }
  `,
})
export class PlaybookRunnerComponent {
  /** The run snapshot to render. Pass `handle.state()` from `PlaybookRunner.start`. */
  readonly run = input<PlaybookRun | null>(null);

  /**
   * Optional per-step title override map (`stepId` → human-readable
   * title). Falls back to the step id when omitted.
   */
  readonly stepTitles = input<Readonly<Record<string, string>>>({});

  /** Emits when the user clicks a control. Host calls the matching handle method. */
  readonly action = output<PlaybookRunnerAction>();

  protected readonly overallLabel = computed(() => {
    const r = this.run();
    if (!r) return '';
    return r.overall.toUpperCase();
  });

  protected statusLabel(status: PlaybookStepState['status']): string {
    if (status === 'awaiting-approval') return 'NEEDS APPROVAL';
    return status.toUpperCase();
  }

  protected bullet(status: PlaybookStepState['status']): string {
    switch (status) {
      case 'success': return '✓';
      case 'failed': return '✗';
      case 'cancelled': return '⊘';
      case 'awaiting-approval': return '?';
      case 'running': return '●';
      case 'skipped': return '→';
      case 'pending':
      default: return '○';
    }
  }

  protected titleFor(index: number): string {
    const r = this.run();
    if (!r) return '';
    const step = r.steps[index];
    if (!step) return '';
    return this.stepTitles()[step.stepId] ?? step.stepId;
  }

  protected hasResult(s: PlaybookStepState): boolean {
    return s.result !== undefined && s.result !== null;
  }

  protected stringifyResult(value: unknown): string {
    if (value === undefined) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  protected emit(kind: 'cancel' | 'approve' | 'skip'): void {
    this.action.emit({ action: kind });
  }
}
