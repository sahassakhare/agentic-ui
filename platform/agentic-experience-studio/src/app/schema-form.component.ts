import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';

/**
 * Renders a form LIVE from its declarative JSON schema (`body.schema`) — the same
 * JSON an agent consumes as its tool-input schema and the planner uses to compose
 * the form from other registries (fields may `widget`-reference a component,
 * `source`-reference a dataSource/tool, and `validators`-reference validation
 * capabilities). Validation is two-layer: inline constraints (declarative) are
 * enforced live here; governed `validators` are resolved by the platform at
 * runtime (shown as chips). Pure/standalone; interactive controls.
 */
export interface FieldValidation {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  readonly email?: boolean;
  readonly message?: string;
}
export interface SchemaField {
  readonly name: string;
  readonly type?: 'text' | 'email' | 'tel' | 'url' | 'password' | 'color' | 'number' | 'date' | 'time' | 'textarea'
    | 'select' | 'multiselect' | 'checkbox' | 'boolean' | 'toggle' | 'radio' | 'range' | 'slider' | 'file' | 'section';
  readonly label?: string;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly options?: readonly string[];
  /** Component-registry entry that renders this field (composition). */
  readonly widget?: string;
  /** dataSource/tool registry entry that provides this field's data (governed). */
  readonly source?: string;
  /** Inline, declarative constraints — enforced live + honored by agents. */
  readonly validation?: FieldValidation;
  /** Governed validation-registry entries (cross-field/business rules). */
  readonly validators?: readonly string[];
}
/** A form action-bar button (preview mirror of the lib's `FormActionDef`). */
export interface PreviewFormAction {
  readonly kind: 'submit' | 'reset' | 'cancel' | 'tool' | 'action' | 'navigate' | 'emit';
  readonly label: string;
  readonly style?: 'primary' | 'secondary' | 'danger';
}
export interface FormSchema {
  readonly fields?: readonly SchemaField[];
  readonly submit?: string;
  readonly actions?: readonly PreviewFormAction[];
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

@Component({
  selector: 'aes-schema-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatRadioModule, MatButtonModule, MatSlideToggleModule, MatSliderModule],
  template: `
    @if (fields().length) {
      <form class="sf" (submit)="$event.preventDefault()">
        @for (f of fields(); track $index) {
          @if (f.type === 'section') {
            <div class="sf-section">{{ f.label ?? f.name }}</div>
          } @else {
          <div class="sf-field">
            <label class="sf-lbl" [attr.for]="'sf-'+f.name">
              {{ f.label ?? f.name }} @if (f.required) { <span class="sf-req">*</span> }
              @if (f.widget) { <span class="sf-widget" title="Rendered by the ‘{{ f.widget }}’ component">◫ {{ f.widget }}</span> }
              @if (f.source) { <span class="sf-source" title="Data from the ‘{{ f.source }}’ source (resolved by the platform)">⇄ {{ f.source }}</span> }
              @for (v of f.validators ?? []; track v) { <span class="sf-val" title="Validated by the ‘{{ v }}’ rule (resolved at runtime)">✓ {{ v }}</span> }
            </label>
            @switch (ctrl(f)) {
              @case ('textarea') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <textarea matInput rows="3" [placeholder]="f.placeholder ?? ''" [value]="val(f.name)" (input)="set(f.name, $event)" (blur)="touch(f.name)"></textarea>
                </mat-form-field>
              }
              @case ('select') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <mat-select [value]="val(f.name)" (selectionChange)="setVal(f.name, $event.value)">
                    @for (o of f.options ?? []; track o) { <mat-option [value]="o">{{ o }}</mat-option> }
                  </mat-select>
                  @if (!(f.options?.length) && f.source) { <mat-hint>Options from ‘{{ f.source }}’ at runtime</mat-hint> }
                </mat-form-field>
              }
              @case ('multiselect') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <mat-select multiple [value]="valArr(f.name)" (selectionChange)="setVal(f.name, $event.value)">
                    @for (o of f.options ?? []; track o) { <mat-option [value]="o">{{ o }}</mat-option> }
                  </mat-select>
                  @if (!(f.options?.length) && f.source) { <mat-hint>Options from ‘{{ f.source }}’ at runtime</mat-hint> }
                </mat-form-field>
              }
              @case ('checkbox') {
                <mat-checkbox [checked]="!!val(f.name)" (change)="setVal(f.name, $event.checked)">{{ f.placeholder ?? f.label ?? 'Yes' }}</mat-checkbox>
              }
              @case ('toggle') {
                <mat-slide-toggle [checked]="!!val(f.name)" (change)="setVal(f.name, $event.checked)">{{ f.placeholder ?? f.label ?? 'On' }}</mat-slide-toggle>
              }
              @case ('radio') {
                <mat-radio-group class="sf-radios" [value]="val(f.name)" (change)="setVal(f.name, $event.value)">
                  @for (o of f.options ?? []; track o) { <mat-radio-button [value]="o">{{ o }}</mat-radio-button> }
                </mat-radio-group>
              }
              @case ('number') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <input matInput type="number" [placeholder]="f.placeholder ?? ''" [value]="val(f.name)" (input)="set(f.name, $event)" (blur)="touch(f.name)" />
                </mat-form-field>
              }
              @case ('date') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <input matInput type="date" [value]="val(f.name)" (input)="set(f.name, $event)" (blur)="touch(f.name)" />
                </mat-form-field>
              }
              @case ('time') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <input matInput type="time" [value]="val(f.name)" (input)="set(f.name, $event)" (blur)="touch(f.name)" />
                </mat-form-field>
              }
              @case ('range') {
                <div class="sf-range">
                  <mat-slider><input matSliderThumb [value]="+(val(f.name) || 0)" (valueChange)="setVal(f.name, $event)" /></mat-slider>
                  <span class="sf-rangeval">{{ val(f.name) || 0 }}</span>
                </div>
              }
              @case ('file') {
                <div class="sf-file">
                  <button matButton type="button" (click)="picker.click()">Choose file…</button>
                  <input #picker type="file" hidden (change)="onFile(f.name, $event)" />
                  <span class="sf-fname" [class.muted]="!val(f.name)">{{ val(f.name) || 'No file selected' }}</span>
                </div>
              }
              @case ('slot') {
                <div class="sf-slot" title="Rendered by the ‘{{ f.widget }}’ component at runtime (loaded from its remote)">
                  <span class="sf-slot-glyph">◫</span>
                  <span class="sf-slot-meta">
                    <span class="sf-slot-nm">{{ f.widget }}</span>
                    <span class="sf-slot-sub">component surface — renders at runtime</span>
                  </span>
                </div>
              }
              @default {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <input matInput [type]="inputType(f)" [placeholder]="f.placeholder ?? ''" [value]="val(f.name)" (input)="set(f.name, $event)" (blur)="touch(f.name)" />
                </mat-form-field>
              }
            }
            @if (err(f); as e) { <span class="sf-err">{{ e }}</span> }
            @else if (hint(f); as h) { <span class="sf-hint">{{ h }}</span> }
          </div>
          }
        }
        <div class="sf-actions">
          @for (a of actions(); track $index) {
            <button matButton="filled" type="button"
              [class.sf-secondary]="a.style === 'secondary'"
              [class.sf-danger]="a.style === 'danger'">{{ a.label }}</button>
          }
        </div>
      </form>
    } @else {
      <div class="sf-none">No <code>schema.fields</code> to render. Add fields to compose this form.</div>
    }
  `,
  styles: [`
    :host { display: block; }
    .sf { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4); border: 1px solid var(--border);
      border-radius: var(--r-md); background: var(--surface); }
    .sf-section { font-size: var(--fs-xs); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--brand); padding-top: var(--s2); border-top: 1px solid var(--border); }
    .sf-field { display: flex; flex-direction: column; gap: 5px; }
    .sf-mf { width: 100%; }
    .sf-secondary { --mat-sys-primary: var(--surface-2); --mat-sys-on-primary: var(--text); }
    .sf-danger { --mat-sys-primary: var(--danger); --mat-sys-on-primary: #fff; }
    .sf-lbl { font-size: var(--fs-sm); font-weight: 500; display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
    .sf-req { color: var(--danger); }
    .sf-widget { font-family: var(--font-mono); font-size: 10px; color: var(--brand); background: var(--brand-soft); padding: 1px 6px; border-radius: var(--r-full); }
    .sf-source { font-family: var(--font-mono); font-size: 10px; color: var(--ok); background: var(--ok-soft); padding: 1px 6px; border-radius: var(--r-full); }
    .sf-val { font-family: var(--font-mono); font-size: 10px; color: var(--warn); background: var(--warn-soft); padding: 1px 6px; border-radius: var(--r-full); }
    .sf-in { font: inherit; font-size: var(--fs-sm); padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface); color: var(--text); }
    .sf-in:focus { outline: none; border-color: var(--brand); }
    .sf-in.bad { border-color: var(--danger); }
    .sf-check, .sf-radio { display: inline-flex; align-items: center; gap: 7px; font-size: var(--fs-sm); }
    .sf-radios { display: flex; gap: var(--s4); flex-wrap: wrap; }
    .sf-slot { display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s4); border: 1px dashed var(--border-strong, var(--border));
      border-radius: var(--r-md); background: var(--brand-soft); }
    .sf-slot-glyph { display: grid; place-items: center; width: 30px; height: 30px; border-radius: var(--r-sm); background: var(--surface);
      color: var(--brand); font-size: 16px; flex: none; }
    .sf-slot-meta { display: flex; flex-direction: column; min-width: 0; }
    .sf-slot-nm { font-family: var(--font-mono); font-size: var(--fs-sm); font-weight: 600; color: var(--brand); }
    .sf-slot-sub { font-size: var(--fs-xs); color: var(--text-muted); }
    .sf-file { display: flex; align-items: center; gap: var(--s3); }
    .sf-fname { font-size: var(--fs-sm); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sf-fname.muted { color: var(--text-faint); }
    .sf-range { display: flex; align-items: center; gap: var(--s3); }
    .sf-range mat-slider { flex: 1; min-width: 0; }
    .sf-rangeval { font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--text-muted); min-width: 2ch; text-align: right; }
    .sf-hint { font-size: var(--fs-xs); color: var(--text-faint); }
    .sf-err { font-size: var(--fs-xs); color: var(--danger); }
    .sf-actions { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s2); }
    .sf-submit { align-self: flex-start; font: inherit; font-weight: 600; font-size: var(--fs-sm);
      background: var(--brand); color: #fff; border: none; border-radius: var(--r-full); padding: 9px 20px; cursor: pointer; }
    .sf-submit.secondary { background: var(--surface-3, #4b5563); }
    .sf-submit.danger { background: var(--danger); }
    .sf-none { font-size: var(--fs-sm); color: var(--text-muted); border: 1px dashed var(--border); border-radius: var(--r-md); padding: var(--s5); text-align: center; }
    .sf-none code { font-family: var(--font-mono); }
  `],
})
export class SchemaFormComponent {
  /** The capability body carrying a `schema` (or a bare `fields`) form definition. */
  readonly body = input.required<Record<string, unknown>>();
  readonly schema = computed<FormSchema | null>(() => {
    const b = this.body();
    const s = (b['schema'] ?? b) as FormSchema;
    return s && Array.isArray(s.fields) ? s : null;
  });
  readonly fields = computed<readonly SchemaField[]>(() => this.schema()?.fields ?? []);
  /** The action bar to preview; falls back to a single Submit (legacy-aware). */
  readonly actions = computed<readonly PreviewFormAction[]>(() => {
    const s = this.schema();
    if (s?.actions?.length) return s.actions;
    const submit = s?.submit;
    return submit && submit !== 'usage-event'
      ? [{ kind: 'tool', label: 'Submit' }]
      : [{ kind: 'submit', label: 'Submit' }];
  });

  // Live values + touched state, so inline constraints validate as you type.
  private readonly values = signal<Record<string, unknown>>({});
  private readonly touched = signal<ReadonlySet<string>>(new Set());

  val(name: string): unknown { return this.values()[name] ?? ''; }
  set(name: string, e: Event): void {
    const t = e.target as HTMLInputElement;
    const v = t.type === 'checkbox' ? t.checked : t.value;
    this.values.update((m) => ({ ...m, [name]: v }));
  }
  /** Set a value directly (for Material controls whose change events aren't native DOM events). */
  setVal(name: string, v: unknown): void { this.values.update((m) => ({ ...m, [name]: v })); this.touch(name); }
  touch(name: string): void { this.touched.update((s) => new Set(s).add(name)); }
  /** Current value coerced to an array (for the multi-select control). */
  valArr(name: string): unknown[] { const v = this.values()[name]; return Array.isArray(v) ? v : v == null || v === '' ? [] : [v]; }
  /** Record the chosen file's name so the preview reflects a selection. */
  onFile(name: string, e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    this.setVal(name, f ? f.name : '');
  }

  /** Widgets whose name denotes a file/upload surface — rendered as a file control. */
  private static readonly FILE_RE = /\b(upload|file|attach(ment)?|receipt|dropzone|document|photo|image|avatar)\b/i;
  private isFileField(f: SchemaField): boolean {
    return f.type === 'file' || (!!f.widget && SchemaFormComponent.FILE_RE.test(f.widget));
  }
  /** A composite/custom component field with no primitive control — shown as a slot. */
  private isComponentSlot(f: SchemaField): boolean {
    return !!f.widget && !this.isFileField(f) && (f.type == null || f.type === 'text');
  }
  /** The control to render for a field — normalizes aliases and resolves widgets. */
  ctrl(f: SchemaField): string {
    if (this.isFileField(f)) return 'file';
    if (this.isComponentSlot(f)) return 'slot';
    switch (f.type) {
      case 'textarea': return 'textarea';
      case 'select': return 'select';
      case 'multiselect': return 'multiselect';
      case 'checkbox': case 'boolean': return 'checkbox';
      case 'toggle': return 'toggle';
      case 'radio': return 'radio';
      case 'number': return 'number';
      case 'date': return 'date';
      case 'time': return 'time';
      case 'range': case 'slider': return 'range';
      default: return 'input';
    }
  }
  /** Native input type for the default (text-like) case; unknown types fall back to text. */
  inputType(f: SchemaField): string {
    return ['text', 'email', 'tel', 'url', 'password', 'color'].includes(f.type ?? 'text') ? (f.type as string) : 'text';
  }

  /** Inline-constraint description for the field (governed validators show as chips). */
  hint(f: SchemaField): string {
    const v = f.validation;
    const parts: string[] = [];
    if (f.required) parts.push('required');
    if (v?.email) parts.push('email');
    if (v?.minLength != null) parts.push(`min ${v.minLength} chars`);
    if (v?.maxLength != null) parts.push(`max ${v.maxLength} chars`);
    if (v?.min != null) parts.push(`≥ ${v.min}`);
    if (v?.max != null) parts.push(`≤ ${v.max}`);
    if (v?.pattern) parts.push('pattern');
    return parts.join(' · ');
  }

  /** Live validation of inline constraints; shows only after the field is touched. */
  err(f: SchemaField): string | null {
    if (!this.touched().has(f.name)) return null;
    const raw = this.values()[f.name];
    const s = raw == null ? '' : String(raw);
    const v = f.validation;
    if (f.required && s.trim() === '') return v?.message ?? 'This field is required.';
    if (s === '') return null; // optional + empty is fine
    if (v?.email && !EMAIL_RE.test(s)) return v.message ?? 'Enter a valid email.';
    if (v?.minLength != null && s.length < v.minLength) return v.message ?? `Must be at least ${v.minLength} characters.`;
    if (v?.maxLength != null && s.length > v.maxLength) return v.message ?? `Must be at most ${v.maxLength} characters.`;
    if (v?.pattern && !new RegExp(v.pattern).test(s)) return v.message ?? 'Does not match the required format.';
    if (f.type === 'number') {
      const n = Number(s);
      if (v?.min != null && n < v.min) return v.message ?? `Must be ≥ ${v.min}.`;
      if (v?.max != null && n > v.max) return v.message ?? `Must be ≤ ${v.max}.`;
    }
    return null;
  }
}
