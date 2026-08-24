import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators, type ValidatorFn } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';

/**
 * Renders a form LIVE from its declarative JSON schema (`body.schema`) — the same
 * JSON an agent consumes as its tool-input schema and the planner uses to compose
 * the form from other registries (fields may `widget`-reference a component,
 * `source`-reference a dataSource/tool, and `validators`-reference validation
 * capabilities).
 *
 * The form is a real reactive `FormGroup` built from the schema, so the preview
 * behaves like a production form: floating Material labels, live validation with
 * `mat-error` messages, required/invalid states, a character counter, input
 * affordances (currency prefix, email icon, date picker), an accessible
 * radio/checkbox layout, a drag-and-drop file zone, and a submit that stays
 * disabled until the form is valid. Governed `validators` (cross-field business
 * rules) resolve on the platform at runtime and show as design-time chips.
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

const CURRENCY_RE = /\b(amount|price|cost|total|salary|budget|fee|payment|balance|revenue)\b/i;

@Component({
  selector: 'aes-schema-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideNativeDateAdapter()],
  imports: [
    ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatRadioModule,
    MatButtonModule, MatSlideToggleModule, MatSliderModule, MatIconModule, MatDatepickerModule,
  ],
  template: `
    @if (fields().length) {
      <form class="sf" [formGroup]="form()" (ngSubmit)="onSubmit()" novalidate>
        @for (f of fields(); track f.name) {
          @if (f.type === 'section') {
            <div class="sf-section">{{ f.label ?? f.name }}</div>
          } @else {
          <div class="sf-field" [class.sf-inline]="isInline(f)">
            @switch (ctrl(f)) {
              @case ('textarea') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <mat-label>{{ labelOf(f) }}</mat-label>
                  <textarea matInput [formControlName]="f.name" rows="3" [placeholder]="f.placeholder ?? ''"
                    [maxlength]="f.validation?.maxLength ?? null"></textarea>
                  @if (hint(f)) { <mat-hint>{{ hint(f) }}</mat-hint> }
                  @if (f.validation?.maxLength) { <mat-hint align="end">{{ len(f.name) }}/{{ f.validation!.maxLength }}</mat-hint> }
                  <mat-error>{{ errorFor(f) }}</mat-error>
                </mat-form-field>
              }
              @case ('select') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <mat-label>{{ labelOf(f) }}</mat-label>
                  <mat-select [formControlName]="f.name">
                    @if (!f.required) { <mat-option [value]="null">—</mat-option> }
                    @for (o of f.options ?? []; track o) { <mat-option [value]="o">{{ o }}</mat-option> }
                  </mat-select>
                  @if (!(f.options?.length) && f.source) { <mat-hint>Options from ‘{{ f.source }}’ at runtime</mat-hint> }
                  @else if (hint(f)) { <mat-hint>{{ hint(f) }}</mat-hint> }
                  <mat-error>{{ errorFor(f) }}</mat-error>
                </mat-form-field>
              }
              @case ('multiselect') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <mat-label>{{ labelOf(f) }}</mat-label>
                  <mat-select [formControlName]="f.name" multiple>
                    @for (o of f.options ?? []; track o) { <mat-option [value]="o">{{ o }}</mat-option> }
                  </mat-select>
                  @if (!(f.options?.length) && f.source) { <mat-hint>Options from ‘{{ f.source }}’ at runtime</mat-hint> }
                  @else if (hint(f)) { <mat-hint>{{ hint(f) }}</mat-hint> }
                  <mat-error>{{ errorFor(f) }}</mat-error>
                </mat-form-field>
              }
              @case ('number') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <mat-label>{{ labelOf(f) }}</mat-label>
                  @if (isCurrency(f)) { <span matTextPrefix>$&nbsp;</span> }
                  <input matInput type="number" [formControlName]="f.name" [placeholder]="f.placeholder ?? ''"
                    [min]="f.validation?.min ?? null" [max]="f.validation?.max ?? null" />
                  @if (hint(f)) { <mat-hint>{{ hint(f) }}</mat-hint> }
                  <mat-error>{{ errorFor(f) }}</mat-error>
                </mat-form-field>
              }
              @case ('date') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <mat-label>{{ labelOf(f) }}</mat-label>
                  <input matInput [matDatepicker]="dp" [formControlName]="f.name" [placeholder]="f.placeholder ?? 'Choose a date'" />
                  <mat-datepicker-toggle matIconSuffix [for]="dp" />
                  <mat-datepicker #dp />
                  @if (hint(f)) { <mat-hint>{{ hint(f) }}</mat-hint> }
                  <mat-error>{{ errorFor(f) }}</mat-error>
                </mat-form-field>
              }
              @case ('time') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="sf-mf">
                  <mat-label>{{ labelOf(f) }}</mat-label>
                  <input matInput type="time" [formControlName]="f.name" />
                  <mat-icon matIconSuffix>schedule</mat-icon>
                  @if (hint(f)) { <mat-hint>{{ hint(f) }}</mat-hint> }
                  <mat-error>{{ errorFor(f) }}</mat-error>
                </mat-form-field>
              }
              @case ('checkbox') {
                <mat-checkbox [formControlName]="f.name">{{ labelOf(f) }}</mat-checkbox>
                @if (showErr(f); as e) { <span class="sf-err">{{ e }}</span> }
              }
              @case ('toggle') {
                <mat-slide-toggle [formControlName]="f.name">{{ labelOf(f) }}</mat-slide-toggle>
                @if (showErr(f); as e) { <span class="sf-err">{{ e }}</span> }
              }
              @case ('radio') {
                <fieldset class="sf-fieldset">
                  <legend class="sf-legend">{{ labelOf(f) }}</legend>
                  <mat-radio-group class="sf-radios" [formControlName]="f.name" [attr.aria-label]="labelOf(f)">
                    @for (o of f.options ?? []; track o) { <mat-radio-button [value]="o">{{ o }}</mat-radio-button> }
                  </mat-radio-group>
                </fieldset>
                @if (showErr(f); as e) { <span class="sf-err">{{ e }}</span> }
              }
              @case ('range') {
                <span class="sf-toplbl">{{ labelOf(f) }}</span>
                <div class="sf-range">
                  <span class="sf-rangeedge">{{ f.validation?.min ?? 0 }}</span>
                  <mat-slider [min]="f.validation?.min ?? 0" [max]="f.validation?.max ?? 100" discrete>
                    <input matSliderThumb [formControlName]="f.name" [attr.aria-label]="labelOf(f)" />
                  </mat-slider>
                  <span class="sf-rangeedge">{{ f.validation?.max ?? 100 }}</span>
                </div>
              }
              @case ('file') {
                <span class="sf-toplbl">{{ labelOf(f) }}</span>
                <div class="sf-file" [class.dragover]="dragField() === f.name"
                  (dragover)="onDragOver(f.name, $event)" (dragleave)="onDragLeave($event)" (drop)="onDrop(f.name, $event)"
                  (click)="picker.click()" role="button" tabindex="0" [attr.aria-label]="'Upload ' + labelOf(f)"
                  (keydown.enter)="picker.click()" (keydown.space)="picker.click(); $event.preventDefault()">
                  <mat-icon class="sf-file-ic">cloud_upload</mat-icon>
                  @if (fileName(f.name); as fn) {
                    <span class="sf-fname">{{ fn }}</span>
                    <button matIconButton type="button" (click)="clearFile(f.name, $event)" aria-label="Remove file"><mat-icon>close</mat-icon></button>
                  } @else {
                    <span class="sf-file-cta"><strong>Choose a file</strong> or drag &amp; drop</span>
                  }
                  <input #picker type="file" hidden (change)="onFile(f.name, $event)" />
                </div>
              }
              @case ('slot') {
                <span class="sf-toplbl">{{ labelOf(f) }}</span>
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
                  <mat-label>{{ labelOf(f) }}</mat-label>
                  <input matInput [type]="inputType(f)" [formControlName]="f.name" [placeholder]="f.placeholder ?? ''"
                    [maxlength]="f.validation?.maxLength ?? null" />
                  @if (f.type === 'email') { <mat-icon matIconSuffix>mail</mat-icon> }
                  @if (hint(f)) { <mat-hint>{{ hint(f) }}</mat-hint> }
                  @if (f.validation?.maxLength) { <mat-hint align="end">{{ len(f.name) }}/{{ f.validation!.maxLength }}</mat-hint> }
                  <mat-error>{{ errorFor(f) }}</mat-error>
                </mat-form-field>
              }
            }
            @if (f.widget || f.source || f.validators?.length) {
              <div class="sf-meta">
                @if (f.widget) { <span class="sf-widget" title="Rendered by the ‘{{ f.widget }}’ component">◫ {{ f.widget }}</span> }
                @if (f.source) { <span class="sf-source" title="Data from the ‘{{ f.source }}’ source (resolved by the platform)">⇄ {{ f.source }}</span> }
                @for (v of f.validators ?? []; track v) { <span class="sf-val" title="Validated by the ‘{{ v }}’ rule (resolved at runtime)">✓ {{ v }}</span> }
              </div>
            }
          </div>
          }
        }
        @if (submitted() && form().invalid) {
          <div class="sf-summary" role="alert">
            <mat-icon>error_outline</mat-icon>
            {{ invalidCount() }} {{ invalidCount() === 1 ? 'field needs' : 'fields need' }} attention before you can submit.
          </div>
        }
        <div class="sf-actions">
          @for (a of actions(); track $index) {
            <button [attr.matButton]="a.style === 'secondary' ? '' : 'filled'"
              [type]="isPrimary(a) ? 'submit' : 'button'"
              [disabled]="isPrimary(a) && form().invalid"
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
    .sf { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s5); border: 1px solid var(--border);
      border-radius: var(--r-md); background: var(--surface); max-width: 680px; }
    .sf-section { font-size: var(--fs-xs); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--brand);
      margin-top: var(--s3); padding-top: var(--s3); border-top: 1px solid var(--border); }
    .sf-section:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
    .sf-field { display: flex; flex-direction: column; gap: 4px; }
    .sf-mf { width: 100%; }
    .sf-toplbl, .sf-legend { font-size: var(--fs-sm); font-weight: 500; color: var(--text); }
    .sf-fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .sf-danger { --mat-sys-primary: var(--danger); --mat-sys-on-primary: #fff; }
    .sf-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px; }
    .sf-widget { font-family: var(--font-mono); font-size: 10px; color: var(--brand); background: var(--brand-soft); padding: 1px 6px; border-radius: var(--r-full); }
    .sf-source { font-family: var(--font-mono); font-size: 10px; color: var(--ok); background: var(--ok-soft); padding: 1px 6px; border-radius: var(--r-full); }
    .sf-val { font-family: var(--font-mono); font-size: 10px; color: var(--warn); background: var(--warn-soft); padding: 1px 6px; border-radius: var(--r-full); }
    .sf-radios { display: flex; gap: var(--s4); flex-wrap: wrap; }
    .sf-err { font-size: var(--fs-xs); color: var(--danger); }
    /* component slot */
    .sf-slot { display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s4); border: 1px dashed var(--border-strong, var(--border));
      border-radius: var(--r-md); background: var(--brand-soft); }
    .sf-slot-glyph { display: grid; place-items: center; width: 30px; height: 30px; border-radius: var(--r-sm); background: var(--surface);
      color: var(--brand); font-size: 16px; flex: none; }
    .sf-slot-meta { display: flex; flex-direction: column; min-width: 0; }
    .sf-slot-nm { font-family: var(--font-mono); font-size: var(--fs-sm); font-weight: 600; color: var(--brand); }
    .sf-slot-sub { font-size: var(--fs-xs); color: var(--text-muted); }
    /* file dropzone */
    .sf-file { display: flex; align-items: center; gap: var(--s3); padding: var(--s4); border: 1.5px dashed var(--border-strong, var(--border));
      border-radius: var(--r-md); background: var(--surface-2); cursor: pointer; transition: border-color .15s, background .15s; }
    .sf-file:hover, .sf-file.dragover { border-color: var(--brand); background: var(--brand-soft); }
    .sf-file:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .sf-file-ic { color: var(--brand); flex: none; }
    .sf-file-cta { font-size: var(--fs-sm); color: var(--text-muted); }
    .sf-file-cta strong { color: var(--brand); font-weight: 600; }
    .sf-fname { font-size: var(--fs-sm); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    /* range slider */
    .sf-range { display: flex; align-items: center; gap: var(--s3); }
    .sf-range mat-slider { flex: 1; min-width: 0; }
    .sf-rangeedge { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-muted); min-width: 2ch; }
    /* error summary + actions */
    .sf-summary { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--danger);
      background: var(--danger-soft); border: 1px solid var(--danger); border-radius: var(--r-sm); padding: 8px 12px; }
    .sf-summary mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .sf-actions { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); padding-top: var(--s4); border-top: 1px solid var(--border); }
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

  /**
   * The live reactive form, derived from the schema. A computed (not an effect
   * writing a signal) guarantees the group is fully populated the moment the
   * template reads `form()`, so `formControlName` never binds against an empty
   * group. A fresh group per schema keeps the preview in lock-step with edits.
   */
  readonly form = computed<FormGroup>(() => {
    const controls: Record<string, FormControl> = {};
    for (const f of this.fields()) {
      if (f.type === 'section' || this.isFileField(f) || this.isComponentSlot(f)) continue;
      controls[f.name] = new FormControl(this.initialValue(f), { validators: this.validatorsFor(f) });
    }
    return new FormGroup(controls);
  });
  private readonly submittedSig = signal(false);
  submitted(): boolean { return this.submittedSig(); }
  /** Chosen file names, kept outside the FormGroup (files aren't form-control values). */
  private readonly files = signal<Record<string, string>>({});
  /** The field currently under a drag operation (for the dropzone highlight). */
  readonly dragField = signal<string | null>(null);

  constructor() {
    // Reset transient UI state whenever the schema (and thus the form) changes.
    effect(() => {
      this.fields();
      this.submittedSig.set(false);
      this.files.set({});
    });
  }

  private initialValue(f: SchemaField): unknown {
    switch (this.ctrl(f)) {
      case 'multiselect': return [];
      case 'checkbox': case 'toggle': return false;
      case 'range': return f.validation?.min ?? 0;
      default: return f.type === 'select' && !f.required ? null : '';
    }
  }
  private validatorsFor(f: SchemaField): ValidatorFn[] {
    const vs: ValidatorFn[] = [];
    const v = f.validation;
    if (f.required) vs.push(this.ctrl(f) === 'checkbox' ? Validators.requiredTrue : Validators.required);
    if (v?.email || f.type === 'email') vs.push(Validators.email);
    if (v?.minLength != null) vs.push(Validators.minLength(v.minLength));
    if (v?.maxLength != null) vs.push(Validators.maxLength(v.maxLength));
    if (v?.min != null) vs.push(Validators.min(v.min));
    if (v?.max != null) vs.push(Validators.max(v.max));
    if (v?.pattern) vs.push(Validators.pattern(v.pattern));
    return vs;
  }

  labelOf(f: SchemaField): string { return f.label ?? f.name; }
  /** Checkbox/toggle sit inline with their label — no floating label above. */
  isInline(f: SchemaField): boolean { const c = this.ctrl(f); return c === 'checkbox' || c === 'toggle'; }
  isCurrency(f: SchemaField): boolean { return CURRENCY_RE.test(f.name) || CURRENCY_RE.test(f.widget ?? '') || CURRENCY_RE.test(f.label ?? ''); }
  isPrimary(a: PreviewFormAction): boolean { return a.kind === 'submit' || a.kind === 'tool' || a.kind === 'action' || a.style === 'primary'; }

  len(name: string): number { const v = this.form().get(name)?.value; return typeof v === 'string' ? v.length : 0; }
  invalidCount(): number {
    const g = this.form();
    return Object.keys(g.controls).filter((k) => g.get(k)?.invalid).length;
  }

  onSubmit(): void { this.submittedSig.set(true); this.form().markAllAsTouched(); }

  // ── file handling (kept out of the FormGroup) ──────────────────────────────
  fileName(name: string): string | null { return this.files()[name] || null; }
  onFile(name: string, e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    this.files.update((m) => ({ ...m, [name]: f ? f.name : '' }));
  }
  clearFile(name: string, e: Event): void {
    e.stopPropagation();
    this.files.update((m) => { const next = { ...m }; delete next[name]; return next; });
  }
  onDragOver(name: string, e: DragEvent): void { e.preventDefault(); this.dragField.set(name); }
  onDragLeave(e: DragEvent): void { e.preventDefault(); this.dragField.set(null); }
  onDrop(name: string, e: DragEvent): void {
    e.preventDefault();
    this.dragField.set(null);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.files.update((m) => ({ ...m, [name]: f.name }));
  }

  // ── control resolution ─────────────────────────────────────────────────────
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

  // ── validation display ──────────────────────────────────────────────────────
  /** Inline-constraint help shown under the field (governed validators are chips). */
  hint(f: SchemaField): string {
    const v = f.validation;
    const parts: string[] = [];
    if (v?.minLength != null) parts.push(`min ${v.minLength} chars`);
    if (v?.min != null) parts.push(`≥ ${v.min}`);
    if (v?.max != null) parts.push(`≤ ${v.max}`);
    if (v?.pattern) parts.push('specific format');
    return parts.join(' · ');
  }
  /** The active error message for a field's control (mat-error shows it on touch). */
  errorFor(f: SchemaField): string {
    const e = this.form().get(f.name)?.errors;
    if (!e) return '';
    const m = f.validation?.message;
    if (e['required']) return m ?? 'This field is required.';
    if (e['email']) return m ?? 'Enter a valid email address.';
    if (e['minlength']) return m ?? `Must be at least ${e['minlength'].requiredLength} characters.`;
    if (e['maxlength']) return m ?? `Must be at most ${e['maxlength'].requiredLength} characters.`;
    if (e['min']) return m ?? `Must be ${e['min'].min} or more.`;
    if (e['max']) return m ?? `Must be ${e['max'].max} or less.`;
    if (e['pattern']) return m ?? 'Does not match the required format.';
    return m ?? 'Invalid value.';
  }
  /** Error text for controls outside a mat-form-field (checkbox/toggle/radio). */
  showErr(f: SchemaField): string {
    const c = this.form().get(f.name);
    return c && c.invalid && c.touched ? this.errorFor(f) : '';
  }
}
