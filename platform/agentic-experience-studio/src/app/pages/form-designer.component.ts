import { ChangeDetectionStrategy, Component, computed, HostListener, inject, input, signal } from '@angular/core';
import { CdkDrag, CdkDragHandle, CdkDropList, moveItemInArray, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';
import { SchemaFormComponent, type SchemaField } from '../schema-form.component';
import { LifecycleBarComponent, type BarAction } from '../lifecycle-bar.component';
import { HistoryPanelComponent } from '../history-panel.component';
import { applyCapability, canApproveWith, handleBarAction, reportWriteError, type GovState } from '../governance-actions';
import { AuthService } from '../services/auth.service';
import type { ApprovalState } from '../services/capability-catalog.service';
import type { Lifecycle } from '../lifecycle';
import type { HasUnsavedChanges } from '../guards/unsaved-changes.guard';

/**
 * Drag-and-drop Form Designer. The Component registry is the palette; dragging a
 * component onto the canvas appends a field that `widget`-references it (lateral,
 * reorderable). A section is a container heading (hierarchy). The canvas IS the
 * form's `schema.fields[]` JSON — edited by direct manipulation, rendered live by
 * SchemaForm, saved to the form capability. Native HTML5 drag-and-drop (no deps).
 */
const FIELD_TYPES = ['text', 'email', 'number', 'date', 'textarea', 'select', 'checkbox', 'radio'] as const;

/** Action-bar kinds an author can attach (mirrors the lib's `FormActionDef`). */
const ACTION_KINDS = ['submit', 'reset', 'cancel', 'tool', 'action', 'navigate', 'emit'] as const;
type ActionKind = (typeof ACTION_KINDS)[number];
/** One authored button. Kind-specific target fields are set as the kind changes. */
interface DesignerAction {
  kind: ActionKind;
  label: string;
  style?: 'primary' | 'secondary' | 'danger';
  tool?: string;
  action?: string;
  to?: string;
  event?: string;
}

@Component({
  selector: 'aes-form-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, SchemaFormComponent, LifecycleBarComponent, HistoryPanelComponent, CdkDropList, CdkDrag, CdkDragHandle, MatTooltipModule, MatButtonModule],
  template: `
    <div class="page wide">
      <a routerLink="/forms" class="back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m15 6-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Forms
      </a>
      <div class="page-header" style="margin-top:var(--s4)">
        <div class="titles">
          <span class="eyebrow">Form designer · drag components to compose</span>
          <h1>{{ form()?.name ?? 'Form' }}</h1>
          <p class="subtitle">The canvas is the form's <code>schema.fields[]</code> — the same JSON the renderer and agents consume.</p>
        </div>
        <div class="row" style="gap:var(--s2); align-items:center">
          <aes-lifecycle-bar [lifecycle]="lifecycle()" [approvalState]="approvalState()" [canApprove]="canApprove()"
            [busy]="saving()" (action)="onBarAction($event)" (history)="showHistory.set(true)" />
          <button matButton type="button" (click)="addSection()">+ Section</button>
          <button matButton="filled" type="button" (click)="save()" [disabled]="saving()">
            @if (saving()) { <span class="spinner" aria-hidden="true"></span> Saving… } @else { Save form }
          </button>
        </div>
      </div>

      <div class="actions-editor card card-pad" style="margin-bottom:var(--s4)">
        <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--s2)">
          <div>
            <span class="eyebrow">Action buttons</span>
            <span class="muted" style="font-size:var(--fs-xs); margin-left:var(--s2)">each bound to a governed capability — add as many as you need</span>
          </div>
          <button matButton type="button" (click)="addAction()">+ Action</button>
        </div>
        @if (!actions().length) {
          <div class="muted" style="font-size:var(--fs-sm)">No buttons — a single Submit is added automatically.</div>
        }
        @for (a of actions(); track $index) {
          <div class="arow">
            <input class="input flex" [ngModel]="a.label" (ngModelChange)="patchAction($index, { label: $event })" placeholder="Button label" aria-label="Button label" />
            <select class="input akind" [ngModel]="a.kind" (ngModelChange)="setActionKind($index, $event)" aria-label="Action kind">
              @for (k of actionKinds; track k) { <option [value]="k">{{ k }}</option> }
            </select>
            @switch (a.kind) {
              @case ('tool') {
                <select class="input atgt" [ngModel]="a.tool ?? ''" (ngModelChange)="patchAction($index, { tool: $event })" aria-label="Tool">
                  <option value="" disabled>tool…</option>
                  @for (t of toolSources(); track t.name) { <option [value]="t.name">⚙ {{ t.name }}</option> }
                  @for (d of decisions(); track d.name) { <option [value]="d.name">◆ {{ d.name }} (decision)</option> }
                </select>
              }
              @case ('action') {
                <select class="input atgt" [ngModel]="a.action ?? ''" (ngModelChange)="patchAction($index, { action: $event })" aria-label="Action">
                  <option value="" disabled>action…</option>
                  @for (ac of actionSources(); track ac.name) { <option [value]="ac.name">⚡ {{ ac.name }}</option> }
                </select>
              }
              @case ('navigate') {
                <input class="input atgt" [ngModel]="a.to ?? ''" (ngModelChange)="patchAction($index, { to: $event })" placeholder="/route or url" aria-label="Navigate target" />
              }
              @case ('emit') {
                <input class="input atgt" [ngModel]="a.event ?? ''" (ngModelChange)="patchAction($index, { event: $event })" placeholder="event name" aria-label="Event name" />
              }
              @default {
                <span class="atgt muted" style="font-size:var(--fs-xs); align-self:center">{{ a.kind }} — no target</span>
              }
            }
            <select class="input astyle" [ngModel]="a.style ?? 'primary'" (ngModelChange)="patchAction($index, { style: $event })" title="Button style" aria-label="Button style">
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
              <option value="danger">danger</option>
            </select>
            <button class="rm" type="button" (click)="removeAction($index)" aria-label="Remove action">✕</button>
          </div>
        }
      </div>

      <div class="designer">
        <!-- Palette: the Component registry -->
        <aside class="palette card card-pad">
          <div class="eyebrow" style="margin-bottom:var(--s2)">Components</div>
          <input class="input" [(ngModel)]="q" placeholder="Search components…" autocomplete="off" />
          <div class="pal-list" cdkDropList id="form-palette" [cdkDropListData]="paletteSource"
               [cdkDropListConnectedTo]="['form-canvas']" [cdkDropListSortingDisabled]="true">
            @for (c of palette(); track c.name) {
              <div class="pal-item" cdkDrag [cdkDragData]="c.name" [title]="'Drag ' + c.name + ' onto the canvas'">
                <span class="grip">⋮⋮</span> {{ c.name }}
              </div>
            }
            @if (!palette().length) { <div class="muted" style="font-size:var(--fs-sm); padding:var(--s3)">No components match.</div> }
          </div>
        </aside>

        <!-- Canvas: the composed fields -->
        <div class="canvas card card-pad" cdkDropList id="form-canvas" [cdkDropListData]="fields()" (cdkDropListDropped)="onDrop($event)">
          <div class="eyebrow rowbar" style="margin-bottom:var(--s3)">
            <span>Canvas · {{ fields().length }} field{{ fields().length === 1 ? '' : 's' }}</span>
            <span class="hbtns">
              <button type="button" class="hb" (click)="undo()" [disabled]="!canUndo()" matTooltip="Undo (⌘Z)" aria-label="Undo">↶</button>
              <button type="button" class="hb" (click)="redo()" [disabled]="!canRedo()" matTooltip="Redo (⌘⇧Z)" aria-label="Redo">↷</button>
            </span>
          </div>
          @if (!fields().length) {
            <div class="drop-empty">Drag components here to compose the form.</div>
          }
          @for (f of fields(); track $index) {
            <div class="frow" [class.section]="f.type === 'section'" cdkDrag [cdkDragData]="$index">
              <span class="grip" cdkDragHandle>⋮⋮</span>
              @if (f.type === 'section') {
                <input class="input sec" [ngModel]="f.label" (ngModelChange)="patch($index, { label: $event })" placeholder="Section title" />
              } @else {
                <input class="input flex" [ngModel]="f.label" (ngModelChange)="patch($index, { label: $event })" placeholder="Label" />
                <select class="input ty" [ngModel]="f.type" (ngModelChange)="patch($index, { type: $event })">
                  @for (t of fieldTypes; track t) { <option [value]="t">{{ t }}</option> }
                </select>
                <label class="req"><input type="checkbox" [ngModel]="f.required" (ngModelChange)="patch($index, { required: $event })" /> req</label>
                <select class="input src" [ngModel]="f.source ?? ''" (ngModelChange)="patch($index, { source: $event || undefined })" title="Bind this field's data to a governed source">
                  <option value="">no source</option>
                  @for (s of sources(); track s.name) { <option [value]="s.name">⇄ {{ s.name }}</option> }
                </select>
                <select class="input val" [ngModel]="firstValidator(f)" (ngModelChange)="patch($index, { validators: $event ? [$event] : [] })" title="Attach a governed validation rule">
                  <option value="">no rule</option>
                  @for (v of validators(); track v.name) { <option [value]="v.name">⛨ {{ v.name }}</option> }
                </select>
                @if (f.widget) { <span class="wchip" title="Composed from the ‘{{ f.widget }}’ component">⛃ {{ f.widget }}</span> }
              }
              <button class="rm" type="button" (click)="remove($index)" aria-label="Remove">✕</button>
            </div>
          }
        </div>

        <!-- Live preview -->
        <div class="preview card card-pad">
          <div class="eyebrow" style="margin-bottom:var(--s3)">Live preview</div>
          <aes-schema-form [body]="previewBody()" />
        </div>
      </div>
      @if (showHistory()) { <aes-history-panel [capabilityId]="id()" (close)="showHistory.set(false)" (changed)="reload()" /> }
    </div>
  `,
  styles: [`
    .back { display:inline-flex; align-items:center; gap:var(--s1); color:var(--text-muted); font-size:var(--fs-sm); text-decoration:none; }
    .back:hover { color:var(--text); }
    .designer { display:grid; grid-template-columns: 260px minmax(0, 1fr) minmax(360px, 460px); gap:var(--s4); align-items:start; }
    @media (max-width: 1000px){ .designer { grid-template-columns: 1fr; } }
    .palette, .preview { position: sticky; top: var(--s4); max-height: calc(100vh - var(--s6)); overflow-y: auto; }
    @media (max-width: 1000px){ .palette, .preview { position: static; max-height: none; } }
    .palette .pal-list { display:flex; flex-direction:column; gap:6px; margin-top:var(--s3); max-height:60vh; overflow-y:auto; }
    .pal-item { display:flex; align-items:center; gap:8px; padding:9px 11px; border:1px solid var(--border); border-radius:var(--r-sm);
      background:var(--surface-2); font-size:var(--fs-sm); font-family:var(--font-mono); cursor:grab; }
    .pal-item:hover { border-color:var(--brand); color:var(--brand); }
    .grip { color:var(--text-faint); cursor:grab; letter-spacing:-2px; }
    .canvas { min-height:280px; display:flex; flex-direction:column; gap:var(--s2); }
    .drop-empty { border:2px dashed var(--border); border-radius:var(--r-md); padding:var(--s6); text-align:center; color:var(--text-muted); font-size:var(--fs-sm); }
    .frow { display:flex; align-items:center; gap:var(--s2); padding:8px; border:1px solid var(--border); border-radius:var(--r-sm); background:var(--surface); }
    .frow.section { background:var(--surface-2); border-style:dashed; }
    .frow .flex { flex:1; min-width:0; } .frow .sec { flex:1; font-weight:600; } .frow .ty { width:100px; } .frow .src { width:120px; } .frow .val { width:110px; } .frow .input { padding:7px 9px; font-size:var(--fs-sm); }
    .frow { flex-wrap: wrap; }
    .req { display:inline-flex; align-items:center; gap:5px; font-size:var(--fs-xs); color:var(--text-muted); white-space:nowrap; }
    .wchip { font-family:var(--font-mono); font-size:10px; color:var(--brand); background:var(--brand-soft); padding:2px 7px; border-radius:var(--r-full); white-space:nowrap; }
    .rm { border:1px solid var(--border); background:var(--surface); border-radius:var(--r-sm); width:28px; height:28px; cursor:pointer; color:var(--text-muted); }
    .rm:hover { border-color:var(--danger); color:var(--danger); }
    /* CDK drag-drop states + undo toolbar (Studio-token styled). */
    .frow.cdk-drag-preview { box-shadow:0 8px 24px -8px rgba(0,0,0,.35); border-color:var(--brand); background:var(--surface); }
    .frow.cdk-drag-placeholder { opacity:.35; border-style:dashed; }
    .grip[cdkdraghandle] { cursor:grab; } .frow.cdk-drag-dragging .grip { cursor:grabbing; }
    .canvas.cdk-drop-list-dragging { outline:1px dashed var(--brand); outline-offset:2px; }
    .cdk-drag-animating { transition:transform .18s cubic-bezier(0,0,.2,1); }
    .rowbar { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .hbtns { display:inline-flex; gap:4px; }
    .hb { border:1px solid var(--border); background:var(--surface); color:var(--text-muted); border-radius:var(--r-sm); width:26px; height:24px; font-size:14px; line-height:1; cursor:pointer; }
    .hb:hover:not([disabled]) { border-color:var(--brand); color:var(--brand); }
    .hb[disabled] { opacity:.35; cursor:default; }
    .arow { display:flex; align-items:center; gap:var(--s2); padding:8px; border:1px solid var(--border); border-radius:var(--r-sm); background:var(--surface); margin-top:var(--s2); flex-wrap:wrap; }
    .arow .flex { flex:1; min-width:120px; } .arow .akind { width:110px; } .arow .atgt { width:150px; } .arow .astyle { width:110px; } .arow .input { padding:7px 9px; font-size:var(--fs-sm); }
  `],
})
export class FormDesignerComponent implements HasUnsavedChanges {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);

  readonly id = input.required<string>();
  readonly fieldTypes = FIELD_TYPES;

  readonly form = signal<Capability | null>(null);
  readonly fields = signal<SchemaField[]>([]);
  readonly components = signal<readonly Capability[]>([]);
  /** dataSource + tool registry entries a field can bind to (governed data refs). */
  readonly sources = signal<readonly Capability[]>([]);
  /** validation-registry entries a field can attach as a governed rule. */
  readonly validators = signal<readonly Capability[]>([]);
  readonly saving = signal(false);
  readonly lifecycle = signal<Lifecycle>('draft');
  readonly approvalState = signal<ApprovalState>('draft');
  readonly capVersion = signal(0);
  readonly showHistory = signal(false);
  private readonly auth = inject(AuthService);
  readonly canApprove = computed(() => canApproveWith(this.auth.roles()));
  private pristine = '';
  q = '';
  readonly actionKinds = ACTION_KINDS;
  /** The form's action bar — multiple governed buttons. */
  readonly actions = signal<DesignerAction[]>([]);
  /** ActionDef capabilities a `kind:'action'` button can dispatch. */
  readonly actionSources = signal<readonly Capability[]>([]);
  /** Decisions a button can run — each is exposed as a tool at runtime (form values → outputs). */
  readonly decisions = signal<readonly Capability[]>([]);

  readonly palette = computed(() => {
    const query = this.q.trim().toLowerCase();
    return this.components().filter((c) => !query || c.name.toLowerCase().includes(query));
  });
  readonly toolSources = computed(() => this.sources().filter((c) => c.kind === 'tool'));
  readonly previewBody = computed(() => ({
    schema: { fields: this.fields(), actions: this.actions(), submit: legacySubmit(this.actions()) },
  }));

  constructor() { queueMicrotask(() => this.load()); }

  private load(): void {
    this.catalog.get(this.id()).subscribe({
      next: (c) => {
        this.form.set(c);
        const schema = (c.body?.['schema'] ?? {}) as { fields?: SchemaField[]; submit?: string; actions?: DesignerAction[] };
        this.fields.set([...(schema.fields ?? [])]);
        this.past.set([]); this.future.set([]); // fresh undo history from the loaded form
        this.actions.set(hydrateActions(schema.actions, schema.submit));
        applyCapability(this.gov(), c);
        this.pristine = this.snapshot();
      },
      error: () => this.toast.error('Load failed', 'Could not load the form.'),
    });
    this.catalog.listByKind('component').subscribe({ next: (r) => this.components.set(r.items), error: () => {} });
    // Governed data sources: dataSource + tool capabilities (never raw URLs).
    this.catalog.listByKind('datasource').subscribe({ next: (r) => this.sources.update((s) => [...s, ...r.items]), error: () => {} });
    this.catalog.listByKind('tool').subscribe({ next: (r) => this.sources.update((s) => [...s, ...r.items]), error: () => {} });
    this.catalog.listByKind('action').subscribe({ next: (r) => this.actionSources.set(r.items), error: () => {} });
    this.catalog.listByKind('validation').subscribe({ next: (r) => this.validators.set(r.items), error: () => {} });
    // Decisions become runtime tools (name-matched); a button can run one on the form's values.
    this.catalog.listByKind('decision').subscribe({ next: (r) => this.decisions.set(r.items), error: () => {} });
  }

  firstValidator(f: SchemaField): string { return f.validators?.[0] ?? ''; }

  // ── action bar ────────────────────────────────────────────────────────────
  addAction(): void { this.actions.update((a) => [...a, { kind: 'submit', label: 'Submit' }]); }
  removeAction(i: number): void { this.actions.update((a) => a.filter((_, idx) => idx !== i)); }
  patchAction(i: number, part: Partial<DesignerAction>): void {
    this.actions.update((a) => a.map((x, idx) => (idx === i ? { ...x, ...part } : x)));
  }
  /** Changing kind clears now-irrelevant target fields so we never save stale ones. */
  setActionKind(i: number, kind: ActionKind): void {
    this.actions.update((a) => a.map((x, idx) => (idx === i ? { kind, label: x.label, style: x.style } : x)));
  }

  // ── drag + drop (CDK) — reorder within the canvas, or copy from the palette ──
  protected readonly paletteSource: readonly string[] = [];
  protected onDrop(event: CdkDragDrop<SchemaField[]>): void {
    if (event.previousContainer === event.container) {
      this.moveField(event.previousIndex, event.currentIndex);
    } else {
      this.insertField(event.currentIndex, event.item.data as string);
    }
  }

  // ── undo / redo over the fields() model (structural edits: add/move/remove) ──
  private readonly past = signal<SchemaField[][]>([]);
  private readonly future = signal<SchemaField[][]>([]);
  readonly canUndo = computed(() => this.past().length > 0);
  readonly canRedo = computed(() => this.future().length > 0);
  private pushHistory(): void { this.past.update((h) => [...h.slice(-49), this.fields()]); this.future.set([]); }

  undo(): void {
    const h = this.past();
    if (!h.length) return;
    this.future.update((f) => [this.fields(), ...f]);
    this.past.set(h.slice(0, -1));
    this.fields.set(h[h.length - 1]!);
  }
  redo(): void {
    const f = this.future();
    if (!f.length) return;
    this.past.update((p) => [...p, this.fields()]);
    this.future.set(f.slice(1));
    this.fields.set(f[0]!);
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); this.redo(); }
  }

  // ── model ops ───────────────────────────────────────────────────────────────
  private insertField(at: number, widget: string): void {
    this.pushHistory();
    this.fields.update((fs) => { const next = [...fs]; next.splice(at, 0, this.makeField(widget, fs)); return next; });
  }
  private moveField(from: number, to: number): void {
    if (from === to) return;
    this.pushHistory();
    this.fields.update((fs) => { const next = [...fs]; const [x] = next.splice(from, 1); next.splice(to, 0, x!); return next; });
  }
  patch(i: number, part: Partial<SchemaField>): void {
    this.fields.update((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...part } : f)));
  }
  remove(i: number): void { this.pushHistory(); this.fields.update((fs) => fs.filter((_, idx) => idx !== i)); }
  addSection(): void { this.pushHistory(); this.fields.update((fs) => [...fs, { name: `section_${fs.length}`, type: 'section', label: 'New section' }]); }

  private makeField(widget: string, existing: readonly SchemaField[]): SchemaField {
    const type = inferType(widget);
    let name = widget.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const taken = new Set(existing.map((f) => f.name));
    if (taken.has(name)) { let n = 2; while (taken.has(`${name}_${n}`)) n++; name = `${name}_${n}`; }
    return { name, label: humanize(widget), type, widget, required: false, ...(type === 'select' ? { options: ['Option A', 'Option B'] } : {}) };
  }

  // ── governance + unsaved-changes guard ──────────────────────────────────────
  private snapshot(): string { return JSON.stringify({ fields: this.fields(), actions: this.actions() }); }
  hasUnsavedChanges(): boolean { return !!this.form() && this.snapshot() !== this.pristine; }
  private gov(): GovState { return { lifecycle: this.lifecycle, approvalState: this.approvalState, version: this.capVersion }; }
  protected onBarAction(a: BarAction): void { handleBarAction(a, this.id(), this.gov(), this.catalog, this.toast); }
  protected reload(): void { this.sources.set([]); this.load(); }

  save(): void {
    const form = this.form();
    if (!form) return;
    this.saving.set(true);
    const actions = this.actions();
    const body = { ...form.body, schema: { fields: this.fields(), actions, submit: legacySubmit(actions) } };
    this.catalog.update(form.id, { body }, this.capVersion()).subscribe({
      next: (c) => { this.saving.set(false); this.pristine = this.snapshot(); applyCapability(this.gov(), c); this.toast.success('Form saved', `“${form.name}” schema updated.`); },
      error: (e) => { this.saving.set(false); reportWriteError(this.toast, e); },
    });
  }
}

/** Back-compat `submit` string: the first tool button's target, else usage-event. */
function legacySubmit(actions: readonly DesignerAction[]): string {
  return actions.find((a) => a.kind === 'tool')?.tool ?? 'usage-event';
}

/**
 * Load the action bar for the designer: prefer authored `actions[]`; otherwise
 * synthesize a single row from the legacy `submit` string so old forms open cleanly.
 */
function hydrateActions(actions: DesignerAction[] | undefined, submit: string | undefined): DesignerAction[] {
  if (actions?.length) return actions.map((a) => ({ ...a }));
  return submit && submit !== 'usage-event'
    ? [{ kind: 'tool', label: 'Submit', tool: submit }]
    : [{ kind: 'submit', label: 'Submit' }];
}

function inferType(widget: string): SchemaField['type'] {
  if (/picker|select|category|priority|role|status/i.test(widget)) return 'select';
  if (/describe|note|comment|message|text-?area/i.test(widget)) return 'textarea';
  if (/amount|price|number|qty|count/i.test(widget)) return 'number';
  if (/date|day|when/i.test(widget)) return 'date';
  if (/toggle|enable|check/i.test(widget)) return 'checkbox';
  return 'text';
}
function humanize(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
