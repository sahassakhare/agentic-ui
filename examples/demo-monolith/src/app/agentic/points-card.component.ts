import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Generative-UI widget for the `checkPoints` loyalty tool result. */
@Component({
  selector: 'app-points-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card" [attr.data-tier]="tier()">
      <header>
        <span class="label">Loyalty balance</span>
        <span class="tier">{{ tier() }}</span>
      </header>
      <p class="balance">{{ balance().toLocaleString() }} <span class="unit">pts</span></p>
      <div class="meter"><div class="fill" [style.width.%]="pct()"></div></div>
      <p class="hint">{{ toNext() }}</p>
    </article>
  `,
  styles: `
    .card { padding: 0.8rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fafafa; font: 0.9rem system-ui; margin-top: 0.5rem; }
    header { display: flex; justify-content: space-between; align-items: center; }
    .label { font-weight: 600; }
    .tier { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; background: #e5e7eb; color: #374151; }
    .card[data-tier="gold"] .tier { background: #fef3c7; color: #92400e; }
    .card[data-tier="platinum"] .tier { background: #ede9fe; color: #5b21b6; }
    .balance { margin: 0.4rem 0 0.3rem; font-size: 1.5rem; font-weight: 700; color: #111827; font-variant-numeric: tabular-nums; }
    .unit { font-size: 0.6em; font-weight: 500; color: #6b7280; }
    .meter { height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
    .fill { height: 100%; background: linear-gradient(90deg, #6366f1, #a855f7); }
    .hint { margin: 0.3rem 0 0; color: #6b7280; font-size: 0.78em; }
  `,
})
export class PointsCardComponent {
  readonly balance = input.required<number>();
  readonly tier = input.required<string>();

  /** Progress toward the next tier threshold (silver→gold 25k, gold→platinum 40k). */
  protected readonly pct = computed(() => {
    const b = this.balance();
    if (b >= 40_000) return 100;
    if (b >= 25_000) return Math.min(100, ((b - 25_000) / 15_000) * 100);
    return Math.min(100, (b / 25_000) * 100);
  });

  protected readonly toNext = computed(() => {
    const b = this.balance();
    if (b >= 40_000) return 'Top tier — platinum benefits unlocked.';
    if (b >= 25_000) return `${(40_000 - b).toLocaleString()} pts to platinum.`;
    return `${(25_000 - b).toLocaleString()} pts to gold.`;
  });
}
