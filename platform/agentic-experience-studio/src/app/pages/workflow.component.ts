import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { GraphViewComponent } from '../graph-view.component';
import { buildWorkflowGraphElements, stepsToWorkflowBody, type WorkflowStepDraft } from '../workflow-graph';
import { ToastService } from '../services/toast.service';

/**
 * Workflow Studio (AEP Seam B/E) — authors `workflow`-kind capabilities with a
 * step-graph editor and a live cytoscape preview. Covers the string/terminal
 * `next` case (function-of-state transitions are wired by the runtime adopter).
 */
@Component({
  selector: 'aes-workflow',
  imports: [FormsModule, GraphViewComponent],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="titles">
          <span class="eyebrow">Capability · workflow</span>
          <h1>Workflow Studio</h1>
          <p class="subtitle">Compose a step graph — each step names a widget and points to the next.
            The runtime wires state-driven branches; the catalog stores this shape.</p>
        </div>
        <button class="btn btn-primary" type="button" (click)="toggleCreate()" [attr.aria-expanded]="createOpen()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          New workflow
        </button>
      </div>

      @if (createOpen()) {
        <form class="card card-pad create" (ngSubmit)="create()">
          <div class="field" style="max-width:360px; margin-bottom:var(--s5)">
            <label class="label" for="wf-name">Name <span class="req" aria-hidden="true">*</span></label>
            <input class="input" id="wf-name" name="name" [(ngModel)]="name" placeholder="onboarding" autocomplete="off" spellcheck="false" />
          </div>

          <div class="steps">
            <div class="steprow head"><span>Step id</span><span>Widget</span><span>Section</span><span>Next</span><span></span></div>
            @for (s of steps(); track $index) {
              <div class="steprow">
                <input class="input" [(ngModel)]="s.id" [name]="'id'+$index" placeholder="s1" (ngModelChange)="touch()" aria-label="Step id" />
                <input class="input" [(ngModel)]="s.widget" [name]="'w'+$index" placeholder="intakeForm" (ngModelChange)="touch()" aria-label="Widget" />
                <input class="input" [(ngModel)]="s.section" [name]="'sec'+$index" placeholder="(optional)" (ngModelChange)="touch()" aria-label="Section" />
                <select class="select" [(ngModel)]="s.next" [name]="'n'+$index" (ngModelChange)="touch()" aria-label="Next step">
                  <option value="">— terminal —</option>
                  @for (t of stepIds(); track t) { @if (t !== s.id) { <option [value]="t">{{ t }}</option> } }
                </select>
                <button class="btn btn-ghost btn-icon" type="button" (click)="removeStep($index)" aria-label="Remove step">✕</button>
              </div>
            }
            <button class="btn btn-sm" type="button" (click)="addStep()" style="justify-self:start; margin-top:var(--s2)">+ Add step</button>
          </div>

          @if (previewElements().length > 0) {
            <div class="preview">
              <span class="eyebrow">Preview</span>
              <div class="card" style="padding:var(--s3)"><aes-graph-view [elements]="previewElements()" /></div>
            </div>
          }

          <div class="row" style="margin-top:var(--s5)">
            <button class="btn btn-primary" type="submit" [disabled]="!canCreate() || saving()">
              @if (saving()) { <span class="spinner" aria-hidden="true"></span> Saving… } @else { Create workflow }
            </button>
            <button class="btn btn-ghost" type="button" (click)="cancelCreate()">Cancel</button>
          </div>
        </form>
      }

      @if (loading()) {
        <ul class="rows" aria-hidden="true">@for (i of [1,2]; track i) { <li class="skeleton skeleton-row"></li> }</ul>
      } @else if (error()) {
        <div class="empty" role="alert"><div class="empty-icon" style="background:var(--danger-soft);color:var(--danger)">!</div>
          <h3>Couldn’t load workflows</h3><p class="muted">{{ error() }}</p><button class="btn" (click)="refresh()">Retry</button></div>
      } @else if (items().length === 0) {
        <div class="empty">
          <div class="empty-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="6" cy="6" r="2.4" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="18" r="2.4" stroke="currentColor" stroke-width="1.6"/><path d="M8 6h6a4 4 0 0 1 4 4v6" stroke="currentColor" stroke-width="1.6"/></svg></div>
          <h3>No workflows yet</h3><p>Author a step graph to guide a multi-step experience.</p>
          <button class="btn btn-primary" (click)="openCreate()">New workflow</button>
        </div>
      } @else {
        <ul class="rows" style="margin-top:var(--s5)">
          @for (w of items(); track w.id) {
            <li class="rowcard">
              <div class="stack" style="gap:2px; flex:1">
                <span class="name">{{ w.name }}</span>
                <span class="desc">{{ stepCount(w) }} step{{ stepCount(w) === 1 ? '' : 's' }}</span>
              </div>
              <span class="badge" [class.badge-ok]="w.lifecycle === 'published'">{{ w.lifecycle }}</span>
              <button class="btn btn-danger btn-sm" type="button" (click)="remove(w)">Delete</button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .create { margin-bottom: var(--s5); }
    .steps { display: flex; flex-direction: column; gap: var(--s2); }
    .steprow { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr auto; gap: var(--s2); align-items: center; }
    .steprow.head { font-size: var(--fs-xs); color: var(--text-faint); text-transform: uppercase; letter-spacing: .05em; font-family: var(--font-mono); padding: 0 var(--s1); }
    .preview { display: flex; flex-direction: column; gap: var(--s2); margin-top: var(--s5); }
    @media (max-width: 720px) { .steprow { grid-template-columns: 1fr 1fr; } .steprow.head { display: none; } }
  `],
})
export class WorkflowComponent {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);

  readonly items = signal<readonly Capability[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly createOpen = signal(false);

  name = '';
  readonly steps = signal<WorkflowStepDraft[]>([{ id: 's1', widget: '', next: '' }]);
  private readonly rev = signal(0);

  readonly stepIds = computed(() => { this.rev(); return this.steps().map((s) => s.id).filter(Boolean); });
  readonly previewElements = computed(() => { this.rev(); return buildWorkflowGraphElements(this.steps()); });

  constructor() { this.refresh(); }

  touch(): void { this.rev.update((v) => v + 1); }
  addStep(): void { this.steps.update((s) => [...s, { id: `s${s.length + 1}`, widget: '', next: '' }]); this.touch(); }
  removeStep(i: number): void { this.steps.update((s) => s.filter((_, idx) => idx !== i)); this.touch(); }

  canCreate(): boolean { return this.name.trim() !== '' && this.steps().some((s) => s.id && s.widget); }
  toggleCreate(): void { this.createOpen.update((v) => !v); if (!this.createOpen()) this.reset(); }
  openCreate(): void { this.createOpen.set(true); }
  cancelCreate(): void { this.createOpen.set(false); this.reset(); }
  private reset(): void { this.name = ''; this.steps.set([{ id: 's1', widget: '', next: '' }]); this.touch(); }

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
    this.catalog.create({ kind: 'workflow', name: this.name.trim(), body: stepsToWorkflowBody(this.steps()) }).subscribe({
      next: (created) => {
        this.saving.set(false); this.createOpen.set(false); this.reset();
        this.items.update((cur) => [created, ...cur]);
        this.toast.success('Workflow created', `“${created.name}” is published.`);
      },
      error: (err) => { this.saving.set(false); this.toast.error('Create failed', msg(err)); },
    });
  }

  remove(w: Capability): void {
    this.catalog.remove(w.id).subscribe({
      next: () => {
        this.items.update((cur) => cur.filter((x) => x.id !== w.id));
        this.toast.withAction('info', `Deleted “${w.name}”`, 'Undo', () => this.undo(w));
      },
      error: (err) => this.toast.error('Delete failed', msg(err)),
    });
  }

  private undo(w: Capability): void {
    this.catalog.create({ kind: w.kind, name: w.name, body: w.body, tags: [...w.tags] }).subscribe({
      next: (r) => { this.items.update((cur) => [r, ...cur]); this.toast.success('Restored', `“${r.name}” is back.`); },
      error: (err) => this.toast.error('Undo failed', msg(err)),
    });
  }

  stepCount(w: Capability): number {
    const wf = w.body['workflow'] as { steps?: unknown[] } | undefined;
    return wf?.steps?.length ?? 0;
  }
}

function msg(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string; detail?: string } };
  if (e?.status === 0) return 'Cannot reach the catalog server.';
  if (e?.status === 401) return 'Session expired — please sign in again.';
  if (e?.status === 409) return e.error?.message ?? 'A workflow with that name already exists.';
  return e?.error?.detail ?? e?.error?.message ?? 'Request failed.';
}
