import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

/**
 * Compact pill for state ("complete", "in-progress", "pending",
 * "released") and review states. The five tones map onto the design-token
 * semantic palette (ok / warn / bad / info / neutral).
 */
@Component({
  selector: 'mvk-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [attr.data-tone]="tone()"><ng-content /></span>`,
  styles: `
    .badge {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 1px 8px; border-radius: var(--r-pill);
      font-size: var(--fs-xs); font-weight: 500;
      text-transform: capitalize;
      background: var(--c-surface-2); color: var(--c-text-2);
    }
    .badge[data-tone="ok"]   { background: var(--c-ok-soft);   color: var(--c-ok); }
    .badge[data-tone="warn"] { background: var(--c-warn-soft); color: var(--c-warn); }
    .badge[data-tone="bad"]  { background: var(--c-bad-soft);  color: var(--c-bad); }
    .badge[data-tone="info"] { background: var(--c-info-soft); color: var(--c-info); }
    .badge[data-tone="neutral"] { background: var(--c-surface-2); color: var(--c-text-2); }
  `,
})
export class StatusBadgeComponent {
  readonly tone = input<StatusTone>('neutral');
}
