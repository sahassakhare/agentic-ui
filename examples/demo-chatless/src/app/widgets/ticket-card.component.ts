import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-ticket-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card ticket">
      <header>
        <span class="badge">support</span>
        <span class="subject">{{ subject() }}</span>
        <span class="priority priority--{{ priority() }}">{{ priority() }}</span>
      </header>
      <p class="status">Status: <strong>{{ status() }}</strong></p>
      <p class="ref">Ticket <code>{{ ticketId() }}</code></p>
    </article>
  `,
  styles: `
    .card { padding: 0.9rem 1rem; border: 1px solid var(--border); border-left: 4px solid #f59e0b; border-radius: var(--r); background: var(--surface); box-shadow: var(--shadow); }
    header { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #fef3c7; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
    .subject { font-weight: 600; }
    .priority { margin-left: auto; font-size: 0.75em; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
    .priority--low { background: #e0e7ff; color: #3730a3; }
    .priority--normal { background: #dbeafe; color: #1e3a8a; }
    .priority--high { background: #fee2e2; color: #991b1b; }
    .status { margin: 0.2rem 0; color: var(--text); }
    .ref { margin: 0; color: var(--muted); font-size: 0.85em; }
    code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; }
  `,
})
export class TicketCardComponent {
  readonly ticketId = input<string>('');
  readonly subject = input<string>('');
  readonly status = input<string>('open');
  readonly priority = input<string>('normal');
}
