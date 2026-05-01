import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ActionRegistry, type ActionContext } from '@maverick/agentic-ui';

/**
 * Generative-UI widget for a single custodian. Rendered when a tool
 * returns `components: [{ name: 'custodianCard', props }]`. Clicking
 * the card dispatches the host's `openCustodian` action which
 * navigates to the Custodians page with the matching custodian
 * pre-selected — same pattern the agent itself can use.
 */
@Component({
  selector: 'app-custodian-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card" role="button" tabindex="0"
             (click)="open()" (keydown.enter)="open()" (keydown.space)="open()">
      <header>
        <span class="badge">custodian</span>
        <strong>{{ name() }}</strong>
        <span class="muted">{{ department() }}</span>
        @if (hasLegalHold()) {
          <span class="hold">on hold</span>
        }
      </header>
      <p class="email">{{ email() }}</p>
      <p class="status">
        Collection:
        <span [attr.data-status]="collectionStatus()">{{ collectionStatus() }}</span>
        · Documents: <strong>{{ documentCount() }}</strong>
      </p>
      <footer>
        <p class="ref">id: <code>{{ custodianId() }}</code></p>
        <span class="cta">Open custodian →</span>
      </footer>
    </article>
  `,
  styles: `
    .card {
      padding: 0.7rem 0.9rem; border: 1px solid #d1d5db;
      border-radius: 0.5rem; background: #fff; margin-top: 0.5rem;
      font: 0.88rem system-ui; border-left: 4px solid #4f46e5;
      cursor: pointer; transition: background 120ms ease-out, border-color 120ms ease-out, transform 120ms ease-out;
    }
    .card:hover { background: #f5f3ff; border-color: #c7d2fe; }
    .card:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
    .card:active { transform: translateY(1px); }
    header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #e0e7ff; color: #3730a3; text-transform: uppercase; letter-spacing: 0.04em; }
    .muted { color: #64748b; font-size: 0.85em; }
    .hold { font-size: 0.7em; padding: 2px 6px; border-radius: 999px; background: #fef3c7; color: #92400e; margin-left: auto; }
    .email { margin: 0.3rem 0; color: #475569; font-size: 0.85em; }
    .status { margin: 0.2rem 0; color: #475569; font-size: 0.85em; }
    .status [data-status] { padding: 1px 6px; border-radius: 999px; text-transform: capitalize; font-size: 0.85em; }
    .status [data-status="complete"] { background: #d1fae5; color: #065f46; }
    .status [data-status="in-progress"] { background: #dbeafe; color: #1e3a8a; }
    .status [data-status="pending"] { background: #fee2e2; color: #991b1b; }
    footer { display: flex; justify-content: space-between; align-items: center; margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px dashed #e2e8f0; }
    .ref { margin: 0; color: #94a3b8; font-size: 0.78em; }
    .cta { color: #4f46e5; font-size: 0.78em; font-weight: 500; opacity: 0; transition: opacity 120ms ease-out; }
    .card:hover .cta, .card:focus-visible .cta { opacity: 1; }
  `,
})
export class CustodianCardComponent {
  readonly custodianId = input.required<string>();
  readonly name = input.required<string>();
  readonly email = input.required<string>();
  readonly department = input.required<string>();
  readonly hasLegalHold = input.required<boolean>();
  readonly collectionStatus = input.required<string>();
  readonly documentCount = input.required<number>();

  private readonly actions = inject(ActionRegistry);

  open(): void {
    const action = this.actions.get('openCustodian');
    if (!action) return;                         // host hasn't registered the action — silent no-op
    void action.effect({ custodianId: this.custodianId() }, syntheticActionContext());
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
