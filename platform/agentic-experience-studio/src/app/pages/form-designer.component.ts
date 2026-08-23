import { ChangeDetectionStrategy, Component, computed, HostListener, inject, input, signal } from '@angular/core';
import { CdkDrag, CdkDragHandle, CdkDropList, moveItemInArray, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { CodeViewComponent } from '../components/code-view.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
const FIELD_TYPES = ['text', 'email', 'tel', 'url', 'number', 'date', 'time', 'textarea', 'select', 'multiselect', 'checkbox', 'boolean', 'toggle', 'radio', 'range', 'file'] as const;

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
  imports: [MatProgressSpinnerModule, FormsModule, RouterLink, SchemaFormComponent, LifecycleBarComponent, HistoryPanelComponent, CdkDropList, CdkDrag, CdkDragHandle, MatTooltipModule, MatButtonModule, MatIconModule, MatChipsModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, CodeViewComponent],
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
          <button matButton type="button" (click)="addSection()"><mat-icon>add</mat-icon> Section</button>
          <button matButton="filled" type="button" (click)="save()" [disabled]="saving()">
            @if (saving()) { <mat-spinner diameter="16" class="btn-spin" aria-hidden="true"></mat-spinner> Saving… } @else { Save form }
          </button>
        </div>
      </div>

      <div class="actions-editor card card-pad" style="margin-bottom:var(--s4)">
        <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--s2)">
          <div>
            <span class="eyebrow">Action buttons</span>
            <span class="muted" style="font-size:var(--fs-xs); margin-left:var(--s2)">each bound to a governed capability — add as many as you need</span>
          </div>
          <button matButton type="button" (click)="addAction()"><mat-icon>add</mat-icon> Action</button>
        </div>
        @if (!actions().length) {
          <div class="muted" style="font-size:var(--fs-sm)">No buttons — a single Submit is added automatically.</div>
        }
        @for (a of actions(); track $index) {
          <div class="arow">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af flex">
              <mat-label>Label</mat-label>
              <input matInput [ngModel]="a.label" (ngModelChange)="patchAction($index, { label: $event })" placeholder="Button label" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af akind">
              <mat-label>Kind</mat-label>
              <mat-select [ngModel]="a.kind" (ngModelChange)="setActionKind($index, $event)">
                @for (k of actionKinds; track k) { <mat-option [value]="k">{{ k }}</mat-option> }
              </mat-select>
            </mat-form-field>
            @switch (a.kind) {
              @case ('tool') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af atgt">
                  <mat-label>Tool</mat-label>
                  <mat-select [ngModel]="a.tool ?? ''" (ngModelChange)="patchAction($index, { tool: $event })">
                    @for (t of toolSources(); track t.name) { <mat-option [value]="t.name"><mat-icon class="opt-ic">build</mat-icon> {{ t.name }}</mat-option> }
                    @for (d of decisions(); track d.name) { <mat-option [value]="d.name"><mat-icon class="opt-ic">rule</mat-icon> {{ d.name }} (decision)</mat-option> }
                  </mat-select>
                </mat-form-field>
              }
              @case ('action') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af atgt">
                  <mat-label>Action</mat-label>
                  <mat-select [ngModel]="a.action ?? ''" (ngModelChange)="patchAction($index, { action: $event })">
                    @for (ac of actionSources(); track ac.name) { <mat-option [value]="ac.name"><mat-icon class="opt-ic">bolt</mat-icon> {{ ac.name }}</mat-option> }
                  </mat-select>
                </mat-form-field>
              }
              @case ('navigate') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af atgt">
                  <mat-label>Target</mat-label>
                  <input matInput [ngModel]="a.to ?? ''" (ngModelChange)="patchAction($index, { to: $event })" placeholder="/route or url" />
                </mat-form-field>
              }
              @case ('emit') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af atgt">
                  <mat-label>Event</mat-label>
                  <input matInput [ngModel]="a.event ?? ''" (ngModelChange)="patchAction($index, { event: $event })" placeholder="event name" />
                </mat-form-field>
              }
              @default {
                <span class="atgt muted" style="font-size:var(--fs-xs); align-self:center">{{ a.kind }} — no target</span>
              }
            }
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af astyle">
              <mat-label>Style</mat-label>
              <mat-select [ngModel]="a.style ?? 'primary'" (ngModelChange)="patchAction($index, { style: $event })">
                <mat-option value="primary">primary</mat-option>
                <mat-option value="secondary">secondary</mat-option>
                <mat-option value="danger">danger</mat-option>
              </mat-select>
            </mat-form-field>
            <button class="rm" type="button" (click)="removeAction($index)" aria-label="Remove action"><mat-icon>close</mat-icon></button>
          </div>
        }
      </div>

      <div class="designer">
        <!-- Palette: the Component registry -->
        <aside class="palette card card-pad">
          <div class="eyebrow" style="margin-bottom:var(--s2)">Components</div>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af" style="width:100%">
            <mat-label>Search components</mat-label>
            <input matInput [(ngModel)]="q" autocomplete="off" />
          </mat-form-field>
          <div class="pal-list" cdkDropList id="form-palette" [cdkDropListData]="paletteSource"
               [cdkDropListConnectedTo]="['form-canvas']" [cdkDropListSortingDisabled]="true">
            @for (c of palette(); track c.name) {
              <div class="pal-item" cdkDrag [cdkDragData]="c.name" [title]="'Drag ' + c.name + ' onto the canvas'">
                <mat-icon class="grip">drag_indicator</mat-icon> {{ c.name }}
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
              <button type="button" class="hb" (click)="undo()" [disabled]="!canUndo()" matTooltip="Undo (⌘Z)" aria-label="Undo"><mat-icon>undo</mat-icon></button>
              <button type="button" class="hb" (click)="redo()" [disabled]="!canRedo()" matTooltip="Redo (⌘⇧Z)" aria-label="Redo"><mat-icon>redo</mat-icon></button>
            </span>
          </div>
          @if (!fields().length) {
            <div class="drop-empty">Drag components here to compose the form.</div>
          }
          @for (f of fields(); track $index) {
            <div class="frow" [class.section]="f.type === 'section'" cdkDrag [cdkDragData]="$index">
              <mat-icon class="grip" cdkDragHandle>drag_indicator</mat-icon>
              @if (f.type === 'section') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af flex">
                  <mat-label>Section title</mat-label>
                  <input matInput [ngModel]="f.label" (ngModelChange)="patch($index, { label: $event })" />
                </mat-form-field>
              } @else {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af flex">
                  <mat-label>Label</mat-label>
                  <input matInput [ngModel]="f.label" (ngModelChange)="patch($index, { label: $event })" />
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af ty">
                  <mat-label>Type</mat-label>
                  <mat-select [ngModel]="f.type" (ngModelChange)="patch($index, { type: $event })">
                    @for (t of fieldTypes; track t) { <mat-option [value]="t">{{ t }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-checkbox [ngModel]="f.required" (ngModelChange)="patch($index, { required: $event })">req</mat-checkbox>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af src">
                  <mat-label>Source</mat-label>
                  <mat-select [ngModel]="f.source ?? ''" (ngModelChange)="patch($index, { source: $event || undefined })">
                    <mat-option value="">no source</mat-option>
                    @for (s of sources(); track s.name) { <mat-option [value]="s.name">⇄ {{ s.name }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af val">
                  <mat-label>Rule</mat-label>
                  <mat-select [ngModel]="firstValidator(f)" (ngModelChange)="patch($index, { validators: $event ? [$event] : [] })">
                    <mat-option value="">no rule</mat-option>
                    @for (v of validators(); track v.name) { <mat-option [value]="v.name">✓ {{ v.name }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                @if (f.widget) { <mat-chip-set class="wchip-set"><mat-chip class="wchip" matTooltip="Composed from the ‘{{ f.widget }}’ component"><mat-icon matChipAvatar>widgets</mat-icon>{{ f.widget }}</mat-chip></mat-chip-set> }
              }
              <button class="rm" type="button" (click)="remove($index)" aria-label="Remove"><mat-icon>close</mat-icon></button>
            </div>
          }
        </div>

        <!-- Live preview -->
        <div class="preview card card-pad">
          <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--s3)">
            <div class="eyebrow" style="margin-bottom:0">{{ previewMode() === 'code' ? 'Form JSON' : 'Live preview' }}</div>
            <mat-button-toggle-group [value]="previewMode()" (change)="previewMode.set($event.value)"
              hideSingleSelectionIndicator aria-label="Preview mode" style="--mat-standard-button-toggle-height:30px; font-size:12px">
              <mat-button-toggle value="live" matTooltip="Rendered form">Preview</mat-button-toggle>
              <mat-button-toggle value="code" matTooltip="View the form JSON">Code</mat-button-toggle>
            </mat-button-toggle-group>
          </div>
          @if (previewMode() === 'code') {
            <aes-code-view [value]="previewBody()" [label]="form()?.name ?? 'form'" />
          } @else {
            <aes-schema-form [body]="previewBody()" />
          }
        </div>
      </div>
      @if (showHistory()) { <aes-history-panel [capabilityId]="id()" (close)="showHistory.set(false)" (changed)="reload()" /> }
    </div>
  `,
  styles: [`
    .btn-spin { --mdc-circular-progress-active-indicator-color: currentColor; display:inline-block; vertical-align:middle; margin-right:6px; }
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
    .grip { color:var(--text-faint); cursor:grab; font-size:18px; width:18px; height:18px; }
    .canvas { min-height:280px; display:flex; flex-direction:column; gap:var(--s2); }
    .drop-empty { border:2px dashed var(--border); border-radius:var(--r-md); padding:var(--s6); text-align:center; color:var(--text-muted); font-size:var(--fs-sm); }
    .frow { display:flex; align-items:center; gap:var(--s2); padding:8px; border:1px solid var(--border); border-radius:var(--r-sm); background:var(--surface); }
    .frow.section { background:var(--surface-2); border-style:dashed; }
    .frow .flex { flex:1; min-width:0; } .frow .sec { flex:1; font-weight:600; } .frow .ty { width:100px; } .frow .src { width:120px; } .frow .val { width:110px; } .frow .input { padding:7px 9px; font-size:var(--fs-sm); }
    .frow { flex-wrap: wrap; }
    .req { display:inline-flex; align-items:center; gap:5px; font-size:var(--fs-xs); color:var(--text-muted); white-space:nowrap; }
    .wchip-set { display:inline-flex; }
    .wchip.mat-mdc-chip { --mdc-chip-container-height:22px; --mdc-chip-elevated-container-color:var(--brand-soft); --mdc-chip-label-text-color:var(--brand);
      font-family:var(--font-mono); font-size:10px; }
    .wchip .mat-mdc-chip-avatar { font-size:13px; width:13px; height:13px; color:var(--brand); }
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
    .rm, .hb { display:inline-grid; place-items:center; }
    .rm mat-icon, .hb mat-icon { font-size:16px; width:16px; height:16px; }
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
  /** Form preview mode: the rendered form, or its JSON body. */
  protected readonly previewMode = signal<'live' | 'code'>('live');
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
