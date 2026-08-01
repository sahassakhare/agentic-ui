import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ExperienceCatalogService, type CapabilityRequirement, type Experience } from '../services/experience-catalog.service';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';

/** One editable requirement row in the select-and-define builder. */
interface RequirementRow { kind: string; selector: string; optional: boolean; }
/** Capability kinds a requirement can target (mirror the catalog CAPABILITY_KINDS). */
const REQ_KINDS: readonly string[] = [
  'component', 'form', 'workflow', 'tool', 'prompt', 'skill', 'knowledge', 'memory', 'navigation', 'datasource',
];

type StateFilter = 'all' | 'draft' | 'review' | 'approved' | 'rejected' | 'deprecated';
const FILTERS: readonly StateFilter[] = ['all', 'draft', 'review', 'approved', 'rejected', 'deprecated'];

/**
 * Experience list — the studio's landing surface (AEP Seam E). Lists the
 * tenant's experiences with approval state, a state-filter segmented control,
 * live search, and an inline authoring form. Product-quality states throughout.
 */
@Component({
  selector: 'aes-experiences',
  imports: [RouterLink, FormsModule],
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
            <div class="field">
              <label class="label" for="e-name">Name (id) <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="e-name" name="name" [(ngModel)]="newName" placeholder="legalIntake"
                     [attr.aria-invalid]="touched() && !newName.trim()" autocomplete="off" spellcheck="false" />
              @if (touched() && !newName.trim()) { <span class="err">A unique name is required.</span> }
            </div>
            <div class="field">
              <label class="label" for="e-title">Title <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="e-title" name="title" [(ngModel)]="newTitle" placeholder="Legal Intake"
                     [attr.aria-invalid]="touched() && !newTitle.trim()" autocomplete="off" />
              @if (touched() && !newTitle.trim()) { <span class="err">A title is required.</span> }
            </div>
            <div class="field" style="grid-column:1 / -1">
              <label class="label" for="e-goal">Goal <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="e-goal" name="goal" [(ngModel)]="newGoal" placeholder="Create Legal Matter"
                     [attr.aria-invalid]="touched() && !newGoal.trim()" />
              @if (touched() && !newGoal.trim()) { <span class="err">A goal is required.</span> }
            </div>
            <div class="field" style="grid-column:1 / -1">
              <label class="label">Requirements <span class="help">— pick a kind, then a registry entry of that kind</span></label>
              <div class="reqs">
                @for (r of reqRows; track $index) {
                  <div class="reqrow">
                    <select class="input rk" [ngModel]="r.kind" (ngModelChange)="setRowKind($index, $event)" [name]="'rk'+$index" aria-label="Capability kind">
                      @for (k of kinds; track k) { <option [value]="k">{{ k }}</option> }
                    </select>
                    <select class="input rn" [(ngModel)]="r.selector" [name]="'rn'+$index" aria-label="Registry entry" [disabled]="!capsFor(r.kind).length">
                      @if (capsFor(r.kind).length) {
                        <option value="" disabled>select a {{ r.kind }}…</option>
                        @for (n of capsFor(r.kind); track n) { <option [value]="n">{{ n }}</option> }
                      } @else {
                        <option value="" disabled>no {{ r.kind }} in the registry</option>
                      }
                    </select>
                    <label class="opt"><input type="checkbox" [(ngModel)]="r.optional" [name]="'ro'+$index" /> optional</label>
                    <button type="button" class="rrm" (click)="removeReq($index)" aria-label="Remove requirement">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                }
              </div>
              <button type="button" class="btn btn-ghost btn-add" (click)="addReq()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                Add requirement
              </button>
              <span class="help">Each requirement is a registry entry of the chosen kind. These become the experience's dependency graph.</span>
            </div>
          </div>
          <div class="row" style="margin-top:var(--s5)">
            <button class="btn btn-primary" type="submit" [disabled]="saving()">
              @if (saving()) { <span class="spinner" aria-hidden="true"></span> Creating… } @else { Create as draft }
            </button>
            <button class="btn btn-ghost" type="button" (click)="cancelCreate()">Cancel</button>
          </div>
        </form>
      }

      <div class="toolbar">
        <div class="segmented" role="tablist" aria-label="Filter by approval state">
          @for (f of filters; track f) {
            <button role="tab" [attr.aria-selected]="filter() === f" class="seg" [class.on]="filter() === f" (click)="filter.set(f)">
              {{ f }}
              @if (f !== 'all') { <span class="seg-count">{{ countOf(f) }}</span> }
            </button>
          }
        </div>
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
    .create { margin-bottom: var(--s5); }
    .toolbar { display: flex; align-items: center; gap: var(--s4); margin: var(--s5) 0 var(--s4); flex-wrap: wrap; }
    .segmented { display: inline-flex; gap: 2px; padding: 3px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-sm); }
    .seg { font: inherit; font-size: var(--fs-sm); text-transform: capitalize; color: var(--text-muted);
      background: transparent; border: 0; border-radius: 5px; padding: .3rem .6rem; cursor: pointer; display: inline-flex; align-items: center; gap: var(--s2); }
    .seg:hover { color: var(--text); }
    .seg.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-1); font-weight: 600; }
    .seg-count { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-faint); background: var(--surface-2); padding: 0 .35rem; border-radius: var(--r-full); }
    .seg.on .seg-count { background: var(--brand-soft); color: var(--brand); }
    .rowcard.exp { padding: 0; }
    .rowcard.exp .main { flex: 1; display: block; padding: var(--s4); color: inherit; text-decoration: none; min-width: 0; }
    .rowcard.exp .main:hover { text-decoration: none; }
    .rowcard.exp .chev { color: var(--text-faint); margin-right: var(--s4); flex: none; }
    .rowcard.exp:hover .chev { color: var(--brand); }
    .reqs { display: flex; flex-direction: column; gap: var(--s2); }
    .reqrow { display: grid; grid-template-columns: 150px 1fr auto auto; gap: var(--s2); align-items: center; }
    .reqrow .rk { text-transform: capitalize; }
    .reqrow .opt { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-muted); white-space: nowrap; }
    .reqrow .rrm { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--border); border-radius: var(--r-sm);
      background: var(--surface); color: var(--text-muted); cursor: pointer; }
    .reqrow .rrm:hover { border-color: var(--danger); color: var(--danger); }
    .btn-add { margin-top: var(--s2); font-size: var(--fs-sm); padding: .35rem .7rem; }
  `],
})
export class ExperiencesComponent {
  private readonly catalog = inject(ExperienceCatalogService);
  private readonly capCatalog = inject(CapabilityCatalogService);
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

  // Select-and-define requirements builder.
  readonly kinds = REQ_KINDS;
  reqRows: RequirementRow[] = [{ kind: 'workflow', selector: '', optional: false }];
  /** Capability names per kind, for the dependent "registry entry" dropdown. */
  private readonly capsByKind = signal<Record<string, readonly string[]>>({});
  capsFor(kind: string): readonly string[] { return this.capsByKind()[kind] ?? []; }
  addReq(): void { this.reqRows = [...this.reqRows, { kind: 'workflow', selector: '', optional: false }]; }
  removeReq(i: number): void { this.reqRows = this.reqRows.filter((_, idx) => idx !== i); }
  /** Changing the kind resets the entry — the registry options for it differ. */
  setRowKind(i: number, kind: string): void {
    this.reqRows = this.reqRows.map((r, idx) => (idx === i ? { ...r, kind, selector: '' } : r));
  }

  readonly visible = computed(() => {
    const f = this.filter();
    const q = this.query().trim().toLowerCase();
    return this.items().filter((e) => {
      if (f !== 'all' && e.approvalState !== f) return false;
      if (!q) return true;
      return e.title.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || e.goal.toLowerCase().includes(q);
    });
  });

  constructor() { this.refresh(); this.loadCapabilities(); }

  /** Populate the requirement typeahead from the tenant's catalog capabilities. */
  private loadCapabilities(): void {
    for (const kind of this.kinds) {
      this.capCatalog.listByKind(kind).subscribe({
        next: (res) => this.capsByKind.update((m) => ({ ...m, [kind]: res.items.map((c) => c.name) })),
        error: () => { /* typeahead is best-effort; the field still accepts free input */ },
      });
    }
  }

  /** Build catalog requirements from the row builder; `#tag` → tag, else name. */
  private buildRequires(): CapabilityRequirement[] {
    return this.reqRows
      .filter((r) => r.selector.trim())
      .map((r) => {
        const sel = r.selector.trim();
        return sel.startsWith('#')
          ? { kind: r.kind, tag: sel.slice(1), ...(r.optional ? { optional: true } : {}) }
          : { kind: r.kind, name: sel, ...(r.optional ? { optional: true } : {}) };
      });
  }

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
    this.reqRows = [{ kind: 'workflow', selector: '', optional: false }];
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
      body: { requires: this.buildRequires() },
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
