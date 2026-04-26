import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormRegistry, ValidationRegistry, type FormDef, type FormFieldUi } from '../internal';

interface FieldDescriptor {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly ui: FormFieldUi;
}

/**
 * Renders a schema-driven form by name, validates input via the configured
 * `ValidationRegistry`, and invokes the `FormDef.submit` handler on success.
 *
 * Inputs:
 *  - `formName` — name of a form registered with `FormRegistry`.
 *  - `initialValues?` — optional pre-filled values from the agent.
 */
@Component({
  selector: 'mvk-form-renderer',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (form(); as f) {
      <form (submit)="$event.preventDefault(); onSubmit()">
        <h3>{{ f.name }}</h3>
        @if (f.description) { <p class="desc">{{ f.description }}</p> }
        @for (field of fields(); track field.key) {
          <label>
            <span>{{ field.label }}@if (field.required) { <em>*</em> }</span>
            @switch (field.ui.widget) {
              @case ('textarea') {
                <textarea
                  [ngModel]="readField(field.key)"
                  (ngModelChange)="writeField(field.key, $event)"
                  [name]="field.key"
                  [placeholder]="field.ui.placeholder ?? ''"></textarea>
              }
              @case ('select') {
                <select
                  [ngModel]="readField(field.key)"
                  (ngModelChange)="writeField(field.key, $event)"
                  [name]="field.key">
                  @for (opt of field.ui.options ?? []; track opt.value) {
                    <option [value]="opt.value">{{ opt.label }}</option>
                  }
                </select>
              }
              @case ('checkbox') {
                <input type="checkbox"
                  [ngModel]="!!readField(field.key)"
                  (ngModelChange)="writeField(field.key, $event)"
                  [name]="field.key" />
              }
              @case ('number') {
                <input type="number"
                  [ngModel]="readField(field.key)"
                  (ngModelChange)="writeField(field.key, +$event)"
                  [name]="field.key"
                  [placeholder]="field.ui.placeholder ?? ''" />
              }
              @case ('date') {
                <input type="date"
                  [ngModel]="readField(field.key)"
                  (ngModelChange)="writeField(field.key, $event)"
                  [name]="field.key" />
              }
              @default {
                <input type="text"
                  [ngModel]="readField(field.key)"
                  (ngModelChange)="writeField(field.key, $event)"
                  [name]="field.key"
                  [placeholder]="field.ui.placeholder ?? ''" />
              }
            }
            @if (errorFor(field.key); as err) {
              <small class="error">{{ err }}</small>
            }
          </label>
        }
        <button type="submit" [disabled]="submitting()">{{ submitting() ? 'Submitting…' : 'Submit' }}</button>
      </form>
    } @else {
      <p class="missing">Form "{{ formName() }}" is not registered.</p>
    }
  `,
  styles: `
    :host { display: block; padding: 0.5rem; }
    form { display: flex; flex-direction: column; gap: 0.6rem; }
    h3 { margin: 0; font-size: 1rem; }
    .desc { margin: 0; color: #6b7280; font-size: 0.85rem; }
    label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
    label em { color: #b91c1c; font-style: normal; margin-left: 0.15rem; }
    input, select, textarea { padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; }
    .error { color: #b91c1c; font-size: 0.75rem; }
    button { padding: 0.5rem 1rem; background: #2563eb; color: white; border: 0; border-radius: 0.3rem; cursor: pointer; align-self: flex-start; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .missing { padding: 0.4rem; background: #fef3c7; color: #92400e; border-radius: 0.3rem; font-size: 0.85rem; }
  `,
})
export class FormRendererComponent {
  readonly formName = input.required<string>();
  readonly initialValues = input<Readonly<Record<string, unknown>>>({});

  private readonly forms = inject(FormRegistry);
  private readonly validators = inject(ValidationRegistry);

  protected readonly form = computed<FormDef | undefined>(() => this.forms.get(this.formName()));
  private readonly values = signal<Record<string, unknown>>({});
  private readonly errors = signal<Record<string, string>>({});
  protected readonly submitting = signal(false);

  protected readonly fields = computed<FieldDescriptor[]>(() => {
    const def = this.form();
    if (!def) return [];
    const shape = (def.fieldsSchema as { shape?: Record<string, unknown> }).shape;
    if (!shape) return [];
    return Object.keys(shape).map((key) => {
      const ui = def.ui?.[key] ?? {};
      const required = !(shape[key] as { isOptional?: () => boolean }).isOptional?.();
      return { key, label: prettyLabel(key), required, ui };
    }).sort((a, b) => (a.ui.order ?? 0) - (b.ui.order ?? 0));
  });

  ngOnInit(): void {
    this.values.set({ ...this.initialValues() });
  }

  protected readField(key: string): unknown {
    return this.values()[key];
  }

  protected writeField(key: string, value: unknown): void {
    this.values.update((cur) => ({ ...cur, [key]: value }));
  }

  protected errorFor(key: string): string | undefined {
    return this.errors()[key];
  }

  protected async onSubmit(): Promise<void> {
    const def = this.form();
    if (!def) return;
    const result = this.validators.validate<Record<string, unknown>>(def.fieldsSchema, this.values());
    if (!result.success) {
      const map: Record<string, string> = {};
      for (const e of result.errors ?? []) map[e.path] = e.message;
      this.errors.set(map);
      return;
    }
    this.errors.set({});
    this.submitting.set(true);
    try {
      await def.submit(result.data!);
    } finally {
      this.submitting.set(false);
    }
  }
}

function prettyLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
