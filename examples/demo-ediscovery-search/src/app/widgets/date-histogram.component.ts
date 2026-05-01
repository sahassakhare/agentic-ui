import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface Bucket {
  key: string;
  label: string;
  count: number;
  inRange: boolean;
}

/**
 * Generative-UI widget rendering a date histogram of matching documents.
 * Bars in-range render solid; out-of-range bars render translucent.
 * Pure presentational — no click handler.
 */
@Component({
  selector: 'app-date-histogram',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="badge">histogram</span>
        <strong>{{ title() }}</strong>
        @if (range()) { <span class="range">{{ range() }}</span> }
      </header>
      <div class="chart" [style.--max]="max()">
        @for (b of buckets(); track b.key) {
          <div class="bar-col" [class.muted]="!b.inRange">
            <div class="bar-frame">
              <span class="bar" [style.height.%]="b.count / max() * 100" [attr.title]="b.count + ' doc(s) in ' + b.label"></span>
            </div>
            <span class="lbl">{{ b.label }}</span>
            <span class="cnt">{{ b.count }}</span>
          </div>
        }
      </div>
      <footer>
        <span class="dot in"></span> in range
        <span class="dot out"></span> out of range
      </footer>
    </article>
  `,
  styles: `
    .card { padding: 0.7rem 0.9rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.86rem system-ui; border-left: 4px solid #0284c7; }
    header { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; margin-bottom: 0.6rem; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; background: #dbeafe; color: #1e40af; text-transform: uppercase; letter-spacing: 0.04em; }
    .range { margin-left: auto; color: #64748b; font-size: 0.78em; font-family: ui-monospace, monospace; }

    .chart {
      display: grid; grid-auto-flow: column; grid-auto-columns: minmax(40px, 1fr);
      align-items: end; gap: 0.3rem;
      height: 130px;
      padding: 0.4rem 0.4rem 0;
      background: #f8fafc; border-radius: 4px;
    }
    .bar-col { display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; }
    .bar-frame { width: 100%; flex: 1; display: flex; align-items: flex-end; justify-content: center; min-height: 0; }
    .bar { width: 100%; max-width: 40px; background: linear-gradient(180deg, #0284c7, #38bdf8); border-radius: 3px 3px 0 0; min-height: 1px; transition: opacity 120ms; }
    .bar-col.muted .bar { background: #cbd5e1; opacity: 0.65; }
    .lbl { font-size: 0.65em; color: #64748b; text-align: center; }
    .cnt { font-size: 0.7em; color: #475569; font-variant-numeric: tabular-nums; font-weight: 600; }
    .bar-col.muted .lbl, .bar-col.muted .cnt { color: #94a3b8; }

    footer { display: flex; gap: 0.6rem; align-items: center; margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px dashed #e2e8f0; font-size: 0.7em; color: #64748b; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; margin-right: 4px; vertical-align: middle; }
    .dot.in { background: #0284c7; }
    .dot.out { background: #cbd5e1; }
  `,
})
export class DateHistogramComponent {
  readonly title = input.required<string>();
  readonly range = input<string | null>(null);
  readonly buckets = input.required<readonly Bucket[]>();

  protected readonly max = computed(() => {
    const m = Math.max(0, ...this.buckets().map((b) => b.count));
    return Math.max(m, 1);
  });
}
