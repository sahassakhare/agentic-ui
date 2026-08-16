import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

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
  readonly type?: 'text' | 'email' | 'number' | 'date' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'section';
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
              @if (f.widget) { <span class="sf-widget" title="Rendered by the ‘{{ f.widget }}’ component">⛃ {{ f.widget }}</span> }
              @if (f.source) { <span class="sf-source" title="Data from the ‘{{ f.source }}’ source (resolved by the platform)">⇄ {{ f.source }}</span> }
              @for (v of f.validators ?? []; track v) { <span class="sf-val" title="Validated by the ‘{{ v }}’ rule (resolved at runtime)">⛨ {{ v }}</span> }
            </label>
            @switch (f.type) {
              @case ('textarea') { <textarea class="sf-in" [class.bad]="err(f)" [id]="'sf-'+f.name" rows="3" [placeholder]="f.placeholder ?? ''" [value]="val(f.name)" (input)="set(f.name, $event)" (blur)="touch(f.name)"></textarea> }
              @case ('select') {
                <select class="sf-in" [class.bad]="err(f)" [id]="'sf-'+f.name" [value]="val(f.name)" (change)="set(f.name, $event)" (blur)="touch(f.name)">
                  <option value="" disabled selected>{{ f.source && !(f.options?.length) ? 'from ' + f.source + '…' : 'Choose…' }}</option>
                  @for (o of f.options ?? []; track o) { <option [value]="o">{{ o }}</option> }
                </select>
              }
              @case ('checkbox') { <label class="sf-check"><input type="checkbox" [id]="'sf-'+f.name" [checked]="!!val(f.name)" (change)="set(f.name, $event)" /> {{ f.placeholder ?? 'Yes' }}</label> }
              @case ('radio') {
                <div class="sf-radios">
                  @for (o of f.options ?? []; track o) { <label class="sf-radio"><input type="radio" [name]="f.name" [value]="o" (change)="set(f.name, $event)" /> {{ o }}</label> }
                </div>
              }
              @case ('number') { <input class="sf-in" [class.bad]="err(f)" type="number" [id]="'sf-'+f.name" [placeholder]="f.placeholder ?? ''" [value]="val(f.name)" (input)="set(f.name, $event)" (blur)="touch(f.name)" /> }
              @case ('date') { <input class="sf-in" [class.bad]="err(f)" type="date" [id]="'sf-'+f.name" [value]="val(f.name)" (input)="set(f.name, $event)" (blur)="touch(f.name)" /> }
              @default { <input class="sf-in" [class.bad]="err(f)" [type]="f.type ?? 'text'" [id]="'sf-'+f.name" [placeholder]="f.placeholder ?? ''" [value]="val(f.name)" (input)="set(f.name, $event)" (blur)="touch(f.name)" /> }
            }
            @if (err(f); as e) { <span class="sf-err">{{ e }}</span> }
            @else if (hint(f); as h) { <span class="sf-hint">{{ h }}</span> }
          </div>
          }
        }
        <div class="sf-actions">
          @for (a of actions(); track $index) {
            <button class="sf-submit" type="button"
              [class.secondary]="a.style === 'secondary'"
              [class.danger]="a.style === 'danger'">{{ a.label }}</button>
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
  touch(name: string): void { this.touched.update((s) => new Set(s).add(name)); }

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
