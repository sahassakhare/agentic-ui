import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-points-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <article class="card loyalty">
      <header>
        <span class="badge">loyalty</span>
        <span class="title">Points balance</span>
        <span class="tier">{{ tier() }}</span>
      </header>
      <p class="balance">{{ balance() | number }} pts</p>
      @if (showNext()) {
        <p class="next">{{ pointsToNext() | number }} pts to {{ nextTier() }}</p>
      }
    </article>
  `,
  styles: `
    .card { padding: 0.8rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; font: 0.9rem system-ui; margin-top: 0.5rem; }
    .card.loyalty { border-left: 4px solid #d97706; }
    header { display: flex; gap: 0.6rem; align-items: center; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #fed7aa; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; }
    .title { flex: 1; font-weight: 600; }
    .tier { font-size: 0.75em; padding: 2px 8px; border-radius: 999px; background: #fef3c7; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; }
    .balance { font-size: 1.4rem; font-weight: 700; margin: 0.4rem 0 0.2rem; color: #b45309; }
    .next { margin: 0; color: #6b7280; font-size: 0.8em; }
  `,
})
export class PointsCardComponent {
  readonly balance = input.required<number>();
  readonly tier = input.required<string>();
  readonly nextTier = input<string>('');
  readonly nextTierAt = input<number | null>(null);

  readonly showNext = computed(() => this.nextTierAt() !== null);
  readonly pointsToNext = computed(() => Math.max(0, (this.nextTierAt() ?? 0) - this.balance()));
}
