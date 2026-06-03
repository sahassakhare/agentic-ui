import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Minimal flight card — renders the shared-tools `bookFlight` result.
 * The agent picks this component by name (`flightCard`) via `ComponentRegistry`;
 * props are Zod-validated before mount through `<mvk-widget-container>`.
 */
@Component({
  selector: 'app-flight-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card flight">
      <header>
        <span class="badge">flight</span>
        <span class="route">{{ from() }} → {{ to() }}</span>
        <span class="status">{{ status() }}</span>
      </header>
      <p class="date">{{ date() }}</p>
      <p class="ref">Booking <code>{{ bookingId() }}</code></p>
    </article>
  `,
  styles: `
    .card { padding: 0.9rem 1rem; border: 1px solid var(--border); border-left: 4px solid var(--primary); border-radius: var(--r); background: var(--surface); box-shadow: var(--shadow); }
    header { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #dbeafe; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
    .route { font-weight: 600; font-size: 1.05rem; }
    .status { margin-left: auto; font-size: 0.75em; padding: 2px 8px; border-radius: 999px; background: #d1fae5; color: #065f46; }
    .date { margin: 0.2rem 0 0.1rem; color: var(--muted); }
    .ref { margin: 0; color: var(--muted); font-size: 0.85em; }
    code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; }
  `,
})
export class FlightCardComponent {
  readonly bookingId = input<string>('');
  readonly from = input<string>('');
  readonly to = input<string>('');
  readonly date = input<string>('');
  readonly status = input<string>('confirmed');
}
