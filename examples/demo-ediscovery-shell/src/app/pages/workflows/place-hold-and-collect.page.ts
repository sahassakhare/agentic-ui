import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkflowRendererComponent } from '@infra-tools/agentic-ui';
import { PersonaService } from '../../services/persona.service';

/**
 * Direct-mount surface for the `placeLegalHoldAndCollect` workflow
 * (plan R5 — complex workflow). The workflow def lives in
 * `agentic.ts`; this page is just a renderer + a small persona
 * affordance so operators can see why a step is gated.
 *
 * Demonstrated patterns:
 *   - Multi-actor handoff: lead-counsel drafts steps 1-2, senior-
 *     counsel approves step 3, lead-counsel collects steps 4-5.
 *     Each step renders a "waiting on …" panel until the right
 *     persona is seated.
 *   - HITL pause: step 3's approval blocks advancement until
 *     associate takes the seat.
 *   - Long-running step: step 4 simulates a 5s collection job with
 *     a progress bar and per-phase status.
 *   - Conditional re-route: zero custodians selected at step 2
 *     loops back to step 1 (`matter-setup`).
 *
 * Persistence (resume after browser refresh) is not implemented in
 * this demo — the plan documents it as a follow-up.
 */
@Component({
  selector: 'app-place-hold-and-collect-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkflowRendererComponent, RouterLink],
  template: `
    <section class="page-head">
      <p class="crumb">
        <a routerLink="/" class="crumb-link">Matter</a> /
        <a routerLink="/holds" class="crumb-link">Legal holds</a> /
        Place hold + collect (multi-actor)
      </p>
      <h1>Place legal hold + collect</h1>
      <p class="muted">
        Five-step wizard with an associate-led approval gate and a
        long-running collection step. Lead-counsel drafts and runs
        the collection; associate approves the notice. Switch
        personas in the header to advance through gated steps.
      </p>
    </section>

    <div class="persona-strip">
      <span class="lbl">Active persona:</span>
      <code [attr.data-tone]="tone()">{{ active() }}</code>
      <span class="hint dim">{{ hint() }}</span>
    </div>

    <section class="workflow-host">
      <mvk-workflow-renderer formName="placeLegalHoldAndCollect" />
    </section>

    <p class="hint">
      The simpler four-step variant lives at
      <code><a routerLink="/workflows/place-hold">/workflows/place-hold</a></code>.
      Same MatterStore, same audit chain, no persona gates.
    </p>
  `,
  styles: [`
    .page-head { margin-bottom: 1.5rem; }
    .crumb { font-size: 0.8125rem; color: var(--c-text-muted); margin: 0 0 0.25rem; }
    .crumb-link { color: var(--c-text-muted); text-decoration: none; }
    .crumb-link:hover { color: var(--c-text); text-decoration: underline; }
    h1 { margin: 0 0 0.25rem; }
    .muted { color: var(--c-text-muted); margin: 0; max-width: 60ch; }

    .persona-strip {
      display: flex; align-items: center; gap: 0.625rem;
      padding: 0.625rem 0.875rem;
      background: var(--c-surface-2, #f8fafc);
      border: 1px solid var(--c-border);
      border-radius: 0.4rem;
      margin-bottom: 1rem;
      font-size: 0.85rem;
    }
    .lbl { color: var(--c-text-muted); font-weight: 500; }
    .persona-strip code {
      font-family: ui-monospace, monospace;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      background: var(--c-surface);
      border: 1px solid var(--c-border);
    }
    .persona-strip code[data-tone="lead"]   { background: #dbeafe; color: #1e3a8a; border-color: #93c5fd; }
    .persona-strip code[data-tone="senior"] { background: #fef3c7; color: #78350f; border-color: #fcd34d; }
    .persona-strip code[data-tone="other"]  { background: #f3f4f6; color: #374151; }

    .workflow-host {
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: 0.625rem;
      padding: 1.5rem;
    }
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
    .dim { color: var(--c-text-muted); }
  `],
})
export class PlaceHoldAndCollectPage {
  private readonly persona = inject(PersonaService);

  protected readonly active = computed(() => this.persona.active());
  protected readonly tone = computed(() => {
    const p = this.active();
    if (p === 'lead-counsel') return 'lead';
    if (p === 'associate') return 'senior';
    return 'other';
  });
  protected readonly hint = computed(() => {
    const p = this.active();
    if (p === 'lead-counsel') return '— you can run setup, custodian pick, and collect.';
    if (p === 'associate') return '— you can approve / reject the hold notice.';
    return '— switch to lead-counsel to start, or associate to approve.';
  });
}
