import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ActionRegistry, type ActionContext } from '@maverick/agentic-ui';

interface Hit {
  documentId: string;
  fileName: string;
  custodianName: string;
  score: number;
  matched: readonly string[];
  tags: readonly string[];
}

/**
 * Generative-UI widget rendering a ranked search result panel. Each
 * row shows a similarity bar, the matching terms, and tag chips.
 * Click a row to dispatch `openDocument`.
 */
@Component({
  selector: 'app-search-result-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="badge">semantic search</span>
        <strong>{{ count() }} hit(s)</strong>
        <span class="q">"{{ query() }}"</span>
      </header>
      <ul>
        @for (h of hits(); track h.documentId) {
          <li (click)="open(h.documentId)" tabindex="0" role="button"
              (keydown.enter)="open(h.documentId)">
            <div class="row">
              <code>{{ h.documentId }}</code>
              <strong>{{ h.fileName }}</strong>
              <span class="cust">{{ h.custodianName }}</span>
            </div>
            <div class="score-row">
              <span class="bar"><span class="fill" [style.width.%]="h.score * 100"></span></span>
              <span class="num">{{ pct(h.score) }}%</span>
            </div>
            <div class="terms-row">
              @if (h.matched.length > 0) {
                <span class="lbl">Matched:</span>
                @for (m of h.matched; track m) { <span class="term">{{ m }}</span> }
              }
              @for (t of h.tags; track t) {
                <span class="tag" [attr.data-tone]="t">{{ t }}</span>
              }
            </div>
          </li>
        }
      </ul>
    </article>
  `,
  styles: `
    .card { padding: 0.7rem 0.9rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.86rem system-ui; border-left: 4px solid #0284c7; }
    header { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; background: #dbeafe; color: #1e40af; text-transform: uppercase; letter-spacing: 0.04em; }
    .q { color: #475569; font-style: italic; font-size: 0.88em; margin-left: auto; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
    li { padding: 0.5rem 0.6rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; transition: all 120ms ease-out; }
    li:hover { background: #eef2ff; border-color: #c7d2fe; }
    li:focus-visible { outline: 2px solid #0284c7; outline-offset: 2px; }
    .row { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; margin-bottom: 0.3rem; }
    .row code { font-family: ui-monospace, monospace; font-size: 0.8em; color: #64748b; }
    .row strong { color: #0f172a; font-weight: 500; }
    .row .cust { margin-left: auto; color: #64748b; font-size: 0.85em; }
    .score-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem; }
    .bar { flex: 1; height: 5px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
    .bar .fill { height: 100%; background: linear-gradient(90deg, #0284c7, #38bdf8); border-radius: 999px; }
    .num { font-size: 0.78em; color: #475569; font-variant-numeric: tabular-nums; min-width: 35px; text-align: right; }
    .terms-row { display: flex; gap: 0.3rem; flex-wrap: wrap; align-items: center; font-size: 0.76em; }
    .lbl { color: #94a3b8; font-weight: 500; }
    .term { padding: 1px 6px; background: #dbeafe; color: #1e40af; border-radius: 3px; font-family: ui-monospace, monospace; }
    .tag { padding: 1px 7px; border-radius: 999px; background: #f1f5f9; color: #475569; }
    .tag[data-tone="responsive"] { background: #d1fae5; color: #065f46; }
    .tag[data-tone="privileged"] { background: #fee2e2; color: #991b1b; }
    .tag[data-tone="hot"] { background: #fef3c7; color: #92400e; }
  `,
})
export class SearchResultPanelComponent {
  readonly query = input.required<string>();
  readonly count = input.required<number>();
  readonly hits = input.required<readonly Hit[]>();

  private readonly actions = inject(ActionRegistry);

  protected pct(score: number): string {
    return Math.round(score * 100).toString();
  }

  protected open(documentId: string): void {
    const action = this.actions.get('openDocument');
    if (!action) return;
    const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ctx: ActionContext = {
      threadId: 'widget', runId: id, actionId: id,
      signal: new AbortController().signal,
    };
    void action.effect({ documentId }, ctx);
  }
}
