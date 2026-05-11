import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EnvironmentInjector,
  inject,
  input,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { z } from 'zod';
import { MatterStore } from '../services/matter.store';
import {
  nextCustodianId,
  type Custodian,
} from '@maverick/demo-ediscovery-shared';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DynamicField {
  readonly name: string;
  readonly label: string;
  readonly type: string;
  readonly required?: boolean;
}

/**
 * Approach 2 — fully agent-generated form.
 *
 * The agent emits the schema as the tool argument; this widget renders
 * whatever it gets, validated against the safety dialect declared in
 * `dynamicFormSchema`. Compare with `custodianIntakeForm` in
 * `agentic.ts` (Approach 1, F1): there the schema is a registered
 * `FormDef` keyed by `name`, the section widgets are real Angular
 * classes registered in `ComponentRegistry`, and the LLM only supplies
 * context (`matterType`, `persona`, `department`) which gates a
 * predefined catalog via the F1 closed-AST DSL.
 *
 * Trade-off captured live: F1 gets type-safe submit handlers, named-
 * form auditing, and Zod-guarded section props at the cost of a fixed
 * catalog. This widget gets full LLM flexibility at the cost of:
 *   - no per-form audit signature — every form is a one-off
 *   - submit is generic; domain side-effects are best-effort by field-
 *     name convention (we map `name`/`email`/`department` to a real
 *     `MatterStore.addCustodian` call, the rest is logged + posted back
 *     to the agent as a tool result)
 *   - the host MUST validate the LLM-emitted schema before mounting
 *     anything — see `dynamicFormSchema` for the strict allow-list
 *
 * Use this for ad-hoc intake the agent invents on the fly. Use F1 for
 * any form that recurs across runs and needs a stable audit trail.
 */
const FieldType = z.enum([
  'text',
  'email',
  'textarea',
  'select',
  'multiselect',
  'checkbox',
  'number',
]);

export const dynamicFormFieldSchema = z.object({
  name: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  type: FieldType,
  required: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  helpText: z.string().max(400).optional(),
  options: z.array(z.string().max(120)).max(20).optional(),
});

export const dynamicFormSectionSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  fields: z.array(dynamicFormFieldSchema).min(1).max(12),
});

export const dynamicFormSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(600).optional(),
  sections: z.array(dynamicFormSectionSchema).min(1).max(8),
  submitLabel: z.string().max(40).optional(),
});

export type DynamicFormSchema = z.infer<typeof dynamicFormSchema>;

@Component({
  selector: 'app-dynamic-form-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (parsed(); as schema) {
      <article class="card">
        <header>
          <span class="badge">LLM-generated form</span>
          <h3>{{ schema.title }}</h3>
          @if (schema.description) { <p class="desc">{{ schema.description }}</p> }
        </header>

        @if (submitted()) {
          <div class="ok">
            <strong>Submitted.</strong>
            @if (createdCustodianId(); as cid) {
              <span> Custodian <code>{{ cid }}</code> added to the matter.</span>
            } @else {
              <span> Values logged. The agent will follow up with any next step.</span>
            }
          </div>
        } @else {
          <form (ngSubmit)="onSubmit()" novalidate>
            @for (s of schema.sections; track s.title) {
              <fieldset>
                <legend>{{ s.title }}</legend>
                @if (s.description) { <p class="section-desc">{{ s.description }}</p> }
                @for (f of s.fields; track f.name) {
                  <label class="field">
                    <span class="lbl">
                      {{ f.label }}
                      @if (f.required) { <em class="req" title="Required">*</em> }
                    </span>
                    @switch (f.type) {
                      @case ('textarea') {
                        <textarea
                          [name]="f.name"
                          [placeholder]="f.placeholder ?? ''"
                          [(ngModel)]="values[f.name]"
                          (blur)="touch(f.name)"
                          [class.invalid]="hasError(f)"
                          [attr.aria-invalid]="hasError(f) || null"></textarea>
                      }
                      @case ('select') {
                        <select [name]="f.name" [(ngModel)]="values[f.name]"
                                (blur)="touch(f.name)"
                                [class.invalid]="hasError(f)"
                                [attr.aria-invalid]="hasError(f) || null">
                          <option [value]="''" disabled>Choose…</option>
                          @for (o of f.options ?? []; track o) {
                            <option [value]="o">{{ o }}</option>
                          }
                        </select>
                      }
                      @case ('multiselect') {
                        <div class="checkboxes" [class.invalid]="hasError(f)"
                             [attr.aria-invalid]="hasError(f) || null"
                             (focusout)="touch(f.name)">
                          @for (o of f.options ?? []; track o) {
                            <label class="checkbox">
                              <input type="checkbox"
                                     [checked]="multiHas(f.name, o)"
                                     (change)="multiToggle(f.name, o, $any($event.target).checked)" />
                              <span>{{ o }}</span>
                            </label>
                          }
                        </div>
                      }
                      @case ('checkbox') {
                        <input type="checkbox"
                               [name]="f.name"
                               [(ngModel)]="values[f.name]"
                               (blur)="touch(f.name)"
                               [class.invalid]="hasError(f)"
                               [attr.aria-invalid]="hasError(f) || null" />
                      }
                      @case ('number') {
                        <input type="number"
                               [name]="f.name"
                               [placeholder]="f.placeholder ?? ''"
                               [(ngModel)]="values[f.name]"
                               (blur)="touch(f.name)"
                               [class.invalid]="hasError(f)"
                               [attr.aria-invalid]="hasError(f) || null" />
                      }
                      @case ('email') {
                        <input type="email"
                               [name]="f.name"
                               [placeholder]="f.placeholder ?? ''"
                               [(ngModel)]="values[f.name]"
                               (blur)="touch(f.name)"
                               autocomplete="email"
                               [class.invalid]="hasError(f)"
                               [attr.aria-invalid]="hasError(f) || null" />
                      }
                      @default {
                        <input type="text"
                               [name]="f.name"
                               [placeholder]="f.placeholder ?? ''"
                               [(ngModel)]="values[f.name]"
                               (blur)="touch(f.name)"
                               [class.invalid]="hasError(f)"
                               [attr.aria-invalid]="hasError(f) || null" />
                      }
                    }
                    @if (hasError(f); as msg) {
                      <small class="error" role="alert">{{ msg }}</small>
                    }
                    @if (f.helpText && !hasError(f)) { <small class="help">{{ f.helpText }}</small> }
                  </label>
                }
              </fieldset>
            }
            @if (invalidFields().length > 0 && submitAttempted()) {
              <p class="form-error">
                {{ invalidFields().length }} field(s) need attention:
                {{ invalidFields().join(', ') }}
              </p>
            }
            <button type="submit"
                    [disabled]="!isValid() || submitting()">
              @if (submitting()) {
                Submitting…
              } @else {
                {{ schema.submitLabel ?? 'Submit' }}
              }
            </button>
          </form>
        }
      </article>
    } @else {
      <article class="card error">
        <strong>Schema rejected.</strong>
        <p>The LLM-emitted form schema didn’t pass validation:</p>
        <pre>{{ parseError() }}</pre>
        <p class="hint">
          Allowed shape: <code>{{ '{ title, sections: [{ title, fields: [{ name, label, type }] }] }' }}</code>.
          Caps: 8 sections, 12 fields/section, options ≤ 20.
        </p>
      </article>
    }
  `,
  styles: `
    :host { display: block; }
    .card {
      padding: 0.85rem; border: 1px solid var(--c-border, #e5e7eb);
      background: var(--c-surface-0, #fff); border-radius: 8px;
      font-size: 0.85rem; line-height: 1.4;
    }
    .badge {
      display: inline-block; padding: 2px 8px;
      background: linear-gradient(90deg, #db2777, #7c3aed);
      color: white; font-size: 0.6rem; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      border-radius: 3px; margin-bottom: 6px;
    }
    h3 { margin: 0 0 4px; font-size: 0.95rem; }
    .desc { margin: 0 0 0.7rem; color: var(--c-text-mute, #6b7280); }
    fieldset {
      border: 1px solid var(--c-divider, #f0f1f4); border-radius: 6px;
      padding: 0.55rem 0.75rem 0.7rem; margin: 0 0 0.6rem;
    }
    legend {
      padding: 0 6px; font-size: 0.7rem; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--c-text-mute, #6b7280);
    }
    .section-desc { margin: 0 0 0.5rem; font-size: 0.78rem; color: var(--c-text-mute, #6b7280); }
    .field { display: grid; gap: 4px; margin-bottom: 0.55rem; }
    .lbl { font-size: 0.78rem; font-weight: 600; }
    .req { color: #dc2626; font-style: normal; }
    input[type="text"], input[type="email"], input[type="number"], select, textarea {
      padding: 6px 8px; border: 1px solid var(--c-border, #d1d5db);
      border-radius: 4px; font: inherit; width: 100%;
      box-sizing: border-box;
    }
    input.invalid, select.invalid, textarea.invalid {
      border-color: #dc2626; background: #fef2f2;
    }
    input.invalid:focus, select.invalid:focus, textarea.invalid:focus {
      outline: 2px solid #dc2626; outline-offset: -1px;
    }
    .checkboxes.invalid {
      background: #fef2f2;
      outline: 1px solid #fca5a5;
      padding: 4px 6px; border-radius: 4px;
    }
    .error { color: #b91c1c; font-size: 0.72rem; margin-top: 2px; }
    .form-error {
      padding: 6px 10px; background: #fef2f2; color: #991b1b;
      border-radius: 4px; font-size: 0.78rem; margin: 0 0 8px;
    }
    button[type="submit"]:disabled {
      opacity: 0.5; cursor: not-allowed;
    }
    textarea { min-height: 70px; resize: vertical; }
    input[type="checkbox"] { transform: translateY(2px); }
    .checkboxes { display: grid; gap: 4px; }
    .checkbox { display: flex; align-items: center; gap: 6px; font-weight: 400; }
    .help { color: var(--c-text-mute, #6b7280); font-size: 0.72rem; }
    button[type="submit"] {
      background: var(--c-brand, #1e3a5f); color: white;
      border: 0; padding: 7px 14px; border-radius: 4px;
      font: inherit; font-weight: 600; cursor: pointer;
    }
    button[type="submit"]:hover { background: var(--c-brand-deep, #12243d); }
    .ok {
      padding: 8px 10px; background: #ecfdf5; border: 1px solid #a7f3d0;
      border-radius: 6px; color: #065f46;
    }
    .ok code { background: #d1fae5; padding: 1px 5px; border-radius: 3px; }
    .card.error { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
    .card.error pre { font-size: 0.7rem; background: #fff; padding: 6px; border-radius: 4px; max-height: 8rem; overflow: auto; }
    .hint { font-size: 0.75rem; color: #7f1d1d; margin-bottom: 0; }
  `,
})
export class DynamicFormCardComponent {
  /** The raw schema as emitted by the LLM — validated on init. */
  readonly schema = input.required<unknown>();

  private readonly env = inject(EnvironmentInjector);

  protected readonly parsed = computed<DynamicFormSchema | null>(() => {
    const raw = this.schema();
    const result = dynamicFormSchema.safeParse(raw);
    return result.success ? result.data : null;
  });

  protected readonly parseError = computed(() => {
    const raw = this.schema();
    const result = dynamicFormSchema.safeParse(raw);
    if (result.success) return '';
    return result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n');
  });

  protected readonly values: Record<string, unknown> = {};
  protected readonly submitted = signal(false);
  protected readonly createdCustodianId = signal<string | null>(null);

  /** Per-field touched flags (signal so error visibility reacts in
   *  the template). Errors hide until the field has been blurred
   *  once OR submit has been attempted. */
  private readonly touched = signal<Record<string, boolean>>({});
  protected readonly submitAttempted = signal(false);
  protected readonly submitting = signal(false);

  protected touch(name: string): void {
    this.touched.update((t) => ({ ...t, [name]: true }));
  }

  /** Returns the active error string for a field, or empty when
   *  valid / not yet touched. Returning `string` (not boolean) lets
   *  template `@if (hasError(f); as msg)` capture the message. */
  protected hasError(f: DynamicField): string {
    const reveal = this.submitAttempted() || Boolean(this.touched()[f.name]);
    if (!reveal) return '';
    return this.computeError(f);
  }

  private computeError(f: DynamicField): string {
    const raw = this.values[f.name];
    const empty = raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (f.required && empty) return `${f.label} is required.`;
    if (empty) return '';
    if (f.type === 'email' && typeof raw === 'string' && !EMAIL_RE.test(raw)) {
      return 'Use a valid email address.';
    }
    if (f.type === 'number' && typeof raw === 'string' && Number.isNaN(Number(raw))) {
      return 'Must be a number.';
    }
    return '';
  }

  /** Names of fields that currently fail validation. Recomputed
   *  from `values` so it stays cheap to call. */
  protected readonly invalidFields = computed<readonly string[]>(() => {
    const def = this.parsed();
    if (!def) return [];
    const out: string[] = [];
    for (const s of def.sections) {
      for (const f of s.fields) {
        if (this.computeError(f)) out.push(f.label);
      }
    }
    return out;
  });

  protected readonly isValid = computed(() => this.invalidFields().length === 0);

  protected multiHas(name: string, opt: string): boolean {
    const arr = (this.values[name] ?? []) as readonly string[];
    return Array.isArray(arr) && arr.includes(opt);
  }

  protected multiToggle(name: string, opt: string, on: boolean): void {
    const cur = (this.values[name] ?? []) as readonly string[];
    const next = on
      ? cur.includes(opt) ? cur : [...cur, opt]
      : cur.filter((v) => v !== opt);
    this.values[name] = next;
  }

  /**
   * Submit pathway. Best-effort domain mapping: when the agent's schema
   * surfaces `name` / `email` / `department` fields (common case for an
   * intake form), we add a real custodian to the MatterStore so the
   * dashboard updates and the audit chain captures the event. Other
   * fields are kept in the payload for the agent to interpret on its
   * next turn.
   */
  protected async onSubmit(): Promise<void> {
    // Mark every field touched so any pending errors surface even
    // for fields the user never blurred. The validity guard below
    // then short-circuits if anything's wrong.
    this.submitAttempted.set(true);
    const def = this.parsed();
    if (def) {
      const all: Record<string, boolean> = {};
      for (const s of def.sections) for (const f of s.fields) all[f.name] = true;
      this.touched.set(all);
    }
    if (!this.isValid() || this.submitting() || this.submitted()) return;

    this.submitting.set(true);
    const v = { ...this.values };
    try {
      await runInInjectionContext(this.env, async () => {
        const store = this.env.get(MatterStore);
        const name = String(v['name'] ?? '').trim();
        const email = String(v['email'] ?? '').trim();
        const department = String(v['department'] ?? '').trim();
        if (name && email) {
          const custodian: Custodian = {
            id: nextCustodianId(),
            matterId: store.matterId,
            name,
            email,
            department: department || 'Unspecified',
            hasLegalHold: false,
            collectionStatus: 'pending',
            documentCount: 0,
          };
          store.addCustodian(custodian);
          this.createdCustodianId.set(custodian.id);
          // eslint-disable-next-line no-console
          console.info('[dynamicForm] submit', v);
          this.submitted.set(true);
          // Same confirmation path the F1 intake form uses --
          // navigate to /custodians?id=…&created=1. The flash
          // banner there gives the operator unambiguous feedback.
          await this.env.get(Router).navigate(['/custodians'], {
            queryParams: { id: custodian.id, created: '1' },
          });
        } else {
          // Schema didn't surface name/email -- still mark submitted
          // so the success card shows and the form locks. The agent
          // reads the values back on its next turn.
          // eslint-disable-next-line no-console
          console.info('[dynamicForm] submit (no domain mapping)', v);
          this.submitted.set(true);
        }
      });
    } finally {
      this.submitting.set(false);
    }
  }
}
