import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ActionRegistry, type ActionContext } from '@maverick/agentic-ui';

interface Row {
  documentId: string;
  responsive: number;
  privileged: number;
  hot: number;
  rationale: string;
}

/**
 * Generative-UI widget for TAR classifier output. Three score bars
 * per row (responsive / privileged / hot) plus the rationale.
 * Click a row to navigate to the document detail.
 */
@Component({
  selector: 'app-tar-scores',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="badge">TAR</span>
        <strong>{{ topic() }}</strong>
        <span class="meta">{{ scored() }} scored · threshold ≥ {{ threshold() }}</span>
      </header>
      <table>
        <thead>
          <tr>
            <th class="id">Document</th>
            <th class="score">Responsive</th>
            <th class="score">Privileged</th>
            <th class="score">Hot</th>
            <th>Rationale</th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.documentId) {
            <tr (click)="open(r.documentId)" tabindex="0" role="button"
                (keydown.enter)="open(r.documentId)">
              <td class="id"><code>{{ r.documentId }}</code></td>
              <td class="score">
                <span class="bar"><span class="fill" [class.high]="r.responsive >= 0.7" [style.width.%]="r.responsive * 100"></span></span>
                <span class="num">{{ pct(r.responsive) }}</span>
              </td>
              <td class="score">
                <span class="bar priv"><span class="fill" [class.high]="r.privileged >= 0.5" [style.width.%]="r.privileged * 100"></span></span>
                <span class="num">{{ pct(r.privileged) }}</span>
              </td>
              <td class="score">
                <span class="bar hot"><span class="fill" [class.high]="r.hot >= 0.6" [style.width.%]="r.hot * 100"></span></span>
                <span class="num">{{ pct(r.hot) }}</span>
              </td>
              <td><em>{{ r.rationale }}</em></td>
            </tr>
          }
        </tbody>
      </table>
    </article>
  `,
  styles: `
    .card { padding: 0.7rem 0.9rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.86rem system-ui; border-left: 4px solid #0284c7; }
    header { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; background: #dbeafe; color: #1e40af; text-transform: uppercase; letter-spacing: 0.04em; }
    .meta { margin-left: auto; color: #64748b; font-size: 0.78em; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82em; }
    th, td { padding: 0.4rem 0.5rem; text-align: left; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    th { font-size: 0.65em; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 500; }
    th.id, td.id { width: 30%; }
    th.score, td.score { width: 16%; }
    tbody tr { cursor: pointer; transition: background 120ms; }
    tbody tr:hover td { background: #eef2ff; }
    code { font-family: ui-monospace, monospace; font-size: 0.92em; }
    em { color: #64748b; font-size: 0.92em; font-style: italic; }
    td.score { display: grid; grid-template-columns: 1fr auto; gap: 0.3rem; align-items: center; }
    .bar { height: 5px; background: #e2e8f0; border-radius: 999px; overflow: hidden; min-width: 60px; }
    .bar.priv .fill { background: linear-gradient(90deg, #dc2626, #f87171); }
    .bar.hot .fill { background: linear-gradient(90deg, #d97706, #fbbf24); }
    .fill { display: block; height: 100%; background: linear-gradient(90deg, #059669, #34d399); border-radius: 999px; transition: width 200ms; }
    .num { font-size: 0.95em; font-variant-numeric: tabular-nums; min-width: 30px; text-align: right; color: #475569; }
    .fill.high { box-shadow: 0 0 0 1px currentColor; }
  `,
})
export class TarScoresComponent {
  readonly topic = input.required<string>();
  readonly threshold = input.required<number>();
  readonly scored = input.required<number>();
  readonly rows = input.required<readonly Row[]>();

  private readonly actions = inject(ActionRegistry);

  protected pct(score: number): string {
    return (score * 100).toFixed(0) + '%';
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
