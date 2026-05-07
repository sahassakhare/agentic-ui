import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormRendererComponent } from '@maverick/agentic-ui';
import { PersonaService } from '../services/persona.service';

/**
 * Generative-UI wrapper for the F1 composable custodian-intake form.
 *
 * The agent emits this widget by name, the chat shell mounts it, and
 * `<mvk-form-renderer formName="custodianIntakeForm" [context]="ctx">`
 * renders the runtime composition. Sections appear/disappear reactively
 * as `matterType`, `persona`, or `department` change (AC-F1-1).
 *
 * **Persona is read from the LIVE `PersonaService` signal**, NOT from a
 * static prop captured at tool-call time. This is the difference between
 * "context-aware once" and "context-aware reactively": when the user
 * switches persona via the header dropdown, every section in this form
 * re-evaluates its `if:` predicate without any remount, so the
 * Approval / supervisor section (gated on `persona !== "lead-counsel"`)
 * appears or disappears in place. The agent can still pass `persona`
 * as a prop, but it's treated as a hint — the live signal wins.
 *
 * Per-section value aggregation is deferred to AC-F1-2; widgets currently
 * own their local state and are not wired to the form's submit handler.
 */
@Component({
  selector: 'app-custodian-intake-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRendererComponent],
  template: `
    <article class="card">
      <header>
        <span class="badge">intake</span>
        <strong>Onboard custodian</strong>
        <span class="muted">{{ matterType() }} · {{ livePersona() }}</span>
      </header>
      <mvk-form-renderer formName="custodianIntakeForm" [context]="ctx()" />
    </article>
  `,
  styles: `
    .card {
      padding: 0.7rem 0.9rem; border: 1px solid #d1d5db;
      border-radius: 0.5rem; background: #fff; margin-top: 0.5rem;
      font: 0.88rem system-ui; border-left: 4px solid #16a34a;
    }
    header { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #dcfce7; color: #166534; text-transform: uppercase; letter-spacing: 0.04em; }
    .muted { color: #64748b; font-size: 0.8em; margin-left: auto; }
  `,
})
export class CustodianIntakeCardComponent {
  readonly matterType = input.required<string>();
  /**
   * Persona prop emitted by the agent. Kept optional for backwards compat
   * and for tools that want to render against an explicit persona (e.g.
   * preview-as-paralegal flows). The live persona below takes precedence
   * so persona-switch in the header is reactive.
   */
  readonly persona = input<string>('');
  readonly department = input<string>('');

  private readonly personaService = inject(PersonaService);

  /** Live persona signal — drives the form context on every render. */
  protected readonly livePersona = this.personaService.active;

  protected readonly ctx = computed(() => ({
    matter: { type: this.matterType() },
    persona: this.livePersona(),
    department: this.department(),
  }));
}
