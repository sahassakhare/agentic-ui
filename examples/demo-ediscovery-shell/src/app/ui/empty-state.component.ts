import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent, type IconName } from './icon.component';

/**
 * Generic empty state — used wherever a list / table has no rows.
 * Encourages action by suggesting a chat prompt.
 */
@Component({
  selector: 'mvk-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="empty">
      <div class="ico"><svg-icon [name]="icon()" [size]="22" /></div>
      <h3>{{ title() }}</h3>
      <p>{{ message() }}</p>
      @if (hint(); as h) { <p class="hint">Try asking: <em>"{{ h }}"</em></p> }
    </div>
  `,
  styles: `
    .empty {
      padding: var(--s-8) var(--s-6);
      text-align: center; color: var(--c-text-mute);
      background: var(--c-surface-0);
      border: 1px dashed var(--c-border-strong);
      border-radius: var(--r-lg);
    }
    .ico {
      display: inline-flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; margin-bottom: var(--s-3);
      background: var(--c-brand-tint); color: var(--c-brand-strong);
      border-radius: var(--r-pill);
    }
    h3 { margin: 0 0 0.3rem; color: var(--c-text-2); font-size: var(--fs-md); font-weight: 600; }
    p { margin: 0; font-size: var(--fs-sm); }
    .hint { margin-top: var(--s-3); color: var(--c-text-faint); font-size: var(--fs-xs); }
    .hint em { color: var(--c-brand-strong); font-style: italic; }
  `,
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly icon = input<IconName>('sparkles');
  readonly hint = input<string | undefined>(undefined);
}
