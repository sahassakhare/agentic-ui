import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  type Type,
} from '@angular/core';
import {
  AGENTIC_TELEMETRY_SINK,
  COMPOSITION_SLOT,
  ComponentRegistry,
  CompositionStore,
  FormRegistry,
  type FormDef,
  type WorkflowStep,
} from '../internal';

/**
 * Renders a multi-step workflow form by name (Capability F3 — provisional,
 * r3 plan §9.3). Mounts one step's widget at a time, drives transitions
 * via Back / Next controls, and aggregates state across steps in a
 * renderer-scoped `CompositionStore` keyed by step id.
 *
 * Inputs:
 *  - `formName` — name of a `FormDef` registered with `FormRegistry` whose
 *    `workflow` field is set (factory: {@link agenticWorkflow}).
 *  - `initialStepId?` — optional override for the starting step. Defaults
 *    to the first step in the workflow's `steps` array.
 *
 * Composition contract reuse: each step widget is mounted with a per-step
 * child injector providing `COMPOSITION_SLOT` set to the step id, so
 * widgets that follow the F1 contract (read/write through `inject(
 * CompositionStore)`) work without modification.
 *
 * Step transitions use `WorkflowStep.next`:
 *   - `string` → unconditional advance to that step.
 *   - `null`   → terminal step; Next runs `WorkflowDef.onComplete` with
 *     the aggregated store snapshot.
 *   - function → branches on the snapshot; result is validated against
 *     the step graph at transition time (an unknown id surfaces an error).
 */
@Component({
  selector: 'mvk-workflow-renderer',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CompositionStore],
  template: `
    @if (form(); as f) {
      @if (f.workflow; as wf) {
        @if (completed()) {
          <p class="completed">Workflow "{{ f.name }}" complete.</p>
        } @else if (currentStep(); as step) {
          <ol class="breadcrumb" aria-label="Workflow steps">
            @for (s of wf.steps; track s.id) {
              <li class="crumb"
                  [class.active]="s.id === step.id"
                  [class.done]="isVisited(s.id)">
                {{ s.section || s.id }}
              </li>
            }
          </ol>
          @if (step.section) {
            <h3 class="step-heading">{{ step.section }}</h3>
          }
          @if (currentComponent(); as comp) {
            <div class="step-body">
              <ng-container *ngComponentOutlet="comp; injector: currentInjector()" />
            </div>
          } @else {
            <p class="missing">Unknown widget: {{ step.widget }}</p>
          }
          @if (errorMessage(); as err) {
            <p class="error" role="alert">{{ err }}</p>
          }
          <div class="controls">
            <button type="button" [disabled]="!canGoBack() || submitting()" (click)="back()">Back</button>
            <button type="button" class="primary" [disabled]="submitting() || !currentComponent()" (click)="next()">
              {{ isTerminalStep() ? (submitting() ? 'Submitting…' : 'Submit') : 'Next' }}
            </button>
          </div>
        }
      } @else {
        <p class="missing">Form "{{ f.name }}" is not a workflow.</p>
      }
    } @else {
      <p class="missing">Workflow "{{ formName() }}" is not registered.</p>
    }
  `,
  styles: `
    :host { display: block; padding: 0.5rem; }
    .breadcrumb { display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0; margin: 0 0 0.6rem; list-style: none; }
    .crumb { padding: 0.2rem 0.6rem; border-radius: 999px; background: #f3f4f6; color: #6b7280; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .crumb.done { background: #dcfce7; color: #166534; }
    .crumb.active { background: #2563eb; color: #fff; }
    .step-heading { margin: 0 0 0.4rem; font-size: 0.95rem; }
    .step-body { padding: 0.4rem 0; }
    .controls { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
    button { padding: 0.4rem 0.9rem; border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 0.3rem; cursor: pointer; font: inherit; }
    button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .missing { padding: 0.4rem; background: #fef3c7; color: #92400e; border-radius: 0.3rem; font-size: 0.85rem; }
    .error { padding: 0.4rem 0.6rem; background: #fee2e2; color: #991b1b; border-radius: 0.3rem; font-size: 0.85rem; }
    .completed { padding: 0.5rem 0.7rem; background: #d1fae5; color: #065f46; border-radius: 0.4rem; font-size: 0.9rem; font-weight: 500; }
  `,
})
export class WorkflowRendererComponent {
  readonly formName = input.required<string>();
  readonly initialStepId = input<string | undefined>(undefined);

  private readonly forms = inject(FormRegistry);
  private readonly components = inject(ComponentRegistry);
  private readonly store = inject(CompositionStore);
  private readonly hostInjector = inject(Injector);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);

  protected readonly form = computed<FormDef | undefined>(() => this.forms.get(this.formName()));

  // Navigation state
  private readonly stepId = signal<string>('');
  private readonly history = signal<readonly string[]>([]);
  protected readonly completed = signal<boolean>(false);
  protected readonly submitting = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  private readonly visited = signal<ReadonlySet<string>>(new Set());

  // Cached per-step injectors keyed by step id (cleared on form switch).
  private readonly stepInjectors = new Map<string, Injector>();
  private prevFormName: string | undefined;

  constructor() {
    // Initialise current step on first form availability and reset on form switch.
    effect(() => {
      const def = this.form();
      const name = def?.name;
      if (name !== this.prevFormName) {
        this.store.clear();
        this.history.set([]);
        this.completed.set(false);
        this.errorMessage.set(null);
        this.visited.set(new Set());
        this.stepInjectors.clear();
        this.stepId.set('');
        this.prevFormName = name;
      }
      if (def?.workflow) {
        const initial = this.initialStepId() ?? def.workflow.steps[0]?.id;
        if (initial && this.stepId() === '') {
          this.stepId.set(initial);
          this.visited.update((s) => {
            const dup = new Set(s);
            dup.add(initial);
            return dup;
          });
        }
      }
    });
  }

  protected readonly currentStep = computed<WorkflowStep | null>(() => {
    const def = this.form();
    if (!def?.workflow) return null;
    return def.workflow.steps.find((s) => s.id === this.stepId()) ?? null;
  });

  protected readonly currentComponent = computed<Type<unknown> | null>(() => {
    const step = this.currentStep();
    if (!step) return null;
    const widgetDef = this.components.get(step.widget);
    return (widgetDef?.component as Type<unknown> | undefined) ?? null;
  });

  /** Returns the cached per-step injector. Method (not computed) — pure factory. */
  protected currentInjector(): Injector | undefined {
    const step = this.currentStep();
    if (!step) return undefined;
    let inj = this.stepInjectors.get(step.id);
    if (!inj) {
      inj = Injector.create({
        providers: [{ provide: COMPOSITION_SLOT, useValue: step.id }],
        parent: this.hostInjector,
      });
      this.stepInjectors.set(step.id, inj);
    }
    return inj;
  }

  protected readonly canGoBack = computed<boolean>(() => this.history().length > 0);

  protected readonly isTerminalStep = computed<boolean>(() => {
    const step = this.currentStep();
    if (!step) return false;
    if (step.next === null) return true;
    if (typeof step.next === 'function') {
      // Treat as potentially terminal — function may return null. Surface
      // 'Submit' if the current state evaluates to null right now; the
      // label updates as the user fills the form.
      try {
        return step.next(this.store.snapshot()) === null;
      } catch {
        return false;
      }
    }
    return false;
  });

  protected isVisited(id: string): boolean {
    return this.visited().has(id);
  }

  protected next(): void {
    const def = this.form();
    const step = this.currentStep();
    if (!def?.workflow || !step) return;

    this.errorMessage.set(null);
    const state = this.store.snapshot();

    let target: string | null;
    try {
      target = typeof step.next === 'function' ? step.next(state) : step.next;
    } catch (err) {
      this.errorMessage.set(`Transition failed: ${describeError(err)}`);
      return;
    }

    if (target === null) {
      void this.runOnComplete();
      return;
    }

    if (!def.workflow.steps.some((s) => s.id === target)) {
      this.errorMessage.set(`Unknown next step '${target}' from '${step.id}'.`);
      return;
    }

    const before = step.id;
    this.history.update((h) => [...h, before]);
    this.visited.update((s) => {
      const dup = new Set(s);
      dup.add(target!);
      return dup;
    });
    this.stepId.set(target);
    this.telemetry.histogram('workflow.transition', 1, {
      workflow: def.name,
      from: before,
      to: target,
      direction: 'forward',
    });
  }

  protected back(): void {
    const def = this.form();
    if (!def?.workflow) return;
    const hist = this.history();
    if (hist.length === 0) return;
    const prev = hist[hist.length - 1]!;
    const cur = this.stepId();
    this.history.set(hist.slice(0, -1));
    this.stepId.set(prev);
    this.errorMessage.set(null);
    this.telemetry.histogram('workflow.transition', 1, {
      workflow: def.name,
      from: cur,
      to: prev,
      direction: 'back',
    });
  }

  private async runOnComplete(): Promise<void> {
    const def = this.form();
    if (!def?.workflow) return;
    this.submitting.set(true);
    const start = performance.now();
    try {
      await def.workflow.onComplete(this.store.snapshot(), {});
      this.completed.set(true);
      this.telemetry.histogram('workflow.complete_ms', performance.now() - start, {
        workflow: def.name,
        ok: 'true',
      });
    } catch (err) {
      this.errorMessage.set(`Submit failed: ${describeError(err)}`);
      this.telemetry.histogram('workflow.complete_ms', performance.now() - start, {
        workflow: def.name,
        ok: 'false',
      });
    } finally {
      this.submitting.set(false);
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
