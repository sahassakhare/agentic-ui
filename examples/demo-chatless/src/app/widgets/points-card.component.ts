import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-points-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <article class="card points">
      <header>
        <span class="badge">loyalty</span>
        <span class="title">Points balance</span>
        <span class="tier">{{ tier() }}</span>
      </header>
      <p class="balance">{{ balance() | number }}</p>
    </article>
  `,
  styles: `
    .card { padding: 0.9rem 1rem; border: 1px solid var(--border); border-left: 4px solid #a855f7; border-radius: var(--r); background: var(--surface); box-shadow: var(--shadow); }
    header { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #ede9fe; color: #5b21b6; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
    .title { font-weight: 600; }
    .tier { margin-left: auto; font-size: 0.75em; padding: 2px 8px; border-radius: 999px; background: #fef3c7; color: #92400e; }
    .balance { margin: 0.2rem 0; font-size: 1.6rem; font-weight: 700; color: var(--text); }
  `,
})
export class PointsCardComponent {
  readonly balance = input<number>(0);
  readonly tier = input<string>('');
}
