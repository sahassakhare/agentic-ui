import { Component, computed, inject, signal } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';
import { CapabilityGraphService } from '../services/capability-graph.service';
import { AppFilterService } from '../services/app-filter.service';

/**
 * Workflow Studio — lists `workflow`-kind capabilities. Authoring is unified on
 * the one canvas editor (`/workflows/:id/design`): "New workflow" creates an
 * empty workflow here and routes straight into that designer, so there is a
 * single place to build a step graph (no duplicate inline editor).
 */
@Component({
  selector: 'aes-workflow',
  imports: [MatProgressSpinnerModule, FormsModule, RouterLink],
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
          <div class="field" style="max-width:360px">
            <label class="label" for="wf-name">Name <span class="req" aria-hidden="true">*</span></label>
            <input class="input" id="wf-name" name="name" [(ngModel)]="name" placeholder="onboarding" autocomplete="off" spellcheck="false" />
            <p class="muted" style="font-size:var(--fs-sm); margin-top:var(--s2)">Creates an empty workflow and opens the step-graph designer.</p>
          </div>
          <div class="row" style="margin-top:var(--s4)">
            <button class="btn btn-primary" type="submit" [disabled]="!canCreate() || saving()">
              @if (saving()) { <mat-spinner diameter="16" class="btn-spin" aria-hidden="true"></mat-spinner> Creating… } @else { Create &amp; design → }
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
          @for (w of visible(); track w.id) {
            <li class="rowcard">
              <div class="stack" style="gap:2px; flex:1">
                <span class="name">{{ w.name }}</span>
                <span class="desc">{{ stepCount(w) }} step{{ stepCount(w) === 1 ? '' : 's' }}</span>
              </div>
              <span class="badge" [class.badge-ok]="w.lifecycle === 'published'">{{ w.lifecycle }}</span>
              <a class="btn btn-sm" [routerLink]="['/workflows', w.id, 'design']">Design</a>
              <button class="btn btn-danger btn-sm" type="button" (click)="remove(w)">Delete</button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .btn-spin { --mdc-circular-progress-active-indicator-color: currentColor; display:inline-block; vertical-align:middle; margin-right:6px; }
    .create { margin-bottom: var(--s5); }
  `],
})
export class WorkflowComponent {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly graph = inject(CapabilityGraphService);
  protected readonly appFilter = inject(AppFilterService);

  readonly items = signal<readonly Capability[]>([]);
  /** Items scoped to the Studio-wide application filter (all when none selected). */
  readonly visible = computed(() => {
    const app = this.appFilter.selected();
    if (!app) return this.items();
    const members = this.graph.membersOf(app);
    return this.items().filter((w) => members.has(`workflow:${w.name}`));
  });
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly createOpen = signal(false);

  name = '';

  constructor() { this.refresh(); }

  canCreate(): boolean { return this.name.trim() !== ''; }
  toggleCreate(): void { this.createOpen.update((v) => !v); if (!this.createOpen()) this.reset(); }
  openCreate(): void { this.createOpen.set(true); }
  cancelCreate(): void { this.createOpen.set(false); this.reset(); }
  private reset(): void { this.name = ''; }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.catalog.listByKind('workflow').subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(msg(err)); this.loading.set(false); },
    });
    this.graph.load(); // for the application filter's membership set
  }

  /** Create an empty workflow and jump straight into the one canvas designer. */
  create(): void {
    if (!this.canCreate()) return;
    this.saving.set(true);
    this.catalog.create({ kind: 'workflow', name: this.name.trim(), body: { workflow: { steps: [] } } }).subscribe({
      next: (created) => {
        this.saving.set(false); this.createOpen.set(false); this.reset();
        this.items.update((cur) => [created, ...cur]);
        void this.router.navigate(['/workflows', created.id, 'design']);
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
