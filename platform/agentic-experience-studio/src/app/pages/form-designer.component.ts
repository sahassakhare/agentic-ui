import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';
import { SchemaFormComponent, type SchemaField } from '../schema-form.component';

/**
 * Drag-and-drop Form Designer. The Component registry is the palette; dragging a
 * component onto the canvas appends a field that `widget`-references it (lateral,
 * reorderable). A section is a container heading (hierarchy). The canvas IS the
 * form's `schema.fields[]` JSON — edited by direct manipulation, rendered live by
 * SchemaForm, saved to the form capability. Native HTML5 drag-and-drop (no deps).
 */
type DragSrc = { kind: 'palette'; widget: string } | { kind: 'field'; index: number } | null;
const FIELD_TYPES = ['text', 'email', 'number', 'date', 'textarea', 'select', 'checkbox', 'radio'] as const;

@Component({
  selector: 'aes-form-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, SchemaFormComponent],
  template: `
    <div class="page">
      <a routerLink="/forms" class="back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m15 6-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Forms
      </a>
      <div class="page-header" style="margin-top:var(--s4)">
        <div class="titles">
          <span class="eyebrow">Form designer · drag components to compose</span>
          <h1>{{ form()?.name ?? 'Form' }}</h1>
          <p class="subtitle">The canvas is the form's <code>schema.fields[]</code> — the same JSON the renderer and agents consume.</p>
        </div>
        <div class="row" style="gap:var(--s2)">
          <button class="btn" type="button" (click)="addSection()">+ Section</button>
          <button class="btn btn-primary" type="button" (click)="save()" [disabled]="saving()">
            @if (saving()) { <span class="spinner" aria-hidden="true"></span> Saving… } @else { Save form }
          </button>
        </div>
      </div>

      <div class="row" style="gap:var(--s2); align-items:center; margin-bottom:var(--s4)">
        <span class="muted" style="font-size:var(--fs-sm)">On submit →</span>
        <select class="input" style="width:auto" [(ngModel)]="submitTarget" aria-label="Submit target">
          <option value="usage-event">usage-event · log</option>
          @for (t of toolSources(); track t.name) { <option [value]="t.name">{{ t.name }} · tool</option> }
        </select>
        <span class="muted" style="font-size:var(--fs-xs)">a governed tool/backend — not a URL</span>
      </div>

      <div class="designer">
        <!-- Palette: the Component registry -->
        <aside class="palette card card-pad">
          <div class="eyebrow" style="margin-bottom:var(--s2)">Components</div>
          <input class="input" [(ngModel)]="q" placeholder="Search components…" autocomplete="off" />
          <div class="pal-list">
            @for (c of palette(); track c.name) {
              <div class="pal-item" draggable="true" (dragstart)="startPaletteDrag(c.name)" (dragend)="drag.set(null)" [title]="'Drag ' + c.name + ' onto the canvas'">
                <span class="grip">⋮⋮</span> {{ c.name }}
              </div>
            }
            @if (!palette().length) { <div class="muted" style="font-size:var(--fs-sm); padding:var(--s3)">No components match.</div> }
          </div>
        </aside>

        <!-- Canvas: the composed fields -->
        <div class="canvas card card-pad" (dragover)="allow($event)" (drop)="dropOnCanvas($event)">
          <div class="eyebrow" style="margin-bottom:var(--s3)">Canvas · {{ fields().length }} field{{ fields().length === 1 ? '' : 's' }}</div>
          @if (!fields().length) {
            <div class="drop-empty">Drag components here to compose the form.</div>
          }
          @for (f of fields(); track $index) {
            <div class="frow" [class.section]="f.type === 'section'" draggable="true"
                 (dragstart)="startFieldDrag($index, $event)" (dragend)="drag.set(null)"
                 (dragover)="allow($event)" (drop)="dropOnField($index, $event)">
              <span class="grip">⋮⋮</span>
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
    </div>
  `,
  styles: [`
    .back { display:inline-flex; align-items:center; gap:var(--s1); color:var(--text-muted); font-size:var(--fs-sm); text-decoration:none; }
    .back:hover { color:var(--text); }
    .designer { display:grid; grid-template-columns: 240px 1fr 320px; gap:var(--s4); align-items:start; }
    @media (max-width: 1100px){ .designer { grid-template-columns: 1fr; } }
    .palette .pal-list { display:flex; flex-direction:column; gap:6px; margin-top:var(--s3); max-height:60vh; overflow-y:auto; }
    .pal-item { display:flex; align-items:center; gap:8px; padding:9px 11px; border:1px solid var(--border); border-radius:var(--r-sm);
      background:var(--surface-2); font-size:var(--fs-sm); font-family:var(--font-mono); cursor:grab; }
    .pal-item:hover { border-color:var(--brand); color:var(--brand); }
    .grip { color:var(--text-faint); cursor:grab; letter-spacing:-2px; }
    .canvas { min-height:280px; display:flex; flex-direction:column; gap:var(--s2); }
    .drop-empty { border:2px dashed var(--border); border-radius:var(--r-md); padding:var(--s6); text-align:center; color:var(--text-muted); font-size:var(--fs-sm); }
    .frow { display:flex; align-items:center; gap:var(--s2); padding:8px; border:1px solid var(--border); border-radius:var(--r-sm); background:var(--surface); }
    .frow.section { background:var(--surface-2); border-style:dashed; }
    .frow .flex { flex:1; min-width:0; } .frow .sec { flex:1; font-weight:600; } .frow .ty { width:110px; } .frow .src { width:130px; } .frow .input { padding:7px 9px; font-size:var(--fs-sm); }
    .req { display:inline-flex; align-items:center; gap:5px; font-size:var(--fs-xs); color:var(--text-muted); white-space:nowrap; }
    .wchip { font-family:var(--font-mono); font-size:10px; color:var(--brand); background:var(--brand-soft); padding:2px 7px; border-radius:var(--r-full); white-space:nowrap; }
    .rm { border:1px solid var(--border); background:var(--surface); border-radius:var(--r-sm); width:28px; height:28px; cursor:pointer; color:var(--text-muted); }
    .rm:hover { border-color:var(--danger); color:var(--danger); }
  `],
})
export class FormDesignerComponent {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);

  readonly id = input.required<string>();
  readonly fieldTypes = FIELD_TYPES;

  readonly form = signal<Capability | null>(null);
  readonly fields = signal<SchemaField[]>([]);
  readonly components = signal<readonly Capability[]>([]);
  /** dataSource + tool registry entries a field can bind to (governed data refs). */
  readonly sources = signal<readonly Capability[]>([]);
  readonly saving = signal(false);
  readonly drag = signal<DragSrc>(null);
  q = '';
  /** Form-level submit target — a `tool` capability or the built-in usage-event. */
  submitTarget = 'usage-event';

  readonly palette = computed(() => {
    const query = this.q.trim().toLowerCase();
    return this.components().filter((c) => !query || c.name.toLowerCase().includes(query));
  });
  readonly toolSources = computed(() => this.sources().filter((c) => c.kind === 'tool'));
  readonly previewBody = computed(() => ({ schema: { fields: this.fields(), submit: this.submitTarget } }));

  constructor() { queueMicrotask(() => this.load()); }

  private load(): void {
    this.catalog.get(this.id()).subscribe({
      next: (c) => {
        this.form.set(c);
        const schema = (c.body?.['schema'] ?? {}) as { fields?: SchemaField[]; submit?: string };
        this.fields.set([...(schema.fields ?? [])]);
        this.submitTarget = schema.submit ?? 'usage-event';
      },
      error: () => this.toast.error('Load failed', 'Could not load the form.'),
    });
    this.catalog.listByKind('component').subscribe({ next: (r) => this.components.set(r.items), error: () => {} });
    // Governed data sources: dataSource + tool capabilities (never raw URLs).
    this.catalog.listByKind('datasource').subscribe({ next: (r) => this.sources.update((s) => [...s, ...r.items]), error: () => {} });
    this.catalog.listByKind('tool').subscribe({ next: (r) => this.sources.update((s) => [...s, ...r.items]), error: () => {} });
  }

  // ── drag + drop (native HTML5) ──────────────────────────────────────────────
  allow(e: DragEvent): void { e.preventDefault(); }
  startPaletteDrag(widget: string): void { this.drag.set({ kind: 'palette', widget }); }
  startFieldDrag(index: number, e: DragEvent): void { e.stopPropagation(); this.drag.set({ kind: 'field', index }); }

  dropOnCanvas(e: DragEvent): void {
    e.preventDefault();
    const d = this.drag();
    if (d?.kind === 'palette') this.insertField(this.fields().length, d.widget);
    this.drag.set(null);
  }
  dropOnField(target: number, e: DragEvent): void {
    e.preventDefault(); e.stopPropagation();
    const d = this.drag();
    if (d?.kind === 'palette') this.insertField(target, d.widget);
    else if (d?.kind === 'field') this.moveField(d.index, target);
    this.drag.set(null);
  }

  // ── model ops ───────────────────────────────────────────────────────────────
  private insertField(at: number, widget: string): void {
    this.fields.update((fs) => { const next = [...fs]; next.splice(at, 0, this.makeField(widget, fs)); return next; });
  }
  private moveField(from: number, to: number): void {
    if (from === to) return;
    this.fields.update((fs) => { const next = [...fs]; const [x] = next.splice(from, 1); next.splice(to, 0, x!); return next; });
  }
  patch(i: number, part: Partial<SchemaField>): void {
    this.fields.update((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...part } : f)));
  }
  remove(i: number): void { this.fields.update((fs) => fs.filter((_, idx) => idx !== i)); }
  addSection(): void { this.fields.update((fs) => [...fs, { name: `section_${fs.length}`, type: 'section', label: 'New section' }]); }

  private makeField(widget: string, existing: readonly SchemaField[]): SchemaField {
    const type = inferType(widget);
    let name = widget.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const taken = new Set(existing.map((f) => f.name));
    if (taken.has(name)) { let n = 2; while (taken.has(`${name}_${n}`)) n++; name = `${name}_${n}`; }
    return { name, label: humanize(widget), type, widget, required: false, ...(type === 'select' ? { options: ['Option A', 'Option B'] } : {}) };
  }

  save(): void {
    const form = this.form();
    if (!form) return;
    this.saving.set(true);
    const body = { ...form.body, schema: { fields: this.fields(), submit: this.submitTarget } };
    this.catalog.update(form.id, { body }).subscribe({
      next: () => { this.saving.set(false); this.toast.success('Form saved', `“${form.name}” schema updated.`); },
      error: () => { this.saving.set(false); this.toast.error('Save failed', 'Could not save the form.'); },
    });
  }
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
