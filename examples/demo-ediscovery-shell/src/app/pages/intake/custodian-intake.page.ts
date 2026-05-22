import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormRendererComponent } from '@infra-tools/agentic-ui';
import { PersonaService } from '../../services/persona.service';
import { normaliseDepartment } from '../../agentic/intake-constants';

/**
 * Direct-mount surface for `custodianIntakeForm` — the same definition
 * the chat agent invokes via `openCustodianIntake`. No LLM round-trip,
 * no chat shell. Demonstrates that registry forms are surface-
 * independent: definition lives in `agentic.ts`, page reads it through
 * `<mvk-form-renderer name="…">`.
 *
 * `?department=…` query param pre-fills the conditional accounting-
 * systems section — same context shape the chat tool builds when the
 * LLM extracts the department from the prompt.
 *
 * Trimodal slot per the 2026-05-11 plan (R3): chat / direct page /
 * Cmd+K headless all mount the same definition. Submit lands in the
 * shared `MatterStore` (audit chain identical regardless of trigger).
 */
@Component({
  selector: 'app-custodian-intake-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRendererComponent, RouterLink],
  template: `
    <section class="page-head">
      <p class="crumb">
        <a routerLink="/" class="crumb-link">Matter</a> /
        <a routerLink="/custodians" class="crumb-link">Custodians</a> / Intake
      </p>
      <h1>Onboard custodian</h1>
      <p class="muted">
        Same form the chat agent uses. Same Zod validation, same submit
        handler, same audit row. Edit fields directly or trigger this
        from the agent — both paths produce identical outcomes.
      </p>
    </section>

    <section class="form-host">
      <mvk-form-renderer formName="custodianIntakeForm" [context]="ctx()" [initialValues]="initialValues()">
        <a formActions routerLink="/custodians" class="cancel-btn">Cancel</a>
      </mvk-form-renderer>
    </section>

    <p class="hint">
      Surfaces showing this same form: chat ("onboard a Finance
      custodian"), this page (<code>/intake/custodian</code>), Cmd+K
      palette ("add finance person to project phoenix").
    </p>
  `,
  styles: [`
    .page-head { margin-bottom: 1.5rem; }
    .crumb { font-size: 0.8125rem; color: var(--c-text-muted); margin: 0 0 0.25rem; }
    .crumb-link { color: var(--c-text-muted); text-decoration: none; }
    .crumb-link:hover { color: var(--c-text); text-decoration: underline; }
    h1 { margin: 0 0 0.25rem; }
    .muted { color: var(--c-text-muted); margin: 0; max-width: 60ch; }
    .form-host {
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: 0.625rem;
      padding: 1.5rem;
    }
    .cancel-btn {
      display: inline-flex; align-items: center;
      padding: 0.5rem 0.875rem;
      background: transparent; color: var(--c-text);
      border: 1px solid var(--c-border); border-radius: 0.375rem;
      font-size: 0.875rem; font-weight: 600; text-decoration: none;
      cursor: pointer; transition: background 120ms ease;
    }
    .cancel-btn:hover { background: var(--c-surface-2, var(--c-surface)); }
    .hint {
      margin-top: 1rem;
      font-size: 0.8125rem;
      color: var(--c-text-muted);
      max-width: 60ch;
    }
    .hint code {
      font-size: 0.8125rem;
      background: var(--c-surface-2, var(--c-surface));
      padding: 0.0625rem 0.3125rem;
      border-radius: 0.25rem;
    }
  `],
})
export class CustodianIntakePage {
  private readonly route = inject(ActivatedRoute);
  private readonly persona = inject(PersonaService);

  /** Live signal of the current query params; flips the form context
   *  when the user changes ?department=… without remounting. */
  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });

  /**
   * Shape mirrors the `props` the `openCustodianIntake` tool returns
   * when fired through chat. The form's predicates evaluate against
   * this object, so e.g. `department === 'Finance'` reveals the
   * accounting-systems section identically across surfaces.
   *
   * `department` is normalised through `normaliseDepartment(...)`
   * before being put in the context so that whether the LLM passed
   * 'finance', 'Finance', or 'Finance team', the form's strict
   * `if: 'department === "Finance"'` predicate still fires.
   */
  /** Normalised department from `?department=…` (e.g. "Finance"). */
  protected readonly department = computed(() =>
    normaliseDepartment(this.params()?.get('department') ?? ''),
  );

  protected readonly ctx = computed(() => ({
    // `matter.type` (nested) — the composition predicates read this shape
    // (`matter.type === "securities"`); must match the chat-card path.
    matter: { type: this.params()?.get('matterType') ?? 'securities' },
    persona: this.persona.active(),
    department: this.department(),
  }));

  /**
   * Pre-fills the Identity section from the URL so the form lands with
   * whatever the user already gave ("…for custodian Ramesh,
   * ramesh@test.com, HR" → name + email + department all populated).
   * Keyed by the composition slot (`intake-identity-fields`); the
   * renderer seeds the CompositionStore from this on mount. Emits the
   * slot only when at least one field is present so an empty deep-link
   * still mounts a blank form.
   */
  protected readonly initialValues = computed(() => {
    const name = this.params()?.get('name')?.trim() ?? '';
    const email = this.params()?.get('email')?.trim() ?? '';
    const department = this.department();
    return name || email || department
      ? { 'intake-identity-fields': { name, email, department } }
      : {};
  });
}
