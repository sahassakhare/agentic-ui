import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-flight-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="route">{{ from() }} → {{ to() }}</span>
        <span class="status" [class.confirmed]="status() === 'confirmed'">{{ status() }}</span>
      </header>
      <p class="date">{{ date() }}</p>
      <p class="ref">Booking: <code>{{ bookingId() }}</code></p>
    </article>
  `,
  styles: `
    .card { padding: 0.8rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fafafa; font: 0.9rem system-ui; margin-top: 0.5rem; }
    header { display: flex; justify-content: space-between; align-items: center; }
    .route { font-weight: 600; }
    .status { font-size: 0.75em; padding: 2px 6px; border-radius: 999px; background: #fee2e2; color: #991b1b; }
    .status.confirmed { background: #d1fae5; color: #065f46; }
    .date { margin: 0.4rem 0 0.2rem; color: #4b5563; }
    .ref { margin: 0; color: #6b7280; font-size: 0.8em; }
  `,
})
export class FlightCardComponent {
  readonly bookingId = input.required<string>();
  readonly from = input.required<string>();
  readonly to = input.required<string>();
  readonly date = input.required<string>();
  readonly status = input.required<string>();
}
