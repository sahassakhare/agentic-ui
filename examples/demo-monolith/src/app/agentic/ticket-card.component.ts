import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Generative-UI widget for the `openTicket` support tool result. */
@Component({
  selector: 'app-ticket-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="label">Support ticket</span>
        <span class="priority" [attr.data-p]="priority()">{{ priority() }}</span>
      </header>
      <p class="subject">{{ subject() }}</p>
      <p class="meta">
        <code>{{ ticketId() }}</code>
        <span class="status">{{ status() }}</span>
      </p>
    </article>
  `,
  styles: `
    .card { padding: 0.8rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fafafa; font: 0.9rem system-ui; margin-top: 0.5rem; border-left: 3px solid #94a3b8; }
    header { display: flex; justify-content: space-between; align-items: center; }
    .label { font-weight: 600; }
    .priority { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; background: #e5e7eb; color: #374151; }
    .priority[data-p="high"] { background: #fee2e2; color: #991b1b; }
    .priority[data-p="normal"] { background: #dbeafe; color: #1e40af; }
    .priority[data-p="low"] { background: #f1f5f9; color: #475569; }
    .subject { margin: 0.4rem 0 0.3rem; color: #111827; }
    .meta { margin: 0; display: flex; gap: 0.5rem; align-items: center; color: #6b7280; font-size: 0.8em; }
    .meta code { background: #eef2ff; color: #3730a3; padding: 1px 5px; border-radius: 3px; }
    .status { text-transform: capitalize; }
  `,
})
export class TicketCardComponent {
  readonly ticketId = input.required<string>();
  readonly subject = input.required<string>();
  readonly status = input.required<string>();
  readonly priority = input.required<string>();
}
