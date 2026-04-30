import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Review-progress KPI card. Tools may return this when summarising
 * review state ("32 of 100 docs reviewed, 12 privileged").
 */
@Component({
  selector: 'app-review-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="badge">review progress</span>
        <strong>{{ title() }}</strong>
      </header>
      <div class="track">
        <div class="bar" [style.width.%]="reviewedPct()"></div>
      </div>
      <p class="numbers">
        <strong>{{ reviewed() }}</strong>
        <span class="muted">of</span>
        <strong>{{ total() }}</strong>
        <span class="muted">documents reviewed ({{ reviewedPct() }}%)</span>
      </p>
      <ul class="kpis">
        <li><span class="dot dot-resp"></span> Responsive: <strong>{{ responsive() }}</strong></li>
        <li><span class="dot dot-priv"></span> Privileged: <strong>{{ privileged() }}</strong></li>
        <li><span class="dot dot-hot"></span> Hot: <strong>{{ hot() }}</strong></li>
        <li><span class="dot dot-pending"></span> Review-needed: <strong>{{ reviewNeeded() }}</strong></li>
      </ul>
    </article>
  `,
  styles: `
    .card { padding: 0.7rem 0.9rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.86rem system-ui; border-left: 4px solid #6366f1; }
    header { display: flex; gap: 0.5rem; align-items: baseline; margin-bottom: 0.4rem; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; background: #e0e7ff; color: #3730a3; text-transform: uppercase; letter-spacing: 0.04em; }
    .track { height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden; margin: 0.3rem 0 0.4rem; }
    .track .bar { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 999px; transition: width 200ms ease-out; }
    .numbers { margin: 0 0 0.5rem; color: #1e293b; font-size: 0.92em; }
    .numbers .muted { color: #64748b; margin: 0 0.25rem; font-weight: 400; }
    .kpis { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.2rem 0.6rem; font-size: 0.82em; color: #475569; }
    .kpis strong { color: #0f172a; font-variant-numeric: tabular-nums; margin-left: 0.2rem; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; margin-right: 0.35rem; vertical-align: middle; }
    .dot-resp { background: #10b981; }
    .dot-priv { background: #ef4444; }
    .dot-hot { background: #f59e0b; }
    .dot-pending { background: #94a3b8; }
  `,
})
export class ReviewProgressComponent {
  readonly title = input.required<string>();
  readonly total = input.required<number>();
  readonly reviewed = input.required<number>();
  readonly responsive = input.required<number>();
  readonly privileged = input.required<number>();
  readonly hot = input.required<number>();
  readonly reviewNeeded = input.required<number>();

  protected readonly reviewedPct = computed(() => {
    const t = this.total();
    return t === 0 ? 0 : Math.round((this.reviewed() / t) * 100);
  });
}
