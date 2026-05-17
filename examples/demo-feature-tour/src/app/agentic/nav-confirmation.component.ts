import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Tiny generative-UI widget shown after a `navigateTo` tool call —
 * confirms the route the agent decided to navigate the user to. Pairs
 * with the navigate action; both render only after the action's
 * `effect` has already changed the URL.
 */
@Component({
  selector: 'app-nav-confirmation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <span class="badge">action</span>
      <span class="text">Navigated to <code>{{ destination() }}</code>.</span>
    </article>
  `,
  styles: `
    .card { display: flex; gap: 0.6rem; align-items: center; padding: 0.45rem 0.7rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #f0f9ff; margin-top: 0.4rem; font: 0.85rem system-ui; border-left: 4px solid #0284c7; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #e0f2fe; color: #075985; text-transform: uppercase; letter-spacing: 0.04em; }
    .text { color: #334155; }
    code { background: #e2e8f0; padding: 1px 4px; border-radius: 3px; }
  `,
})
export class NavConfirmationComponent {
  readonly destination = input.required<string>();
}
