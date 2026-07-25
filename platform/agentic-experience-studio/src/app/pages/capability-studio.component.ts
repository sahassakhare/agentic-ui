import { Component, computed, inject, input, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';

/** A field in a capability authoring form. */
export interface StudioField {
  readonly key: string;
  readonly label: string;
  /** `list` splits whitespace/commas into a string[] stored in body. */
  readonly type: 'text' | 'textarea' | 'number' | 'checkbox' | 'list';
  readonly required?: boolean;
  readonly placeholder?: string;
}

/** Route-data config that parameterizes the generic capability studio. */
export interface StudioConfig {
  readonly kind: string;        // 'prompt' | 'navigation' | …
  readonly title: string;       // "Prompt Studio"
  readonly noun: string;        // "prompt"
  readonly bodyFields: readonly StudioField[]; // fields stored in body
}

/**
 * Generic authoring studio for a capability kind (AEP Seam B/E). Lists existing
 * capabilities of `config.kind`, filters them, and creates / deletes them via
 * the catalog `/capabilities` API. Parameterized by route `data.config` so one
 * component powers the Prompt / Skill / Knowledge / Memory / Navigation studios.
 *
 * Product-quality surface: skeleton loading, empty state with CTA, live search,
 * per-field validation, a confirm-before-delete dialog, and undoable delete
 * feedback via toasts. All visuals reuse the design-system classes.
 */
@Component({
  selector: 'aes-capability-studio',
  imports: [FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="titles">
          <span class="eyebrow">Capability · {{ cfg().kind }}</span>
          <h1>{{ cfg().title }}</h1>
          <p class="subtitle">Author and govern reusable <strong>{{ cfg().noun }}</strong> capabilities.
            An Experience resolves against whatever is published here.</p>
        </div>
        <button class="btn btn-primary" type="button" (click)="toggleCreate()" [attr.aria-expanded]="createOpen()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          New {{ cfg().noun }}
        </button>
      </div>

      @if (createOpen()) {
        <form class="card card-pad create" (ngSubmit)="create()">
          <div class="grid-2">
            <div class="field" [class.wide]="false">
              <label class="label" [attr.for]="fid('name')">Name (id) <span class="req" aria-hidden="true">*</span></label>
              <input class="input" [id]="fid('name')" name="name" [(ngModel)]="values['name']"
                     [attr.aria-invalid]="touched() && !nameValid()" [placeholder]="cfg().noun + 'Name'"
                     autocomplete="off" spellcheck="false" />
              @if (touched() && !nameValid()) { <span class="err">A unique name is required.</span> }
            </div>
            @for (f of cfg().bodyFields; track f.key) {
              <div class="field" [style.grid-column]="isWide(f) ? '1 / -1' : null">
                <label class="label" [attr.for]="fid(f.key)">
                  {{ f.label }} @if (f.required) { <span class="req" aria-hidden="true">*</span> }
                </label>
                @switch (f.type) {
                  @case ('textarea') {
                    <textarea class="textarea" rows="4" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]"
                      [attr.aria-invalid]="touched() && f.required && !filled(f.key)" [placeholder]="f.placeholder ?? ''"></textarea>
                  }
                  @case ('list') {
                    <textarea class="textarea" rows="2" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]"
                      [attr.aria-invalid]="touched() && f.required && !filled(f.key)" [placeholder]="f.placeholder ?? ''"></textarea>
                    <span class="help">Separate with spaces or commas.</span>
                  }
                  @case ('checkbox') {
                    <label class="checkbox"><input type="checkbox" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]" /> Enabled</label>
                  }
                  @case ('number') {
                    <input class="input" type="number" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]" [placeholder]="f.placeholder ?? ''" />
                  }
                  @default {
                    <input class="input" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]"
                      [attr.aria-invalid]="touched() && f.required && !filled(f.key)" [placeholder]="f.placeholder ?? ''" autocomplete="off" />
                  }
                }
                @if (touched() && f.required && !filled(f.key)) { <span class="err">{{ f.label }} is required.</span> }
              </div>
            }
          </div>
          <div class="row" style="margin-top:var(--s5)">
            <button class="btn btn-primary" type="submit" [disabled]="saving()">
              @if (saving()) { <span class="spinner" aria-hidden="true"></span> Creating… } @else { Create {{ cfg().noun }} }
            </button>
            <button class="btn btn-ghost" type="button" (click)="cancelCreate()">Cancel</button>
          </div>
        </form>
      }

      <div class="toolbar">
        <div class="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input class="input" type="search" [(ngModel)]="query" [attr.aria-label]="'Search ' + cfg().noun + 's'" [placeholder]="'Search ' + cfg().noun + 's…'" />
        </div>
        <span class="count faint">{{ filtered().length }} of {{ items().length }}</span>
      </div>

      @if (loading()) {
        <ul class="rows" aria-hidden="true">
          @for (i of [1,2,3]; track i) { <li class="skeleton skeleton-row"></li> }
        </ul>
      } @else if (error()) {
        <div class="empty" role="alert">
          <div class="empty-icon" style="background:var(--danger-soft);color:var(--danger)">!</div>
          <h3>Couldn’t load {{ cfg().noun }}s</h3>
          <p class="muted">{{ error() }}</p>
          <button class="btn" type="button" (click)="refresh()">Retry</button>
        </div>
      } @else if (items().length === 0) {
        <div class="empty">
          <div class="empty-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </div>
          <h3>No {{ cfg().noun }}s yet</h3>
          <p>Create your first {{ cfg().noun }} — it becomes available to every Experience in this tenant.</p>
          <button class="btn btn-primary" type="button" (click)="openCreate()">New {{ cfg().noun }}</button>
        </div>
      } @else if (filtered().length === 0) {
        <div class="empty">
          <h3>No matches</h3>
          <p>Nothing matches “{{ query() }}”.</p>
          <button class="btn btn-ghost" type="button" (click)="query.set('')">Clear search</button>
        </div>
      } @else {
        <ul class="rows">
          @for (c of filtered(); track c.id) {
            <li class="rowcard">
              <div class="stack" style="gap:2px; flex:1; min-width:0">
                <div class="row" style="gap:var(--s2)">
                  <span class="name">{{ c.name }}</span>
                  <span class="badge" [class.badge-ok]="c.lifecycle === 'published'" [class.badge-warn]="c.lifecycle === 'draft'" [class.badge-danger]="c.lifecycle === 'deprecated' || c.lifecycle === 'disabled'">{{ c.lifecycle }}</span>
                </div>
                @if (summarize(c)) { <span class="desc" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ summarize(c) }}</span> }
              </div>
              @for (t of c.tags; track t) { <span class="badge plain badge-brand">{{ t }}</span> }
              <button class="btn btn-danger btn-sm" type="button" (click)="askDelete(c)">Delete</button>
            </li>
          }
        </ul>
      }
    </div>

    @if (pendingDelete(); as target) {
      <div class="scrim" (click)="pendingDelete.set(null)">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="del-title" (click)="$event.stopPropagation()">
          <h3 id="del-title">Delete “{{ target.name }}”?</h3>
          <p>This {{ cfg().noun }} will be removed from the catalog. Experiences that require it will show it as unmet. You can undo right after.</p>
          <div class="actions">
            <button class="btn btn-ghost" type="button" (click)="pendingDelete.set(null)">Cancel</button>
            <button class="btn btn-danger" type="button" (click)="confirmDelete(target)" [disabled]="deleting()">
              @if (deleting()) { <span class="spinner" aria-hidden="true"></span> Deleting… } @else { Delete }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .create { margin-bottom: var(--s5); }
    .toolbar { display: flex; align-items: center; gap: var(--s4); margin: var(--s5) 0 var(--s4); }
    .toolbar .search { flex: 1; max-width: 380px; }
    .toolbar .count { font-size: var(--fs-sm); white-space: nowrap; }
  `],
})
export class CapabilityStudioComponent {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);

  /** Bound from route `data.config` via withComponentInputBinding(). */
  readonly config = input.required<StudioConfig>();
  cfg = () => this.config();

  readonly items = signal<readonly Capability[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly error = signal<string | null>(null);
  readonly createOpen = signal(false);
  readonly touched = signal(false);
  readonly query = signal('');
  readonly pendingDelete = signal<Capability | null>(null);

  values: Record<string, unknown> = {};

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q)) ||
      JSON.stringify(c.body).toLowerCase().includes(q));
  });

  constructor() {
    // Reload whenever the kind changes (navigating Prompt → Navigation).
    effect(() => { this.config(); this.resetForm(); this.refresh(); });
  }

  fid(key: string): string { return `f-${this.cfg().kind}-${key}`; }
  isWide(f: StudioField): boolean { return f.type === 'textarea' || f.type === 'list'; }
  filled(key: string): boolean { return String(this.values[key] ?? '').trim() !== ''; }
  nameValid(): boolean { return this.filled('name'); }

  canCreate(): boolean {
    if (!this.nameValid()) return false;
    return this.cfg().bodyFields.filter((f) => f.required).every((f) => this.filled(f.key));
  }

  toggleCreate(): void { this.createOpen.update((v) => !v); if (!this.createOpen()) this.resetForm(); }
  openCreate(): void { this.createOpen.set(true); }
  cancelCreate(): void { this.createOpen.set(false); this.resetForm(); }
  private resetForm(): void { this.values = {}; this.touched.set(false); }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.catalog.listByKind(this.cfg().kind).subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(msg(err)); this.loading.set(false); },
    });
  }

  create(): void {
    this.touched.set(true);
    if (!this.canCreate()) return;
    this.saving.set(true);
    const name = String(this.values['name']).trim();
    const body = this.buildBody();
    this.catalog.create({ kind: this.cfg().kind, name, body }).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.createOpen.set(false);
        this.resetForm();
        this.items.update((cur) => [created, ...cur]);
        this.toast.success(`${cap(this.cfg().noun)} created`, `“${created.name}” is now published.`);
      },
      error: (err) => { this.saving.set(false); this.toast.error('Create failed', msg(err)); },
    });
  }

  askDelete(c: Capability): void { this.pendingDelete.set(c); }

  confirmDelete(c: Capability): void {
    this.deleting.set(true);
    this.catalog.remove(c.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.pendingDelete.set(null);
        this.items.update((cur) => cur.filter((x) => x.id !== c.id));
        this.toast.withAction('info', `Deleted “${c.name}”`, 'Undo', () => this.undoDelete(c));
      },
      error: (err) => { this.deleting.set(false); this.pendingDelete.set(null); this.toast.error('Delete failed', msg(err)); },
    });
  }

  private undoDelete(c: Capability): void {
    this.catalog.create({ kind: c.kind, name: c.name, body: c.body, tags: [...c.tags] }).subscribe({
      next: (restored) => { this.items.update((cur) => [restored, ...cur]); this.toast.success('Restored', `“${restored.name}” is back.`); },
      error: (err) => this.toast.error('Undo failed', msg(err)),
    });
  }

  private buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    for (const f of this.cfg().bodyFields) {
      const raw = this.values[f.key];
      if (raw === undefined || raw === '' || raw === null) continue;
      if (f.type === 'number') body[f.key] = Number(raw);
      else if (f.type === 'checkbox') body[f.key] = Boolean(raw);
      else if (f.type === 'list') {
        const arr = String(raw).split(/[\s,]+/).filter(Boolean);
        if (arr.length) body[f.key] = arr;
      } else body[f.key] = raw;
    }
    return body;
  }

  summarize(c: Capability): string {
    const first = this.cfg().bodyFields[0]?.key;
    const v = first ? c.body[first] : undefined;
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join(', ') : String(v);
    return s.length > 96 ? s.slice(0, 96) + '…' : s;
  }
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function msg(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string; detail?: string } };
  if (e?.status === 0) return 'Cannot reach the catalog server.';
  if (e?.status === 401) return 'Session expired — please sign in again.';
  if (e?.status === 409) return e.error?.message ?? 'A capability with that name already exists.';
  return e?.error?.detail ?? e?.error?.message ?? 'Request failed. Please try again.';
}
