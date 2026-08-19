import { Injectable, computed, signal } from '@angular/core';
import { resolveNext, stepById, type WorkflowStepJson } from '@infra-tools/aep-embed-sdk';
import { MANIFEST } from './manifest';

/**
 * The runner: walks the manifest's workflow with the SDK's `resolveNext`,
 * holding the accumulated intake data. No @infra-tools/agentic-ui — just the
 * zero-dep embed SDK's control-flow + Angular signals.
 */
@Injectable({ providedIn: 'root' })
export class IntakeStore {
  private readonly steps = MANIFEST.workflow!.steps;
  /** Stepper display order; `conflict-review` is a branch off `conflicts`. */
  readonly spine = ['client', 'matter', 'conflicts', 'fees', 'review'] as const;

  readonly experience = MANIFEST.experience;
  readonly ref = 'INT-' + Math.floor(1000 + Math.random() * 9000);

  /** Accumulated data, keyed however the widgets choose (branch reads `conflictFound`). */
  readonly data = signal<Record<string, unknown>>({});
  readonly stepId = signal<string>(this.steps[0].id);
  readonly history = signal<readonly string[]>([]);
  readonly valid = signal(false);
  readonly done = signal(false);
  readonly matterNo = signal('');

  readonly step = computed<WorkflowStepJson>(() => stepById(this.steps, this.stepId())!);
  readonly spineIndex = computed(() => {
    const id = this.stepId() === 'conflict-review' ? 'conflicts' : this.stepId();
    return this.spine.indexOf(id as (typeof this.spine)[number]);
  });
  readonly isTerminal = computed(() => resolveNext(this.step().next, this.data()) === null);

  patch(part: Record<string, unknown>): void { this.data.update((d) => ({ ...d, ...part })); }
  setValid(v: boolean): void { this.valid.set(v); }

  next(): void {
    if (!this.valid()) return;
    const target = resolveNext(this.step().next, this.data());   // manifest-driven branch
    if (target === null) return this.complete();
    this.history.update((h) => [...h, this.stepId()]);
    this.stepId.set(target);
    this.valid.set(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  back(): void {
    const h = [...this.history()];
    const prev = h.pop();
    if (prev === undefined) return;
    this.history.set(h);
    this.stepId.set(prev);
  }

  private complete(): void {
    this.matterNo.set('MAT-2026-' + String(Math.floor(100 + Math.random() * 900)));
    this.done.set(true);
  }
}
