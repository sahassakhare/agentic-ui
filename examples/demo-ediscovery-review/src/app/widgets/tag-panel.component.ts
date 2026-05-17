import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Compact widget summarising the tag distribution returned by
 * search-style tools. Useful when the agent reports "I've reviewed
 * 12 docs — here's what I tagged."
 */
@Component({
  selector: 'app-tag-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="panel">
      <header>
        <span class="badge">tags</span>
        <strong>{{ title() }}</strong>
        <span class="count">{{ totalCount() }} doc(s)</span>
      </header>
      @if (counts().length === 0) {
        <p class="muted">No tags applied.</p>
      } @else {
        <ul>
          @for (entry of counts(); track entry.tag) {
            <li>
              <span class="tag" [class.tag-priv]="entry.tag === 'privileged'" [class.tag-hot]="entry.tag === 'hot'" [class.tag-resp]="entry.tag === 'responsive'">{{ entry.tag }}</span>
              <span class="bar" [style.--pct]="(entry.count / totalCount()) * 100 + '%'"></span>
              <span class="num">{{ entry.count }}</span>
            </li>
          }
        </ul>
      }
    </article>
  `,
  styles: `
    .panel { padding: 0.6rem 0.85rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.86rem system-ui; border-left: 4px solid #6366f1; }
    header { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; margin-bottom: 0.4rem; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; background: #e0e7ff; color: #3730a3; text-transform: uppercase; letter-spacing: 0.04em; }
    .count { margin-left: auto; color: #64748b; font-size: 0.78em; }
    .muted { color: #94a3b8; font-size: 0.85em; margin: 0.2rem 0 0; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
    li { display: grid; grid-template-columns: 7rem 1fr 2rem; gap: 0.5rem; align-items: center; }
    .tag { font-size: 0.75em; padding: 1px 7px; border-radius: 999px; background: #f1f5f9; color: #475569; text-align: center; }
    .tag-priv { background: #fee2e2; color: #991b1b; }
    .tag-hot { background: #fef3c7; color: #92400e; }
    .tag-resp { background: #d1fae5; color: #065f46; }
    .bar { display: block; height: 6px; background: #e2e8f0; border-radius: 999px; overflow: hidden; position: relative; }
    .bar::after { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: var(--pct, 0%); background: #6366f1; border-radius: 999px; }
    .num { font-variant-numeric: tabular-nums; font-size: 0.78em; color: #475569; text-align: right; }
  `,
})
export class TagPanelComponent {
  readonly title = input.required<string>();
  readonly totalCount = input.required<number>();
  readonly counts = input.required<readonly { tag: string; count: number }[]>();
}
