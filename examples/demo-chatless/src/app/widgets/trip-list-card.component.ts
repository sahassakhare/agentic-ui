import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

interface TripRow {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly date: string;
  readonly status: 'confirmed' | 'pending' | 'cancelled';
  readonly cabin: 'economy' | 'premium' | 'business';
  readonly price: number;
  readonly seat?: string;
}

/**
 * Mature trip-list widget rendering an agent-emitted list of bookings.
 * Each row has a status pill, cabin chip, price, and an inline ⋯ action menu
 * with Change date / Cancel / Add to calendar. Selecting a row reveals an
 * inline detail strip — the "drill-in without leaving the page" pattern
 * Linear / Superhuman use.
 */
@Component({
  selector: 'app-trip-list-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <article class="card">
      <header>
        <h3>Upcoming trips <span class="muted">· {{ trips().length }}</span></h3>
        <div class="filters">
          @for (f of statusFilters; track f.value) {
            <button
              type="button"
              class="chip"
              [class.active]="filter() === f.value"
              (click)="filter.set(f.value)">
              {{ f.label }}
            </button>
          }
        </div>
      </header>

      <ul class="rows" role="list">
        @for (t of filteredTrips(); track t.id) {
          <li
            class="row"
            [class.expanded]="selectedId() === t.id"
            (click)="toggle(t.id)">
            <div class="route">
              <span class="airport">{{ t.from }}</span>
              <span class="dash">→</span>
              <span class="airport">{{ t.to }}</span>
            </div>
            <div class="meta">
              <span class="date">{{ t.date }}</span>
              <span class="chip cabin cabin--{{ t.cabin }}">{{ t.cabin }}</span>
              <span class="status status--{{ t.status }}">{{ t.status }}</span>
            </div>
            <div class="price">
              <span class="amount">\${{ t.price | number }}</span>
              @if (t.seat) { <span class="seat">{{ t.seat }}</span> }
            </div>
            <button class="more" type="button" (click)="openMenu($event, t.id)" aria-label="Row actions">⋯</button>

            @if (selectedId() === t.id) {
              <div class="detail" (click)="$event.stopPropagation()">
                <dl>
                  <dt>Booking</dt><dd><code>{{ t.id }}</code></dd>
                  <dt>Cabin</dt><dd>{{ t.cabin }}</dd>
                  @if (t.seat) { <dt>Seat</dt><dd>{{ t.seat }}</dd> }
                  <dt>Status</dt><dd>{{ t.status }}</dd>
                  <dt>Price</dt><dd>\${{ t.price | number }}</dd>
                </dl>
                <div class="actions">
                  <button type="button" class="action">Change date</button>
                  <button type="button" class="action">Add to calendar</button>
                  <button type="button" class="action danger">Cancel trip</button>
                </div>
              </div>
            }

            @if (openMenuId() === t.id) {
              <ul class="menu" role="menu" (click)="$event.stopPropagation()">
                <li><button type="button">Change date</button></li>
                <li><button type="button">Change seat</button></li>
                <li><button type="button">Add to calendar</button></li>
                <li><button type="button" class="danger">Cancel trip</button></li>
              </ul>
            }
          </li>
        }
        @if (filteredTrips().length === 0) {
          <li class="empty">No trips match this filter.</li>
        }
      </ul>
    </article>
  `,
  styles: `
    :host { display: block; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--shadow); padding: 1rem 1.1rem 0.75rem; }
    header { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0.75rem; }
    h3 { margin: 0; font-size: 0.95rem; font-weight: 700; }
    .muted { color: var(--muted); font-weight: 400; }
    .filters { margin-left: auto; display: flex; gap: 0.3rem; }
    .chip { padding: 0.2rem 0.55rem; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); font: inherit; font-size: 0.75em; color: var(--muted); }
    .chip.active { background: #eef2ff; color: #4338ca; border-color: #c7d2fe; }

    .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; }
    .row {
      display: grid; grid-template-columns: minmax(110px, 0.7fr) minmax(220px, 1.4fr) minmax(110px, 0.7fr) 32px;
      gap: 0.75rem; align-items: center;
      padding: 0.55rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      cursor: pointer;
      transition: background 0.1s, box-shadow 0.15s;
      position: relative;
    }
    .row:hover { background: #f8fafc; }
    .row.expanded { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }

    .route { display: flex; align-items: center; gap: 0.4rem; font-weight: 600; }
    .airport { letter-spacing: 0.04em; }
    .dash { color: var(--muted); }

    .meta { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
    .date { color: var(--muted); font-size: 0.85em; }

    .cabin {
      text-transform: capitalize; font-size: 0.7em; padding: 1px 7px;
    }
    .cabin--economy  { background: #e0f2fe; color: #075985; border-color: #bae6fd; }
    .cabin--premium  { background: #fae8ff; color: #86198f; border-color: #f0abfc; }
    .cabin--business { background: #fef3c7; color: #92400e; border-color: #fde68a; }

    .status { font-size: 0.7em; padding: 1px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
    .status--confirmed { background: #d1fae5; color: #065f46; }
    .status--pending   { background: #fef3c7; color: #92400e; }
    .status--cancelled { background: #fee2e2; color: #991b1b; }

    .price { display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; }
    .amount { font-weight: 600; font-variant-numeric: tabular-nums; }
    .seat { color: var(--muted); font-size: 0.8em; }

    .more { background: var(--surface); border: 1px solid transparent; border-radius: var(--r-sm); width: 28px; height: 28px; padding: 0; color: var(--muted); }
    .more:hover { background: #f1f5f9; border-color: var(--border); }

    .detail { grid-column: 1 / -1; padding: 0.6rem 0.2rem 0.2rem; border-top: 1px dashed var(--border); display: grid; gap: 0.6rem; }
    .detail dl { display: grid; grid-template-columns: auto 1fr; column-gap: 0.6rem; row-gap: 0.2rem; margin: 0; font-size: 0.85em; }
    .detail dt { color: var(--muted); }
    .detail dd { margin: 0; }
    .detail code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; }
    .actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .action { padding: 0.35rem 0.65rem; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface); font: inherit; font-size: 0.85em; }
    .action:hover { background: #f1f5f9; }
    .action.danger { color: var(--error); border-color: #fecaca; }
    .action.danger:hover { background: #fef2f2; }

    .menu {
      position: absolute; right: 8px; top: 100%; z-index: 5;
      list-style: none; margin: 0.2rem 0 0; padding: 0.3rem;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm);
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
      min-width: 170px;
    }
    .menu li button {
      display: block; width: 100%; text-align: left;
      padding: 0.4rem 0.6rem; border: 0; background: transparent; font: inherit; font-size: 0.85em;
      border-radius: var(--r-sm);
    }
    .menu li button:hover { background: #f1f5f9; }
    .menu li button.danger { color: var(--error); }

    .empty { padding: 1.2rem; color: var(--muted); text-align: center; font-style: italic; }
  `,
})
export class TripListCardComponent {
  readonly trips = input.required<readonly TripRow[]>();

  protected readonly statusFilters: ReadonlyArray<{ label: string; value: 'all' | TripRow['status'] }> = [
    { label: 'All',       value: 'all' },
    { label: 'Confirmed', value: 'confirmed' },
    { label: 'Pending',   value: 'pending' },
  ];

  protected readonly filter = signal<'all' | TripRow['status']>('all');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly openMenuId = signal<string | null>(null);

  protected readonly filteredTrips = computed<readonly TripRow[]>(() => {
    const f = this.filter();
    return f === 'all' ? this.trips() : this.trips().filter((t) => t.status === f);
  });

  protected toggle(id: string): void {
    this.openMenuId.set(null);
    this.selectedId.update((cur) => (cur === id ? null : id));
  }

  protected openMenu(event: MouseEvent, id: string): void {
    event.stopPropagation();
    this.openMenuId.update((cur) => (cur === id ? null : id));
  }
}
