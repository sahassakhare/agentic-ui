import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Inline-SVG icon set — no third-party icon library. Each glyph is a
 * Heroicons-derived 24×24 path, rendered via a `@switch` so Angular's
 * template compiler emits real SVG elements (we'd lose the SVG nodes
 * if we used `[innerHTML]` because the DOM sanitiser strips them).
 *
 * Add new glyphs by extending the `IconName` union and adding a `@case`
 * in the template. Stick to a 24-grid and `currentColor` strokes so
 * callers tint via `color:` on the parent.
 */
export type IconName =
  | 'dashboard' | 'documents' | 'users' | 'shield' | 'archive' | 'audit'
  | 'search' | 'bell' | 'chevron-down' | 'chevron-right' | 'check' | 'close'
  | 'lock' | 'flame' | 'tag' | 'eye' | 'plus' | 'filter' | 'sort'
  | 'refresh' | 'spark' | 'menu' | 'logout' | 'settings' | 'send' | 'sparkles'
  | 'message' | 'circle-check' | 'alert-triangle' | 'bolt' | 'chart-bar';

@Component({
  selector: 'svg-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" [attr.aria-label]="label() ?? null" [attr.role]="label() ? 'img' : 'presentation'">
      @switch (name()) {
        @case ('dashboard') { <rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/> }
        @case ('documents') { <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/> }
        @case ('users') { <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/> }
        @case ('shield') { <path d="M12 2 4 5v6c0 5.5 3.8 10.74 8 12 4.2-1.26 8-6.5 8-12V5z"/> }
        @case ('archive') { <rect x="3" y="3" width="18" height="5" rx="1.5"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/> }
        @case ('audit') { <path d="M9 11l3 3 8-8"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/> }
        @case ('search') { <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/> }
        @case ('bell') { <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/> }
        @case ('chevron-down') { <polyline points="6 9 12 15 18 9"/> }
        @case ('chevron-right') { <polyline points="9 6 15 12 9 18"/> }
        @case ('check') { <polyline points="20 6 9 17 4 12"/> }
        @case ('close') { <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/> }
        @case ('lock') { <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/> }
        @case ('flame') { <path d="M12 2c.5 1.5 1.5 2.5 2.5 3.5 2 2 3.5 4 3.5 7a6 6 0 1 1-12 0c0-1 .2-2 .5-3 0 1 .5 1.5 1.5 1.5s1.5-.5 1.5-1.5C9.5 8 9 6 9 4.5 9 3 10 2 12 2z"/> }
        @case ('tag') { <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/> }
        @case ('eye') { <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/> }
        @case ('plus') { <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/> }
        @case ('filter') { <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/> }
        @case ('sort') { <path d="M3 6h18"/><path d="M7 12h10"/><path d="M11 18h2"/> }
        @case ('refresh') { <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/> }
        @case ('spark') { <polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/> }
        @case ('menu') { <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/> }
        @case ('logout') { <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/> }
        @case ('settings') { <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a2 2 0 1 1 0 4l-.09.04A1.65 1.65 0 0 0 19.4 15z"/> }
        @case ('send') { <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/> }
        @case ('sparkles') { <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/> }
        @case ('message') { <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/> }
        @case ('circle-check') { <circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/> }
        @case ('alert-triangle') { <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/> }
        @case ('bolt') { <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/> }
        @case ('chart-bar') { <line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/> }
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; align-items: center; line-height: 0; flex-shrink: 0; }`,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number>(18);
  readonly label = input<string | undefined>(undefined);
}
