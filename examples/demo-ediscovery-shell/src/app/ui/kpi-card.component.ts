import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent, type IconName } from './icon.component';

/**
 * KPI tile. Renders a label, value, and (optional) sub-label with an
 * accent stripe driven by `tone`. Used on the matter dashboard.
 */
@Component({
  selector: 'mvk-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <article class="card" [attr.data-tone]="tone()">
      <header>
        <span class="label">{{ label() }}</span>
        @if (icon(); as i) { <span class="ico"><svg-icon [name]="i" [size]="16" /></span> }
      </header>
      <p class="value">{{ value() }}</p>
      @if (sub(); as s) { <p class="sub">{{ s }}</p> }
      @if (deltaPct() !== null && deltaPct() !== undefined) {
        <p class="delta" [class.up]="(deltaPct() ?? 0) >= 0" [class.down]="(deltaPct() ?? 0) < 0">
          {{ (deltaPct() ?? 0) >= 0 ? '▲' : '▼' }} {{ deltaAbs() }}
          <span class="delta-label">{{ deltaLabel() }}</span>
        </p>
      }
    </article>
  `,
  styles: `
    .card {
      background: var(--c-surface-0);
      border: 1px solid var(--c-border);
      border-radius: var(--r-lg);
      padding: var(--s-4) var(--s-5);
      box-shadow: var(--sh-1);
      position: relative; overflow: hidden;
      transition: box-shadow var(--t-fast);
    }
    .card::before {
      content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
      background: var(--c-brand);
    }
    .card[data-tone="ok"]::before   { background: var(--c-ok); }
    .card[data-tone="warn"]::before { background: var(--c-warn); }
    .card[data-tone="bad"]::before  { background: var(--c-bad); }
    .card[data-tone="info"]::before { background: var(--c-info); }
    .card:hover { box-shadow: var(--sh-2); }
    header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.3rem;
    }
    .label {
      font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--c-text-mute); font-weight: 500;
    }
    .ico {
      width: 26px; height: 26px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-brand-tint); color: var(--c-brand-strong);
      border-radius: var(--r-md);
    }
    .card[data-tone="ok"] .ico   { background: var(--c-ok-soft); color: var(--c-ok); }
    .card[data-tone="warn"] .ico { background: var(--c-warn-soft); color: var(--c-warn); }
    .card[data-tone="bad"] .ico  { background: var(--c-bad-soft); color: var(--c-bad); }
    .card[data-tone="info"] .ico { background: var(--c-info-soft); color: var(--c-info); }
    .value {
      margin: 0.1rem 0 0.15rem;
      font-size: var(--fs-2xl); font-weight: 600;
      color: var(--c-text); font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }
    .sub { margin: 0; color: var(--c-text-mute); font-size: var(--fs-sm); }
    .delta {
      margin: 0.4rem 0 0; font-size: var(--fs-xs);
      display: inline-flex; align-items: center; gap: 0.25rem;
    }
    .delta.up { color: var(--c-ok); }
    .delta.down { color: var(--c-bad); }
    .delta-label { color: var(--c-text-mute); font-weight: 400; }
  `,
})
export class KpiCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number | null | undefined>();
  readonly sub = input<string | undefined>(undefined);
  readonly icon = input<IconName | undefined>(undefined);
  readonly tone = input<'brand' | 'ok' | 'warn' | 'bad' | 'info'>('brand');
  /** Optional delta vs prior period — drives the up/down chevron. */
  readonly deltaPct = input<number | null | undefined>(null);
  readonly deltaLabel = input<string>('vs last week');

  protected readonly deltaAbs = computed(() => {
    const d = this.deltaPct();
    if (d === null || d === undefined) return '';
    return Math.abs(d).toFixed(1) + '%';
  });
}
