import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { GraphViewComponent } from '../graph-view.component';
import { buildWorkflowGraphElements, stepsToWorkflowBody, type WorkflowStepDraft } from '../workflow-graph';

/**
 * Workflow Studio (AEP Seam B/E) — authors `workflow`-kind capabilities with a
 * step-graph editor and a live cytoscape preview. Covers the string/terminal
 * `next` case (function-of-state transitions are wired by the runtime adopter).
 * onComplete is supplied at runtime registration; the catalog stores the step
 * graph metadata.
 */
@Component({
  selector: 'aes-workflow',
  imports: [FormsModule, GraphViewComponent],
  template: `
    <h1>Workflow Studio</h1>

    <details class="create" [open]="createOpen()">
      <summary (click)="toggleCreate($event)">+ New workflow</summary>
      <div class="form">
        <label>Name <input [(ngModel)]="name" placeholder="onboarding" /></label>

        <div class="steps">
          <div class="steprow head"><span>Step id</span><span>Widget</span><span>Section</span><span>Next</span><span></span></div>
          @for (s of steps(); track $index) {
            <div class="steprow">
              <input [(ngModel)]="s.id" placeholder="s1" (ngModelChange)="touch()" />
              <input [(ngModel)]="s.widget" placeholder="intakeForm" (ngModelChange)="touch()" />
              <input [(ngModel)]="s.section" placeholder="(optional)" (ngModelChange)="touch()" />
              <select [(ngModel)]="s.next" (ngModelChange)="touch()">
                <option value="">— terminal —</option>
                @for (t of stepIds(); track t) { @if (t !== s.id) { <option [value]="t">{{ t }}</option> } }
              </select>
              <button class="del" (click)="removeStep($index)">✕</button>
            </div>
          }
          <button class="addstep" (click)="addStep()">+ Add step</button>
        </div>

        @if (previewElements().length > 0) {
          <div class="preview">
            <span class="lbl">Preview</span>
            <aes-graph-view [elements]="previewElements()" />
          </div>
        }

        <button [disabled]="!canCreate() || saving()" (click)="create()">{{ saving() ? 'Saving…' : 'Create' }}</button>
      </div>
    </details>

    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (loading()) { <p>Loading…</p> }
    @if (!loading() && items().length === 0) { <p class="muted">No workflows yet.</p> }

    <ul class="list">
      @for (w of items(); track w.id) {
        <li>
          <strong>{{ w.name }}</strong>
          <span class="summary">{{ stepCount(w) }} steps</span>
          <button class="del" (click)="remove(w)">Delete</button>
        </li>
      }
    </ul>
  `,
  styles: [`
    label { display: flex; flex-direction: column; font-size: .75rem; gap: .25rem; }
    input, select { padding: .35rem .5rem; font: inherit; }
    .create { margin-bottom: 1rem; }
    .create summary { cursor: pointer; padding: .4rem 0; font-weight: 600; }
    .create .form { display: flex; flex-direction: column; gap: .75rem; padding: .5rem 0; max-width: 760px; }
    .steps { display: flex; flex-direction: column; gap: .4rem; }
    .steprow { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr auto; gap: .4rem; align-items: center; }
    .steprow.head { font-size: .7rem; opacity: .6; }
    .addstep { justify-self: start; padding: .3rem .7rem; }
    .del { padding: .2rem .5rem; }
    .preview { display: flex; flex-direction: column; gap: .25rem; }
    .preview .lbl { font-size: .7rem; opacity: .6; }
    .create > .form > button:last-child { align-self: start; padding: .4rem 1rem; }
    .list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .list li { display: flex; gap: .75rem; align-items: center; padding: .6rem .75rem;
      border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 8px; }
    .summary { opacity: .6; font-size: .85rem; }
    .list .del { margin-left: auto; }
    .error { color: crimson; } .muted { opacity: .6; }
  `],
})
export class WorkflowComponent {
  private readonly catalog = inject(CapabilityCatalogService);

  readonly items = signal<readonly Capability[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly createOpen = signal(false);

  name = '';
  readonly steps = signal<WorkflowStepDraft[]>([{ id: 's1', widget: '', next: '' }]);
  // Bumped on every edit so computed previews recompute (steps are mutated in place by ngModel).
  private readonly rev = signal(0);

  readonly stepIds = computed(() => { this.rev(); return this.steps().map((s) => s.id).filter(Boolean); });
  readonly previewElements = computed(() => { this.rev(); return buildWorkflowGraphElements(this.steps()); });

  constructor() { this.refresh(); }

  touch(): void { this.rev.update((v) => v + 1); }
  addStep(): void { this.steps.update((s) => [...s, { id: `s${s.length + 1}`, widget: '', next: '' }]); this.touch(); }
  removeStep(i: number): void { this.steps.update((s) => s.filter((_, idx) => idx !== i)); this.touch(); }

  canCreate(): boolean {
    return this.name.trim() !== '' && this.steps().some((s) => s.id && s.widget);
  }

  toggleCreate(ev: Event): void { ev.preventDefault(); this.createOpen.update((v) => !v); }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.catalog.listByKind('workflow').subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(msg(err)); this.loading.set(false); },
    });
  }

  create(): void {
    if (!this.canCreate()) return;
    this.saving.set(true);
    this.error.set(null);
    this.catalog.create({ kind: 'workflow', name: this.name.trim(), body: stepsToWorkflowBody(this.steps()) }).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.createOpen.set(false);
        this.name = '';
        this.steps.set([{ id: 's1', widget: '', next: '' }]);
        this.touch();
        this.items.update((cur) => [created, ...cur]);
      },
      error: (err) => { this.error.set(msg(err)); this.saving.set(false); },
    });
  }

  remove(w: Capability): void {
    this.catalog.remove(w.id).subscribe({
      next: () => this.items.update((cur) => cur.filter((x) => x.id !== w.id)),
      error: (err) => this.error.set(msg(err)),
    });
  }

  stepCount(w: Capability): number {
    const wf = w.body['workflow'] as { steps?: unknown[] } | undefined;
    return wf?.steps?.length ?? 0;
  }
}

function msg(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string } };
  if (e?.status === 401) return 'Session expired — please sign in again.';
  if (e?.status === 409) return e.error?.message ?? 'Name already exists.';
  return e?.error?.message ?? 'Request failed.';
}
