import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Renders a form LIVE from its declarative JSON schema (`body.schema`) — the same
 * JSON that an agent consumes as its tool-input schema and that the planner uses
 * to compose the form from other registries (each field may `widget`-reference a
 * component capability). This is the "compose a form with JSON" payoff: edit the
 * JSON, see the form. Pure/standalone; interactive controls, no data binding.
 */
export interface SchemaField {
  readonly name: string;
  readonly type?: 'text' | 'email' | 'number' | 'date' | 'textarea' | 'select' | 'checkbox' | 'radio';
  readonly label?: string;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly options?: readonly string[];
  /** Optional Component-registry entry that renders this field (composition). */
  readonly widget?: string;
}
export interface FormSchema { readonly fields?: readonly SchemaField[]; readonly submit?: string; }

@Component({
  selector: 'aes-schema-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (fields().length) {
      <form class="sf" (submit)="$event.preventDefault()">
        @for (f of fields(); track f.name) {
          <div class="sf-field">
            <label class="sf-lbl" [attr.for]="'sf-'+f.name">
              {{ f.label ?? f.name }} @if (f.required) { <span class="sf-req">*</span> }
              @if (f.widget) { <span class="sf-widget" title="Rendered by the ‘{{ f.widget }}’ component">⛃ {{ f.widget }}</span> }
            </label>
            @switch (f.type) {
              @case ('textarea') { <textarea class="sf-in" [id]="'sf-'+f.name" rows="3" [placeholder]="f.placeholder ?? ''"></textarea> }
              @case ('select') {
                <select class="sf-in" [id]="'sf-'+f.name">
                  <option value="" disabled selected>Choose…</option>
                  @for (o of f.options ?? []; track o) { <option [value]="o">{{ o }}</option> }
                </select>
              }
              @case ('checkbox') { <label class="sf-check"><input type="checkbox" [id]="'sf-'+f.name" /> {{ f.placeholder ?? 'Yes' }}</label> }
              @case ('radio') {
                <div class="sf-radios">
                  @for (o of f.options ?? []; track o) { <label class="sf-radio"><input type="radio" [name]="f.name" /> {{ o }}</label> }
                </div>
              }
              @case ('number') { <input class="sf-in" type="number" [id]="'sf-'+f.name" [placeholder]="f.placeholder ?? ''" /> }
              @case ('date') { <input class="sf-in" type="date" [id]="'sf-'+f.name" /> }
              @default { <input class="sf-in" [type]="f.type ?? 'text'" [id]="'sf-'+f.name" [placeholder]="f.placeholder ?? ''" /> }
            }
          </div>
        }
        <button class="sf-submit" type="submit">{{ schema()?.submit ? 'Submit' : 'Submit' }}</button>
      </form>
    } @else {
      <div class="sf-none">No <code>schema.fields</code> to render. Add fields to compose this form.</div>
    }
  `,
  styles: [`
    :host { display: block; }
    .sf { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4); border: 1px solid var(--border);
      border-radius: var(--r-md); background: var(--surface); }
    .sf-field { display: flex; flex-direction: column; gap: 5px; }
    .sf-lbl { font-size: var(--fs-sm); font-weight: 500; display: flex; align-items: center; gap: var(--s2); }
    .sf-req { color: var(--danger); }
    .sf-widget { font-family: var(--font-mono); font-size: 10px; color: var(--brand); background: var(--brand-soft); padding: 1px 6px; border-radius: var(--r-full); }
    .sf-in { font: inherit; font-size: var(--fs-sm); padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface); color: var(--text); }
    .sf-in:focus { outline: none; border-color: var(--brand); }
    .sf-check, .sf-radio { display: inline-flex; align-items: center; gap: 7px; font-size: var(--fs-sm); }
    .sf-radios { display: flex; gap: var(--s4); flex-wrap: wrap; }
    .sf-submit { align-self: flex-start; font: inherit; font-weight: 600; font-size: var(--fs-sm); margin-top: var(--s2);
      background: var(--brand); color: #fff; border: none; border-radius: var(--r-full); padding: 9px 20px; cursor: pointer; }
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
}
