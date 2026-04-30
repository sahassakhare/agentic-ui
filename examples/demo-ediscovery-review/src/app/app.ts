import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { listDocuments } from '@maverick/demo-ediscovery-shared';

import { environment } from '../environments/environment';
import { searchDocumentsTool } from './tools/search-documents.tool';
import { tagDocumentTool } from './tools/tag-document.tool';
import { markPrivilegedTool } from './tools/mark-privileged.tool';
import { DocumentPreviewComponent } from './widgets/document-preview.component';

/**
 * Standalone domain UI for `demo-ediscovery-review`. Visiting :4302
 * directly proves the remote is a complete review surface, not just a
 * federation shim — it lets a paralegal browse the matter's documents
 * and exercise the same `searchDocumentsTool`, `tagDocumentTool`, and
 * `markPrivilegedTool` handlers the agent calls through the host.
 *
 * The widget below (`<app-document-preview>`) is the *exact* component
 * the host's chat shell renders via the `documentPreview` widget — one
 * domain artefact, two surfaces.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterOutlet, DocumentPreviewComponent],
  template: `
    <main>
      <header>
        <h1>demo-ediscovery-review</h1>
        <p class="subtle">
          Review remote — contributes <code>searchDocumentsTool</code>, <code>tagDocumentTool</code>,
          <code>markPrivilegedTool</code>, <code>addToPrivilegeLogTool</code> and three widgets
          (<code>documentPreview</code>, <code>tagPanel</code>, <code>reviewProgress</code>) to the
          host shell at <a href="http://localhost:4300">localhost:4300</a> via Native Federation.
        </p>
      </header>

      <section class="panel">
        <header class="panel-header">
          <h2>Search</h2>
          <p class="muted">Same handler the agent calls — exercised via the form below.</p>
        </header>
        <form (ngSubmit)="search()" class="form">
          <input name="q" [(ngModel)]="query" placeholder="e.g. project phoenix" />
          <button type="submit" [disabled]="busy()">{{ busy() ? 'Searching…' : 'Search' }}</button>
          <button type="button" (click)="reset()" class="secondary">Reset</button>
        </form>

        @if (status(); as s) { <p class="status">{{ s }}</p> }

        @if (results().length === 0) {
          <p class="muted">No results yet — type a query (or empty for "all") and click Search.</p>
        } @else {
          @for (d of results(); track d.documentId) {
            <app-document-preview
              [documentId]="d.documentId"
              [fileName]="d.fileName"
              [custodianId]="d.custodianId"
              [authoredBy]="d.authoredBy"
              [authoredAt]="d.authoredAt"
              [contentSnippet]="d.contentSnippet"
              [tags]="d.tags"
              [privilegeReason]="d.privilegeReason"
            />
            <div class="actions">
              <button (click)="tag(d.documentId, 'responsive')" class="ghost">+ responsive</button>
              <button (click)="tag(d.documentId, 'hot')" class="ghost">+ hot</button>
              <button (click)="markPriv(d.documentId)" class="ghost danger">mark privileged</button>
            </div>
          }
        }
      </section>

      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: block; max-width: 880px; margin: 0 auto; padding: 1.5rem 1.2rem; }
    h1 { font-size: 1.4rem; margin: 0 0 0.4rem; }
    h2 { font-size: 1rem; margin: 0; color: #1e293b; }
    .subtle { color: #475569; font-size: 0.88rem; line-height: 1.5; margin: 0 0 1rem; }
    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 1rem; }
    .panel-header { margin-bottom: 0.6rem; }
    .panel-header .muted { font-size: 0.82rem; margin: 0.2rem 0 0; }
    .muted { color: #64748b; }
    .form { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; }
    .form input { flex: 1; padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 4px; font: inherit; }
    .form input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
    button { padding: 0.45rem 0.9rem; background: #6366f1; color: #fff; border: none; border-radius: 4px; font: inherit; cursor: pointer; }
    button:hover:not(:disabled) { background: #4f46e5; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    button.secondary { background: #f1f5f9; color: #334155; }
    button.secondary:hover { background: #e2e8f0; }
    button.ghost { background: transparent; color: #475569; border: 1px solid #cbd5e1; padding: 3px 10px; font-size: 0.78rem; }
    button.ghost:hover { background: #f1f5f9; }
    button.ghost.danger { color: #b91c1c; border-color: #fecaca; }
    button.ghost.danger:hover { background: #fee2e2; }
    .status { color: #475569; font-size: 0.85rem; margin: 0.6rem 0; }
    .actions { display: flex; gap: 0.35rem; flex-wrap: wrap; padding: 0.4rem 0 0.6rem; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 0.88em; }
    a { color: #6366f1; }
  `,
})
export class App {
  protected readonly query = signal('');
  protected readonly busy = signal(false);
  protected readonly status = signal<string | null>(null);

  protected readonly raw = signal<readonly { id: string }[]>([]);
  protected readonly results = computed(() => {
    const ids = new Set(this.raw().map((r) => r.id));
    return listDocuments(environment.matterId)
      .filter((d) => ids.has(d.id))
      .map((d) => ({
        documentId: d.id,
        fileName: d.fileName,
        custodianId: d.custodianId,
        authoredBy: d.authoredBy ?? '—',
        authoredAt: d.authoredAt ?? '—',
        contentSnippet: d.contentSnippet,
        tags: [...d.tags] as string[],
        privilegeReason: (d.privilegeReason ?? null) as string | null,
      }));
  });

  protected async search(): Promise<void> {
    this.busy.set(true);
    this.status.set(null);
    try {
      const out = await searchDocumentsTool.handler(
        { query: this.query(), limit: 10 },
        standaloneCtx(),
      );
      this.raw.set((out as { documents: { id: string }[] }).documents);
      this.status.set(`Returned ${(out as { count: number }).count} document(s).`);
    } catch (err) {
      this.status.set('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.busy.set(false);
    }
  }

  protected reset(): void {
    this.query.set('');
    this.raw.set([]);
    this.status.set(null);
  }

  protected async tag(documentId: string, tag: string): Promise<void> {
    await tagDocumentTool.handler(
      { documentId, tags: [tag as 'responsive'], operation: 'add' },
      standaloneCtx(),
    );
    this.status.set(`Tagged ${documentId} as ${tag}.`);
    this.raw.update((r) => [...r]);  // force recompute
  }

  protected async markPriv(documentId: string): Promise<void> {
    await markPrivilegedTool.handler(
      { documentId, reason: 'attorney-client', note: 'Standalone-UI quick mark' },
      standaloneCtx(),
    );
    this.status.set(`Marked ${documentId} attorney-client privileged.`);
    this.raw.update((r) => [...r]);
  }
}

function standaloneCtx() {
  const id = `standalone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    threadId: 'standalone',
    runId: id,
    toolCallId: id,
    signal: new AbortController().signal,
  };
}
