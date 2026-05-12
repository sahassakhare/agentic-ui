import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkflowRendererComponent } from '@infra-tools/agentic-ui';

/**
 * Direct-mount surface for the `placeLegalHold` workflow — same
 * definition the chat agent invokes via `placeLegalHoldTool`. The
 * step graph, predicates, persona scope, and `onComplete` audit hook
 * all live in `agentic.ts`; this page is just a renderer.
 *
 * Trimodal slot per the 2026-05-11 plan (R3): chat / direct page /
 * Cmd+K all converge on the same workflow definition. Mid-workflow
 * `MatterStore` mutations ride the same audit chain regardless of
 * which surface kicked off the wizard.
 */
@Component({
  selector: 'app-place-hold-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkflowRendererComponent, RouterLink],
  template: `
    <section class="page-head">
      <p class="crumb">
        <a routerLink="/" class="crumb-link">Matter</a> /
        <a routerLink="/holds" class="crumb-link">Legal holds</a> /
        Place hold (workflow)
      </p>
      <h1>Place legal hold</h1>
      <p class="muted">
        Four-step wizard with conditional next, persona-aware steps, and
        terminal submit into the matter audit chain. Same definition the
        chat agent invokes when you ask it to "place a legal hold".
      </p>
    </section>

    <section class="workflow-host">
      <mvk-workflow-renderer formName="placeLegalHold" />
    </section>

    <p class="hint">
      Surfaces showing this same workflow: chat ("place a legal hold"),
      this page (<code>/workflows/place-hold</code>), Cmd+K palette
      ("hold custodian X for matter Y"). For the multi-actor + long-
      running variant see the upcoming
      <code>/workflows/place-hold-and-collect</code>.
    </p>
  `,
  styles: [`
    .page-head { margin-bottom: 1.5rem; }
    .crumb { font-size: 0.8125rem; color: var(--c-text-muted); margin: 0 0 0.25rem; }
    .crumb-link { color: var(--c-text-muted); text-decoration: none; }
    .crumb-link:hover { color: var(--c-text); text-decoration: underline; }
    h1 { margin: 0 0 0.25rem; }
    .muted { color: var(--c-text-muted); margin: 0; max-width: 60ch; }
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
  `],
})
export class PlaceHoldPage {}
