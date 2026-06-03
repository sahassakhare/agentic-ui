import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

interface TicketRow {
  readonly id: string;
  readonly subject: string;
  readonly status: 'open' | 'awaiting-customer' | 'in-progress' | 'resolved';
  readonly priority: 'low' | 'normal' | 'high';
  readonly updated: string;
  readonly assignee?: string;
}

/**
 * Mature support-tickets widget — sortable list with status filter chips,
 * priority pill, last-updated date, assignee, and an inline action menu per
 * row (Escalate / Reply / Resolve / Reopen). Models the Linear-style queue
 * pattern Linear / Front / Zendesk all settle on.
 */
@Component({
  selector: 'app-ticket-list-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <h3>Support tickets <span class="muted">· {{ tickets().length }}</span></h3>
        <div class="filters">
          @for (f of statusFilters; track f.value) {
            <button
              type="button"
              class="chip"
              [class.active]="filter() === f.value"
              (click)="filter.set(f.value)">
              {{ f.label }}
              <span class="chip-count">{{ countFor(f.value) }}</span>
            </button>
          }
        </div>
      </header>

      <table class="table">
        <thead>
          <tr>
            <th class="th-subject">Subject</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th class="th-date">Updated</th>
            <th class="th-action"></th>
          </tr>
        </thead>
        <tbody>
          @for (t of filtered(); track t.id) {
            <tr>
              <td class="td-subject">
                <span class="subject">{{ t.subject }}</span>
                <span class="ref"><code>{{ t.id }}</code></span>
              </td>
              <td><span class="status status--{{ t.status }}">{{ t.status }}</span></td>
              <td><span class="priority priority--{{ t.priority }}">{{ t.priority }}</span></td>
              <td>
                @if (t.assignee) {
                  <span class="assignee">{{ initials(t.assignee) }} <span class="muted">{{ t.assignee }}</span></span>
                } @else {
                  <span class="muted">Unassigned</span>
                }
              </td>
              <td class="td-date">{{ t.updated }}</td>
              <td class="td-action">
                <button type="button" class="more" (click)="openMenu($event, t.id)">⋯</button>
                @if (openMenuId() === t.id) {
                  <ul class="menu" role="menu" (click)="$event.stopPropagation()">
                    <li><button type="button">Reply</button></li>
                    <li><button type="button">Escalate</button></li>
                    <li><button type="button">Mark resolved</button></li>
                    <li><button type="button">Reassign…</button></li>
                  </ul>
                }
              </td>
            </tr>
          }
          @if (filtered().length === 0) {
            <tr><td colspan="6" class="empty">No tickets match this filter.</td></tr>
          }
        </tbody>
      </table>
    </article>
  `,
  styles: `
    :host { display: block; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--shadow); padding: 1rem 1.1rem 0.4rem; }
    header { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; }
    h3 { margin: 0; font-size: 0.95rem; font-weight: 700; }
    .muted { color: var(--muted); font-weight: 400; }
    .filters { margin-left: auto; display: flex; gap: 0.3rem; flex-wrap: wrap; }
    .chip { padding: 0.2rem 0.55rem; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); font: inherit; font-size: 0.75em; color: var(--muted); display: inline-flex; align-items: center; gap: 0.3rem; }
    .chip.active { background: #eef2ff; color: #4338ca; border-color: #c7d2fe; }
    .chip-count { background: #e5e7eb; padding: 0 5px; border-radius: 999px; font-size: 0.9em; }
    .chip.active .chip-count { background: #c7d2fe; }

    .table { width: 100%; border-collapse: collapse; font-size: 0.88em; }
    thead { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    th { text-align: left; font-weight: 600; padding: 0.4rem 0.55rem; border-bottom: 1px solid var(--border); }
    .th-subject { width: 38%; }
    .th-date { white-space: nowrap; }
    .th-action { width: 36px; }

    tbody tr { border-bottom: 1px solid var(--border); }
    tbody tr:last-child { border-bottom: 0; }
    tbody tr:hover { background: #f8fafc; }
    td { padding: 0.5rem 0.55rem; vertical-align: middle; }

    .td-subject { display: flex; flex-direction: column; gap: 0.1rem; }
    .subject { font-weight: 500; }
    .ref code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; font-size: 0.75em; color: var(--muted); }

    .status, .priority { font-size: 0.7em; padding: 1px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; white-space: nowrap; }
    .status--open               { background: #fee2e2; color: #991b1b; }
    .status--in-progress        { background: #dbeafe; color: #1e3a8a; }
    .status--awaiting-customer  { background: #fef3c7; color: #92400e; }
    .status--resolved           { background: #d1fae5; color: #065f46; }
    .priority--low    { background: #e0e7ff; color: #3730a3; }
    .priority--normal { background: #e5e7eb; color: #374151; }
    .priority--high   { background: #fee2e2; color: #991b1b; }

    .assignee {
      display: inline-flex; align-items: center; gap: 0.35rem;
    }
    .assignee::before {
      content: attr(data-initials);
    }
    .assignee {
      font-size: 0.85em;
    }

    .td-date { color: var(--muted); font-size: 0.85em; white-space: nowrap; }

    .td-action { position: relative; text-align: right; }
    .more { background: var(--surface); border: 1px solid transparent; border-radius: var(--r-sm); width: 28px; height: 28px; padding: 0; color: var(--muted); }
    .more:hover { background: #f1f5f9; border-color: var(--border); }
    .menu {
      position: absolute; right: 8px; top: 100%; z-index: 5;
      list-style: none; margin: 0.2rem 0 0; padding: 0.3rem;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm);
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12); min-width: 150px;
    }
    .menu li button { display: block; width: 100%; text-align: left; padding: 0.4rem 0.6rem; border: 0; background: transparent; font: inherit; font-size: 0.85em; border-radius: var(--r-sm); }
    .menu li button:hover { background: #f1f5f9; }

    .empty { padding: 1.4rem; color: var(--muted); text-align: center; font-style: italic; }
  `,
})
export class TicketListCardComponent {
  readonly tickets = input.required<readonly TicketRow[]>();

  protected readonly statusFilters: ReadonlyArray<{ label: string; value: 'all' | TicketRow['status'] }> = [
    { label: 'All',                 value: 'all' },
    { label: 'Open',                value: 'open' },
    { label: 'In progress',         value: 'in-progress' },
    { label: 'Awaiting customer',   value: 'awaiting-customer' },
    { label: 'Resolved',            value: 'resolved' },
  ];

  protected readonly filter = signal<'all' | TicketRow['status']>('all');
  protected readonly openMenuId = signal<string | null>(null);

  protected readonly filtered = computed<readonly TicketRow[]>(() => {
    const f = this.filter();
    return f === 'all' ? this.tickets() : this.tickets().filter((t) => t.status === f);
  });

  protected countFor(value: 'all' | TicketRow['status']): number {
    return value === 'all' ? this.tickets().length : this.tickets().filter((t) => t.status === value).length;
  }

  protected initials(name: string): string {
    return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  protected openMenu(event: MouseEvent, id: string): void {
    event.stopPropagation();
    this.openMenuId.update((cur) => (cur === id ? null : id));
  }
}
