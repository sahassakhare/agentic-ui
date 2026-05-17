import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from './icon.component';

/**
 * Pill-style tag chip with semantic color tokens for the eDiscovery
 * tag taxonomy (responsive / non-responsive / privileged / hot / redact /
 * review-needed). Unknown tags fall back to the neutral "needed" tone
 * so the agent contributing a custom tag from a remote still renders.
 */
@Component({
  selector: 'mvk-tag-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <span class="chip" [attr.data-tone]="tone()">
      @if (showIcon()) { <svg-icon [name]="iconName()" [size]="11" /> }
      <span>{{ tag() }}</span>
    </span>
  `,
  styles: `
    .chip {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 1px 8px; border-radius: var(--r-pill);
      font-size: var(--fs-xs); font-weight: 500; letter-spacing: 0.01em;
      background: var(--c-tag-needed-soft); color: var(--c-tag-needed);
      border: 1px solid transparent;
      white-space: nowrap;
    }
    .chip[data-tone="responsive"]     { background: var(--c-tag-resp-soft); color: var(--c-tag-resp); }
    .chip[data-tone="non-responsive"] { background: var(--c-tag-nonresp-soft); color: var(--c-tag-nonresp); border-color: var(--c-border); }
    .chip[data-tone="privileged"]     { background: var(--c-tag-priv-soft); color: var(--c-tag-priv); }
    .chip[data-tone="hot"]            { background: var(--c-tag-hot-soft); color: var(--c-tag-hot); }
    .chip[data-tone="redact"]         { background: var(--c-tag-redact-soft); color: var(--c-tag-redact); }
    .chip[data-tone="review-needed"]  { background: var(--c-tag-needed-soft); color: var(--c-tag-needed); }
  `,
})
export class TagChipComponent {
  readonly tag = input.required<string>();
  readonly showIcon = input<boolean>(true);
  protected readonly tone = computed(() => {
    const t = this.tag();
    return ['responsive', 'non-responsive', 'privileged', 'hot', 'redact', 'review-needed'].includes(t)
      ? t
      : 'review-needed';
  });
  protected readonly iconName = computed(() => {
    switch (this.tone()) {
      case 'privileged': return 'lock' as const;
      case 'hot': return 'flame' as const;
      case 'redact': return 'eye' as const;
      default: return 'tag' as const;
    }
  });
}
