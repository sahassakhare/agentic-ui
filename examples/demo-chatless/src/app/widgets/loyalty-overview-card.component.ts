import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface LoyaltyTransaction {
  readonly id: string;
  readonly date: string;
  readonly kind: 'earned' | 'redeemed' | 'expired';
  readonly description: string;
  readonly delta: number;
}

/**
 * Mature loyalty-overview widget — balance, tier, miles-to-next-tier progress,
 * a small set of redemption options, and a recent-activity log. Several
 * widgets stacked in one composite, the way Linear/HubSpot account pages
 * surface metric-plus-history-plus-actions.
 */
@Component({
  selector: 'app-loyalty-overview-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <article class="card">
      <header>
        <div class="lead">
          <span class="balance">{{ balance() | number }}</span>
          <span class="balance-unit">points</span>
        </div>
        <span class="tier tier--{{ tier() }}">{{ tier() }} member</span>
      </header>

      <section class="progress" aria-label="Progress to next tier">
        <div class="bar"><span [style.width]="progressPercent() + '%'"></span></div>
        <p class="hint">
          {{ milesToNext() | number }} more points until {{ nextTierLabel() }}
          (target {{ nextTierAt() | number }})
        </p>
      </section>

      <section class="redeem">
        <h4>Redeem points</h4>
        <ul role="list">
          @for (opt of redemptions; track opt.label) {
            <li>
              <button type="button" [disabled]="opt.cost > balance()">
                <span class="opt-label">{{ opt.label }}</span>
                <span class="opt-cost">{{ opt.cost | number }} pts</span>
              </button>
            </li>
          }
        </ul>
      </section>

      <section class="history">
        <h4>Recent activity</h4>
        <ul role="list" class="log">
          @for (tx of transactions(); track tx.id) {
            <li>
              <span class="tx-date">{{ tx.date }}</span>
              <span class="tx-kind tx-kind--{{ tx.kind }}">{{ tx.kind }}</span>
              <span class="tx-desc">{{ tx.description }}</span>
              <span class="tx-delta" [class.positive]="tx.delta > 0">
                {{ tx.delta > 0 ? '+' : '' }}{{ tx.delta | number }}
              </span>
            </li>
          }
        </ul>
      </section>
    </article>
  `,
  styles: `
    :host { display: block; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--shadow); padding: 1.1rem 1.2rem; display: grid; gap: 1.1rem; }

    header { display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between; }
    .lead { display: flex; align-items: baseline; gap: 0.45rem; }
    .balance { font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .balance-unit { color: var(--muted); }
    .tier { padding: 0.25rem 0.7rem; border-radius: 999px; font-size: 0.75em; font-weight: 600; text-transform: capitalize; letter-spacing: 0.04em; }
    .tier--silver   { background: #e5e7eb; color: #475569; }
    .tier--gold     { background: #fef3c7; color: #92400e; }
    .tier--platinum { background: #ede9fe; color: #5b21b6; }

    .progress { display: grid; gap: 0.35rem; }
    .bar { height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
    .bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--primary), #06b6d4); border-radius: 999px; }
    .hint { margin: 0; color: var(--muted); font-size: 0.82em; }

    .redeem, .history { display: grid; gap: 0.45rem; }
    h4 { margin: 0; font-size: 0.7em; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 600; }

    .redeem ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
    .redeem button {
      display: flex; flex-direction: column; gap: 0.15rem;
      padding: 0.55rem 0.7rem;
      border: 1px solid var(--border); border-radius: var(--r-sm);
      background: var(--surface); font: inherit;
      text-align: left; width: 100%;
    }
    .redeem button:not(:disabled):hover { background: #f8fafc; border-color: #c7d2fe; }
    .redeem .opt-label { font-weight: 600; font-size: 0.9em; }
    .redeem .opt-cost { color: var(--muted); font-size: 0.78em; font-variant-numeric: tabular-nums; }

    .log { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.2rem; }
    .log li {
      display: grid; grid-template-columns: 90px 80px 1fr auto; gap: 0.55rem; align-items: center;
      padding: 0.35rem 0.5rem; border-radius: var(--r-sm);
      font-size: 0.85em;
    }
    .log li:nth-child(odd) { background: #f8fafc; }
    .tx-date { color: var(--muted); font-variant-numeric: tabular-nums; }
    .tx-kind { font-size: 0.7em; padding: 1px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
    .tx-kind--earned   { background: #d1fae5; color: #065f46; }
    .tx-kind--redeemed { background: #dbeafe; color: #1e3a8a; }
    .tx-kind--expired  { background: #fee2e2; color: #991b1b; }
    .tx-desc { color: var(--text); }
    .tx-delta { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--error); }
    .tx-delta.positive { color: var(--success); }
  `,
})
export class LoyaltyOverviewCardComponent {
  readonly balance = input.required<number>();
  readonly tier = input.required<string>();
  readonly nextTierAt = input.required<number>();
  readonly milesToNext = input.required<number>();
  readonly transactions = input<readonly LoyaltyTransaction[]>([]);

  protected readonly redemptions: ReadonlyArray<{ label: string; cost: number }> = [
    { label: 'Seat upgrade (premium)', cost: 12_500 },
    { label: 'Lounge day pass',        cost: 8_000  },
    { label: 'Round-trip JFK ↔ LAX',   cost: 45_000 },
    { label: '$50 hotel credit',       cost: 4_500  },
  ];

  protected readonly progressPercent = computed(() => {
    const balance = this.balance();
    const target = this.nextTierAt();
    if (target <= 0) return 100;
    return Math.min(100, Math.round((balance / target) * 100));
  });

  protected nextTierLabel(): string {
    const t = this.tier();
    if (t === 'silver') return 'Gold';
    if (t === 'gold') return 'Platinum';
    return 'next status';
  }
}
