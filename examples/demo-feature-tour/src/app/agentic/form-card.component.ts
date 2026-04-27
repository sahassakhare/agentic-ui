import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormRendererComponent } from '@maverick/agentic-ui';

/**
 * Generative-UI wrapper for `<mvk-form-renderer>`. Tools use this widget
 * by returning `components: [{ name: 'formCard', props: { formName, initialValues } }]`
 * — the chat shell renders the wrapper, the wrapper resolves the form
 * from `FormRegistry`, and the user sees a real form with submit.
 */
@Component({
  selector: 'app-form-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRendererComponent],
  template: `
    <article class="card">
      <header><span class="badge">form</span></header>
      <mvk-form-renderer [formName]="formName()" [initialValues]="initialValues()" />
    </article>
  `,
  styles: `
    .card { padding: 0.6rem 0.8rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; border-left: 4px solid #16a34a; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #dcfce7; color: #166534; text-transform: uppercase; letter-spacing: 0.04em; }
    header { margin-bottom: 0.4rem; }
  `,
})
export class FormCardComponent {
  readonly formName = input.required<string>();
  readonly initialValues = input<Readonly<Record<string, unknown>>>({});
}
