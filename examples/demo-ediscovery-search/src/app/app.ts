import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { listCustodians } from '@infra-tools/demo-ediscovery-shared';

import { environment } from '../environments/environment';
import { semanticSearchTool } from './tools/semantic-search.tool';
import { runTARClassifierTool } from './tools/run-tar-classifier.tool';
import { SearchResultPanelComponent } from './widgets/search-result-panel.component';
import { TarScoresComponent } from './widgets/tar-scores.component';

/**
 * Standalone domain UI for `demo-ediscovery-search`. Visiting :4304
 * directly proves the capability is a complete search-and-classify
 * surface. Same handlers, same data source, same widgets the host
 * shell consumes via federation.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterOutlet, SearchResultPanelComponent, TarScoresComponent],
  template: `
    <main>
      <header>
        <h1>demo-ediscovery-search</h1>
        <p class="subtle">
          Search remote — contributes <code>semanticSearch</code>,
          <code>filterByDateRange</code>, <code>filterByCustodians</code>,
          <code>runTARClassifier</code> plus a <code>documentIndex</code>
          <code>DataSourceDef</code> to the host shell at
          <a href="http://localhost:4300">localhost:4300</a> via Native Federation.
        </p>
      </header>

      <section class="panel">
        <h2>Semantic search</h2>
        <form (ngSubmit)="search()" class="form">
          <input name="q" [(ngModel)]="query" placeholder="phoenix budget restatement" required>
          <button type="submit" [disabled]="busy()">Rank</button>
        </form>
        @if (hits().length > 0) {
          <app-search-result-panel
            [query]="lastQuery()"
            [count]="hits().length"
            [hits]="hits()"
          />
        } @else if (lastQuery()) {
          <p class="muted">No matches for "{{ lastQuery() }}".</p>
        }
      </section>

      <section class="panel">
        <h2>TAR classifier</h2>
        <form (ngSubmit)="tar()" class="form">
          <input name="topic" [(ngModel)]="topic" placeholder="Project Phoenix budget" required>
          <button type="submit" [disabled]="busy()">Classify</button>
        </form>
        @if (tarRows().length > 0) {
          <app-tar-scores
            [topic]="lastTopic()"
            [threshold]="threshold"
            [scored]="lastScored()"
            [rows]="tarRows()"
          />
        }
      </section>

      <details>
        <summary>Custodian directory ({{ allCustodians.length }})</summary>
        <ul>
          @for (c of allCustodians; track c.id) {
            <li><code>{{ c.id }}</code> — <strong>{{ c.name }}</strong> ({{ c.department }})</li>
          }
        </ul>
      </details>

      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: block; max-width: 880px; margin: 0 auto; padding: 1.5rem 1.2rem; }
    h1 { font-size: 1.4rem; margin: 0 0 0.4rem; }
    h2 { font-size: 1rem; margin: 0 0 0.5rem; color: #1e293b; }
    .subtle { color: #475569; font-size: 0.88rem; line-height: 1.5; margin: 0 0 1rem; }
    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem; }
    .form { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; }
    .form input { flex: 1; padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 4px; font: inherit; }
    .form input:focus { outline: 2px solid #0284c7; outline-offset: -1px; border-color: transparent; }
    button { padding: 0.45rem 0.9rem; background: #0284c7; color: #fff; border: 0; border-radius: 4px; font: inherit; cursor: pointer; }
    button:hover:not(:disabled) { background: #0369a1; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    .muted { color: #94a3b8; font-size: 0.9rem; margin: 0.5rem 0; font-style: italic; }
    details { margin-top: 0.6rem; font-size: 0.85rem; }
    summary { cursor: pointer; color: #0284c7; }
    details ul { list-style: none; margin: 0.4rem 0 0; padding: 0; display: grid; gap: 0.2rem; }
    details li { padding: 0.3rem 0.5rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.82rem; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 0.92em; }
    a { color: #0284c7; }
  `,
})
export class App {
  protected readonly query = signal('phoenix budget');
  protected readonly topic = signal('Project Phoenix');
  protected readonly threshold = 0.3;

  protected readonly busy = signal(false);
  protected readonly lastQuery = signal('');
  protected readonly lastTopic = signal('');
  protected readonly lastScored = signal(0);
  protected readonly hits = signal<readonly { documentId: string; fileName: string; custodianName: string; score: number; matched: readonly string[]; tags: readonly string[]; }[]>([]);
  protected readonly tarRows = signal<readonly { documentId: string; responsive: number; privileged: number; hot: number; rationale: string; }[]>([]);

  protected readonly allCustodians = listCustodians(environment.matterId);

  protected async search(): Promise<void> {
    this.busy.set(true);
    try {
      const out = await semanticSearchTool.handler({ query: this.query() }, standaloneCtx()) as {
        readonly components?: ReadonlyArray<{ name: string; props: Record<string, unknown> }>;
      };
      const panel = out.components?.find((c) => c.name === 'searchResultPanel');
      this.hits.set((panel?.props['hits'] as typeof this.hits extends () => infer R ? R : never) ?? []);
      this.lastQuery.set(this.query());
    } finally {
      this.busy.set(false);
    }
  }

  protected async tar(): Promise<void> {
    this.busy.set(true);
    try {
      const out = await runTARClassifierTool.handler(
        { topic: this.topic(), threshold: this.threshold },
        standaloneCtx(),
      ) as { readonly scored?: number; readonly components?: ReadonlyArray<{ name: string; props: Record<string, unknown> }> };
      const panel = out.components?.find((c) => c.name === 'tarScores');
      this.tarRows.set((panel?.props['rows'] as typeof this.tarRows extends () => infer R ? R : never) ?? []);
      this.lastTopic.set(this.topic());
      this.lastScored.set(out.scored ?? 0);
    } finally {
      this.busy.set(false);
    }
  }
}

function standaloneCtx() {
  const id = `standalone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    threadId: 'standalone',
    runId: id,
    toolCallId: id,
    signal: new AbortController().signal,
    // Capability F5 LRO surface — standalone path is synchronous.
    startOperation: () => `op-search-${Date.now()}`,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  };
}
