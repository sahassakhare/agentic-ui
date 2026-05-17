import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-ticket-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card support">
      <header>
        <span class="badge">support</span>
        <span class="title">{{ subject() }}</span>
        <span class="status" [attr.data-status]="status()">{{ status() }}</span>
      </header>
      <p class="ref">Ticket: <code>{{ ticketId() }}</code></p>
      <p class="priority">Priority: <strong>{{ priority() }}</strong></p>
    </article>
  `,
  styles: `
    .card { padding: 0.8rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; font: 0.9rem system-ui; margin-top: 0.5rem; }
    .card.support { border-left: 4px solid #7c3aed; }
    header { display: flex; gap: 0.6rem; align-items: center; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #ede9fe; color: #5b21b6; text-transform: uppercase; letter-spacing: 0.04em; }
    .title { flex: 1; font-weight: 600; }
    .status { font-size: 0.75em; padding: 2px 8px; border-radius: 999px; text-transform: capitalize; background: #f3f4f6; color: #374151; }
    .status[data-status="open"] { background: #fee2e2; color: #991b1b; }
    .status[data-status="in_progress"] { background: #fef3c7; color: #92400e; }
    .status[data-status="resolved"] { background: #d1fae5; color: #065f46; }
    .ref, .priority { margin: 0.3rem 0 0; color: #4b5563; font-size: 0.85em; }
  `,
})
export class TicketCardComponent {
  readonly ticketId = input.required<string>();
  readonly subject = input.required<string>();
  readonly status = input.required<string>();
  readonly priority = input.required<string>();
}
