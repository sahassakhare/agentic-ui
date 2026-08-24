import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ExperienceCatalogService, type CapabilityRequirement, type Experience } from '../services/experience-catalog.service';
import { ToastService } from '../services/toast.service';
import { RequirementsBuilderComponent } from '../requirements-builder.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

type StateFilter = 'all' | 'draft' | 'review' | 'approved' | 'rejected' | 'deprecated';
const FILTERS: readonly StateFilter[] = ['all', 'draft', 'review', 'approved', 'rejected', 'deprecated'];

/**
 * Experience list — the studio's landing surface (AEP Seam E). Lists the
 * tenant's experiences with approval state, a state-filter segmented control,
 * live search, and an inline authoring form. Product-quality states throughout.
 */
@Component({
  selector: 'aes-experiences',
  imports: [MatProgressSpinnerModule, RouterLink, FormsModule, RequirementsBuilderComponent, MatFormFieldModule, MatInputModule, MatButtonModule, MatButtonToggleModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="titles">
          <span class="eyebrow">Seam C · Experience registry</span>
          <h1>Experiences</h1>
          <p class="subtitle">A business goal plus the capabilities it needs. Author it here, resolve its
            plan, and walk it through approval before the runtime will serve it.</p>
        </div>
        <button class="btn btn-primary" type="button" (click)="toggleCreate()" [attr.aria-expanded]="createOpen()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          New experience
        </button>
      </div>

      @if (createOpen()) {
        <form class="card card-pad create" (ngSubmit)="create()">
          <div class="grid-2">
            <mat-form-field appearance="outline" class="mf">
              <mat-label>Name (id)</mat-label>
              <input matInput name="name" [(ngModel)]="newName" placeholder="legalIntake" autocomplete="off" spellcheck="false" required />
              @if (touched() && !newName.trim()) { <mat-error>A unique name is required.</mat-error> }
            </mat-form-field>
            <mat-form-field appearance="outline" class="mf">
              <mat-label>Title</mat-label>
              <input matInput name="title" [(ngModel)]="newTitle" placeholder="Legal Intake" autocomplete="off" required />
              @if (touched() && !newTitle.trim()) { <mat-error>A title is required.</mat-error> }
            </mat-form-field>
            <mat-form-field appearance="outline" class="mf" style="grid-column:1 / -1">
              <mat-label>Goal</mat-label>
              <input matInput name="goal" [(ngModel)]="newGoal" placeholder="Create Legal Matter" required />
              @if (touched() && !newGoal.trim()) { <mat-error>A goal is required.</mat-error> }
            </mat-form-field>
            <div class="field" style="grid-column:1 / -1">
              <label class="label">Requirements <span class="help">— pick a kind, then a registry entry of that kind</span></label>
              <aes-requirements-builder [initial]="[]" (requirementsChange)="newRequires = $event" />
            </div>
          </div>
          <div class="row" style="margin-top:var(--s5)">
            <button matButton="filled" type="submit" [disabled]="saving()">
              @if (saving()) { <mat-spinner diameter="16" class="btn-spin" aria-hidden="true"></mat-spinner> Creating… } @else { Create as draft }
            </button>
            <button matButton type="button" (click)="cancelCreate()">Cancel</button>
          </div>
        </form>
      }

      <div class="toolbar">
        <mat-button-toggle-group class="segmented" [value]="filter()" (change)="filter.set($event.value)"
          hideSingleSelectionIndicator aria-label="Filter by approval state">
          @for (f of filters; track f) {
            <mat-button-toggle [value]="f">
              {{ f }}
              @if (f !== 'all') { <span class="seg-count">{{ countOf(f) }}</span> }
            </mat-button-toggle>
          }
        </mat-button-toggle-group>
        <div class="search spacer" style="max-width:300px; flex:1">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input class="input" type="search" [(ngModel)]="query" aria-label="Search experiences" placeholder="Search experiences…" />
        </div>
      </div>

      @if (loading()) {
        <ul class="rows" aria-hidden="true">
          @for (i of [1,2,3]; track i) { <li class="skeleton skeleton-row"></li> }
        </ul>
      } @else if (error()) {
        <div class="empty" role="alert">
          <div class="empty-icon" style="background:var(--danger-soft);color:var(--danger)">!</div>
          <h3>Couldn’t load experiences</h3>
          <p class="muted">{{ error() }}</p>
          <button class="btn" type="button" (click)="refresh()">Retry</button>
        </div>
      } @else if (items().length === 0) {
        <div class="empty">
          <div class="empty-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3 3 8l9 5 9-5-9-5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m3 13 9 5 9-5M3 8v8" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" opacity=".5"/></svg>
          </div>
          <h3>No experiences yet</h3>
          <p>Define your first goal — the platform will resolve which capabilities it needs.</p>
          <button class="btn btn-primary" type="button" (click)="openCreate()">New experience</button>
        </div>
      } @else if (visible().length === 0) {
        <div class="empty">
          <h3>No matches</h3>
          <p>Nothing matches the current filter{{ query() ? ' and search' : '' }}.</p>
          <button class="btn btn-ghost" type="button" (click)="clearFilters()">Clear filters</button>
        </div>
      } @else {
        <ul class="rows">
          @for (e of visible(); track e.id) {
            <li class="rowcard exp">
              <a class="main" [routerLink]="['/experiences', e.id]">
                <div class="row" style="gap:var(--s3)">
                  <span class="name">{{ e.title }}</span>
                  <span class="badge" [class]="badgeClass(e.approvalState)">{{ e.approvalState }}</span>
                </div>
                <div class="row" style="gap:var(--s3); margin-top:2px">
                  <span class="mono-id">{{ e.name }}</span>
                  <span class="desc" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ e.goal }}</span>
                </div>
              </a>
              <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .btn-spin { --mdc-circular-progress-active-indicator-color: currentColor; display:inline-block; vertical-align:middle; margin-right:6px; }
    .create { margin-bottom: var(--s5); }
    .mf { width: 100%; }
    .toolbar { display: flex; align-items: center; gap: var(--s4); margin: var(--s5) 0 var(--s4); flex-wrap: wrap; }
    .segmented { text-transform: capitalize; }
    .seg-count { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-faint); background: var(--surface-2); padding: 0 .35rem; border-radius: var(--r-full); margin-left: var(--s2); }
    .segmented .mat-button-toggle-checked .seg-count { background: var(--brand-soft); color: var(--brand); }
    .rowcard.exp { padding: 0; }
    .rowcard.exp .main { flex: 1; display: block; padding: var(--s4); color: inherit; text-decoration: none; min-width: 0; }
    .rowcard.exp .main:hover { text-decoration: none; }
    .rowcard.exp .chev { color: var(--text-faint); margin-right: var(--s4); flex: none; }
    .rowcard.exp:hover .chev { color: var(--brand); }
  `],
})
export class ExperiencesComponent {
  private readonly catalog = inject(ExperienceCatalogService);
  private readonly toast = inject(ToastService);

  readonly items = signal<readonly Experience[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly filters = FILTERS;
  readonly filter = signal<StateFilter>('all');
  readonly query = signal('');

  readonly createOpen = signal(false);
  readonly saving = signal(false);
  readonly touched = signal(false);
  newName = ''; newTitle = ''; newGoal = '';
  /** Requirements from the shared builder (emitted on change). */
  newRequires: CapabilityRequirement[] = [];

  readonly visible = computed(() => {
    const f = this.filter();
    const q = this.query().trim().toLowerCase();
    return this.items().filter((e) => {
      if (f !== 'all' && e.approvalState !== f) return false;
      if (!q) return true;
      return e.title.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || e.goal.toLowerCase().includes(q);
    });
  });

  constructor() { this.refresh(); }

  countOf(f: StateFilter): number { return this.items().filter((e) => e.approvalState === f).length; }
  badgeClass(state: string): string {
    return state === 'approved' ? 'badge-ok'
      : state === 'review' ? 'badge-warn'
      : state === 'rejected' || state === 'deprecated' ? 'badge-danger'
      : 'badge-info';
  }

  canCreate(): boolean { return !!this.newName.trim() && !!this.newTitle.trim() && !!this.newGoal.trim(); }
  toggleCreate(): void { this.createOpen.update((v) => !v); if (!this.createOpen()) this.reset(); }
  openCreate(): void { this.createOpen.set(true); }
  cancelCreate(): void { this.createOpen.set(false); this.reset(); }
  clearFilters(): void { this.filter.set('all'); this.query.set(''); }
  private reset(): void {
    this.newName = this.newTitle = this.newGoal = '';
    this.newRequires = [];
    this.touched.set(false);
  }

  create(): void {
    this.touched.set(true);
    if (!this.canCreate()) return;
    this.saving.set(true);
    this.catalog.create({
      name: this.newName.trim(),
      title: this.newTitle.trim(),
      goal: this.newGoal.trim(),
      body: { requires: this.newRequires },
    }).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.createOpen.set(false);
        this.reset();
        this.items.update((cur) => [created, ...cur]);
        this.toast.success('Experience created', `“${created.title}” is a draft — resolve its plan next.`);
      },
      error: (err) => { this.saving.set(false); this.toast.error('Create failed', describe(err)); },
    });
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.catalog.list().subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(describe(err)); this.loading.set(false); },
    });
  }
}

function describe(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string; detail?: string } };
  if (e?.status === 0) return 'Cannot reach the catalog server.';
  if (e?.status === 401) return 'Session expired — please sign in again.';
  if (e?.status === 409) return e.error?.message ?? 'An experience with that name already exists.';
  return e?.error?.detail ?? e?.error?.message ?? 'Request failed. Check the catalog URL.';
}
