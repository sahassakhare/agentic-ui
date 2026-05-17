import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ActionRegistry, type ActionContext } from '@infra-tools/agentic-ui';

/**
 * Generative-UI widget for a legal hold. Rendered when a tool returns
 * `components: [{ name: 'legalHoldCard', props }]`. Clicking the card
 * dispatches the host's `openHold` action which navigates to the
 * Legal Holds page focused on this hold.
 */
@Component({
  selector: 'app-legal-hold-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card" role="button" tabindex="0"
             (click)="open()" (keydown.enter)="open()" (keydown.space)="open()">
      <header>
        <span class="badge">legal hold</span>
        <strong>{{ holdId() }}</strong>
        @if (released()) {
          <span class="status released">released</span>
        } @else if (acknowledged()) {
          <span class="status active">acknowledged</span>
        } @else {
          <span class="status pending">pending ack</span>
        }
      </header>
      <p class="scope">{{ scope() }}</p>
      <footer>
        <p class="ref">
          <strong>{{ custodianCount() }}</strong> custodian(s) covered ·
          issued {{ issuedAt() }}
        </p>
        <span class="cta">Open hold →</span>
      </footer>
    </article>
  `,
  styles: `
    .card {
      padding: 0.7rem 0.9rem; border: 1px solid #d1d5db;
      border-radius: 0.5rem; background: #fff; margin-top: 0.5rem;
      font: 0.88rem system-ui; border-left: 4px solid #d97706;
      cursor: pointer; transition: background 120ms ease-out, border-color 120ms ease-out, transform 120ms ease-out;
    }
    .card:hover { background: #fffbeb; border-color: #fcd34d; }
    .card:focus-visible { outline: 2px solid #d97706; outline-offset: 2px; }
    .card:active { transform: translateY(1px); }
    header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #fef3c7; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; }
    .status { font-size: 0.7em; padding: 2px 8px; border-radius: 999px; margin-left: auto; }
    .status.active { background: #d1fae5; color: #065f46; }
    .status.pending { background: #fef3c7; color: #92400e; }
    .status.released { background: #f3f4f6; color: #6b7280; }
    .scope { margin: 0.4rem 0 0.2rem; color: #475569; font-size: 0.88em; line-height: 1.4; }
    footer { display: flex; justify-content: space-between; align-items: center; margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px dashed #e2e8f0; }
    .ref { margin: 0; color: #94a3b8; font-size: 0.78em; }
    .ref strong { color: #475569; }
    .cta { color: #d97706; font-size: 0.78em; font-weight: 500; opacity: 0; transition: opacity 120ms ease-out; }
    .card:hover .cta, .card:focus-visible .cta { opacity: 1; }
  `,
})
export class LegalHoldCardComponent {
  readonly holdId = input.required<string>();
  readonly scope = input.required<string>();
  readonly custodianCount = input.required<number>();
  readonly issuedAt = input.required<string>();
  readonly acknowledged = input.required<boolean>();
  readonly released = input.required<boolean>();

  private readonly actions = inject(ActionRegistry);

  open(): void {
    const action = this.actions.get('openHold');
    if (!action) return;
    void action.effect({ holdId: this.holdId() }, syntheticActionContext());
  }
}

function syntheticActionContext(): ActionContext {
  const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    threadId: 'widget',
    runId: id,
    actionId: id,
    signal: new AbortController().signal,
  };
}
