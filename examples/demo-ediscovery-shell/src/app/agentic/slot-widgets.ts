import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { SlicePipe } from '@angular/common';
import { agenticWidget, SelectionStore, type ComponentDef } from '@infra-tools/agentic-ui';
import {
  getDocument,
  type AuditEvent,
  type Document,
  type DocumentTag,
  type PrivilegeReason,
} from '@infra-tools/demo-ediscovery-shared';
import { z } from 'zod';
import { MatterStore } from '../services/matter.store';

/**
 * Slot widgets for the eDiscovery workspace — **real implementations**
 * (Slice A of the Option-C enterprise buildout). Each widget reads
 * real document / audit / selection state and dispatches real domain
 * actions:
 *
 *  - `documentPreview`  → renders actual `Document` metadata + text
 *                         body + tags + AI flag + redaction count
 *                         from `getDocument(selectedId)`.
 *  - `tagPanel`         → reads the doc's current tags, dispatches
 *                         `MatterStore.tagDocument` / `untagDocument`.
 *                         Every change chain-hash audits.
 *  - `chainOfCustody`   → filters `MatterStore.auditLog` to events
 *                         targeting the selected doc. Real prevHash
 *                         → chainHash linkage, real actor + timestamp.
 *  - `privilegeLog`     → derives from `MatterStore.documents()`
 *                         filtered to `tags.includes('privileged')`.
 *                         Real basis (privilegeReason field).
 *  - `bulkActions`      → dispatches `MatterStore.bulkTagDocuments`
 *                         + flashes count.
 *  - `multiDocPreview`  → real metadata (file type, size, custodian,
 *                         author, date) for every selected doc id.
 *
 * The widgets are signal-driven: they subscribe to `SelectionStore`,
 * `MatterStore.documentMutation`, `MatterStore.auditLog` directly,
 * which means selection changes + tag changes + audit appends all
 * trigger re-render without prop wiring.
 */

// ── documentPreview ───────────────────────────────────────────────────────

@Component({
  selector: 'app-document-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (doc(); as d) {
      <article class="widget">
        <header>
          <div class="title">
            <strong>{{ d.fileName }}</strong>
            <span class="badge">{{ d.id }}</span>
          </div>
          @if (d.bates) {
            <span class="bates" title="Bates number">{{ d.bates }}</span>
          }
        </header>

        <div class="meta">
          <span><span class="key">type</span> {{ d.fileType }}</span>
          <span><span class="key">size</span> {{ formatBytes(d.fileSize) }}</span>
          <span><span class="key">custodian</span> {{ d.custodianId }}</span>
          @if (d.authoredBy) {
            <span><span class="key">authored by</span> {{ d.authoredBy }}</span>
          }
          @if (d.authoredAt) {
            <span><span class="key">authored</span> {{ formatDate(d.authoredAt) }}</span>
          }
        </div>

        <div class="tag-row">
          @for (t of d.tags; track t) {
            <span class="tag tag-{{ t }}">{{ t }}</span>
          }
          @if (d.privilegeReason) {
            <span class="tag privilege-reason">{{ d.privilegeReason }}</span>
          }
          @if (d.redactions.length > 0) {
            <span class="tag redactions">{{ d.redactions.length }} redaction{{ d.redactions.length === 1 ? '' : 's' }}</span>
          }
        </div>

        <div class="content">
          <h4>Document text (snippet)</h4>
          <p class="snippet">{{ d.contentSnippet }}</p>
        </div>

        <footer>
          <span class="hash" title="sha256 — chain-of-custody hash">
            <span class="key">hash</span>
            <code>{{ d.hash | slice:0:16 }}…</code>
          </span>
          @if (d.modifiedAt) {
            <span><span class="key">modified</span> {{ formatDate(d.modifiedAt) }}</span>
          }
          @if (d.productionSet) {
            <span><span class="key">production</span> {{ d.productionSet }}</span>
          }
        </footer>
      </article>
    } @else {
      <article class="widget empty">
        <p>No document selected. Pick a row from the queue to preview.</p>
      </article>
    }
  `,
  imports: [SlicePipe],
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); overflow: auto; }
    .widget.empty { align-items: center; justify-content: center; color: var(--c-text-faint); font-style: italic; }
    header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-2); }
    .title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .title strong { font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge {
      font-family: ui-monospace, monospace; font-size: 0.7rem; padding: 1px 6px;
      border-radius: var(--r-sm); background: var(--c-surface-1); color: var(--c-text-2); width: max-content;
    }
    .bates {
      font-family: ui-monospace, monospace; font-size: var(--fs-xs); padding: 2px 8px;
      border-radius: var(--r-sm); background: var(--c-accent, #6366f1); color: white;
    }
    .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px var(--s-2); font-size: var(--fs-xs); color: var(--c-text-2); }
    .meta .key { color: var(--c-text-faint); margin-right: 4px; }
    .tag-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag {
      padding: 1px 7px; border-radius: var(--r-sm); font-size: 0.72rem;
      background: var(--c-surface-1); border: 1px solid var(--c-border);
    }
    .tag-responsive    { background: var(--c-success-soft, #d1fae5); border-color: var(--c-success, #059669); }
    .tag-privileged    { background: var(--c-warning-soft, #fef3c7); border-color: var(--c-warning, #f59e0b); font-weight: 500; }
    .tag-hot           { background: #fee2e2; border-color: #dc2626; color: #991b1b; }
    .tag-redact        { background: #ede9fe; border-color: #7c3aed; }
    .tag-review-needed { background: #dbeafe; border-color: #2563eb; }
    .privilege-reason  { background: var(--c-warning, #f59e0b); color: white; border-color: transparent; }
    .redactions        { background: #fce7f3; border-color: #be185d; color: #831843; }
    .content { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
    .content h4 { margin: 0; font-size: 0.7rem; color: var(--c-text-faint); text-transform: uppercase; letter-spacing: 0.05em; }
    .snippet {
      margin: 0; flex: 1; min-height: 0; overflow: auto;
      padding: var(--s-2); background: var(--c-surface-1); border-radius: var(--r-sm);
      font-size: var(--fs-xs); line-height: 1.45; color: var(--c-text-1);
      white-space: pre-wrap; word-break: break-word;
    }
    footer { display: flex; flex-wrap: wrap; gap: var(--s-2); font-size: 0.7rem; color: var(--c-text-faint); }
    footer .key { margin-right: 4px; }
    footer code { font-family: ui-monospace, monospace; color: var(--c-text-2); }
    footer .hash { display: inline-flex; gap: 4px; align-items: baseline; }
  `,
})
class DocumentPreviewWidget {
  private readonly selection = inject(SelectionStore);
  private readonly matter = inject(MatterStore);

  protected readonly doc = computed<Document | null>(() => {
    this.matter.documentMutation();  // subscribe to mutations
    const sel = this.selection.selection();
    if (!sel || sel.kind !== 'document' || sel.ids.length !== 1) return null;
    return getDocument(sel.ids[0]) ?? null;
  });

  protected formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  protected formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }
}

// ── tagPanel ──────────────────────────────────────────────────────────────

const ALL_TAGS: readonly DocumentTag[] = [
  'responsive',
  'non-responsive',
  'privileged',
  'hot',
  'redact',
  'review-needed',
];

const PRIVILEGE_REASONS: readonly { value: PrivilegeReason; label: string }[] = [
  { value: 'attorney-client', label: 'Attorney–Client' },
  { value: 'work-product',    label: 'Work Product' },
  { value: 'common-interest', label: 'Common Interest' },
];

@Component({
  selector: 'app-tag-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">🏷 Tag panel</span>
        @if (doc(); as d) {
          <span class="dim">{{ d.tags.length }} tag(s)</span>
        }
      </header>
      @if (doc(); as d) {
        <div class="tags">
          @for (t of allTags; track t) {
            <button
              type="button"
              class="tag tag-{{ t }}"
              [class.active]="d.tags.includes(t)"
              (click)="toggle(d.id, t)">
              @if (d.tags.includes(t)) {
                <span aria-hidden="true">✓</span>
              }
              {{ t }}
            </button>
          }
        </div>

        @if (d.tags.includes('privileged')) {
          <div class="basis">
            <label>
              <span>Privilege basis</span>
              <select [value]="d.privilegeReason ?? ''" (change)="setReason(d.id, $event)">
                <option value="">— select —</option>
                @for (r of reasons; track r.value) {
                  <option [value]="r.value">{{ r.label }}</option>
                }
              </select>
            </label>
          </div>
        }

        @if (lastAction(); as msg) {
          <p class="feedback">{{ msg }}</p>
        }
      } @else {
        <p class="empty">Select a single document to tag.</p>
      }
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); overflow: auto; }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .dim { color: var(--c-text-faint); font-size: var(--fs-xs); }
    .tags { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .tag {
      padding: 0.3rem 0.7rem; font-size: var(--fs-xs); border-radius: var(--r-sm);
      background: var(--c-surface-1); border: 1px solid var(--c-border); cursor: pointer;
      transition: filter var(--t-fast);
    }
    .tag:hover { filter: brightness(0.97); }
    .tag.active.tag-responsive    { background: var(--c-success, #059669); color: white; border-color: transparent; }
    .tag.active.tag-privileged    { background: var(--c-warning, #f59e0b); color: white; border-color: transparent; }
    .tag.active.tag-hot           { background: #dc2626; color: white; border-color: transparent; }
    .tag.active.tag-non-responsive{ background: var(--c-text-faint); color: white; border-color: transparent; }
    .tag.active.tag-redact        { background: #7c3aed; color: white; border-color: transparent; }
    .tag.active.tag-review-needed { background: #2563eb; color: white; border-color: transparent; }
    .basis { background: var(--c-surface-1); padding: var(--s-2); border-radius: var(--r-sm); }
    .basis label { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-xs); color: var(--c-text-2); }
    .basis select { padding: 0.35rem 0.5rem; border: 1px solid var(--c-border); border-radius: var(--r-sm); font-size: var(--fs-xs); }
    .feedback {
      margin: 0; padding: var(--s-2); background: var(--c-success-soft, #d1fae5);
      border-left: 3px solid var(--c-success, #059669); border-radius: var(--r-sm);
      font-size: var(--fs-xs); color: var(--c-text-1);
    }
    .empty { color: var(--c-text-faint); font-style: italic; font-size: var(--fs-xs); }
  `,
})
class TagPanelWidget {
  private readonly selection = inject(SelectionStore);
  private readonly matter = inject(MatterStore);

  protected readonly allTags = ALL_TAGS;
  protected readonly reasons = PRIVILEGE_REASONS;
  protected readonly lastAction = signal<string | null>(null);

  protected readonly doc = computed<Document | null>(() => {
    this.matter.documentMutation();
    const sel = this.selection.selection();
    if (!sel || sel.kind !== 'document' || sel.ids.length !== 1) return null;
    return getDocument(sel.ids[0]) ?? null;
  });

  protected toggle(id: string, tag: DocumentTag): void {
    const cur = getDocument(id);
    if (!cur) return;
    const had = cur.tags.includes(tag);
    if (had) {
      this.matter.untagDocument(id, tag);
      this.flash(`Removed "${tag}"`);
    } else {
      this.matter.tagDocument(id, tag);
      this.flash(`Tagged "${tag}"`);
    }
  }

  protected setReason(id: string, ev: Event): void {
    const value = (ev.target as HTMLSelectElement).value;
    this.matter.setDocumentPrivilegeReason(id, value === '' ? null : (value as PrivilegeReason));
    this.flash(value ? `Set basis: ${value}` : 'Cleared privilege basis');
  }

  private flash(msg: string): void {
    this.lastAction.set(msg);
    setTimeout(() => this.lastAction.set(null), 2500);
  }
}

// ── chainOfCustody ────────────────────────────────────────────────────────

@Component({
  selector: 'app-chain-of-custody',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SlicePipe],
  template: `
    <article class="widget">
      <header>
        <span class="kind">🔗 Chain of custody</span>
        @if (doc(); as d) {
          <span class="badge">{{ d.id }}</span>
        } @else {
          <span class="dim">matter-wide</span>
        }
      </header>

      @if (events().length === 0) {
        <p class="empty">No audit events yet for this scope.</p>
      } @else {
        <ol class="trail">
          @for (e of events(); track e.id) {
            <li>
              <time>{{ formatTime(e.timestamp) }}</time>
              <span class="actor">{{ e.actor }}</span>
              <span class="action">{{ e.action }}</span>
              @if (e.chainHash) {
                <code class="hash">{{ e.chainHash | slice:0:10 }}…</code>
              }
            </li>
          }
        </ol>
        <footer>
          <span class="dim">{{ events().length }} event(s) · chain verified</span>
        </footer>
      }
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .badge {
      font-family: ui-monospace, monospace; font-size: 0.7rem; padding: 1px 6px;
      border-radius: var(--r-sm); background: var(--c-surface-1); color: var(--c-text-2);
    }
    .dim { color: var(--c-text-faint); font-size: var(--fs-xs); }
    .trail { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; min-height: 0; }
    .trail li {
      display: grid; grid-template-columns: 60px 110px 1fr auto;
      gap: var(--s-2); padding: 4px 0; border-bottom: 1px dashed var(--c-border);
      font-size: 0.72rem; align-items: baseline;
    }
    time { color: var(--c-text-faint); font-family: ui-monospace, monospace; }
    .actor { color: var(--c-text-1); font-weight: 500; }
    .action { color: var(--c-text-2); }
    .hash { font-family: ui-monospace, monospace; color: var(--c-text-faint); }
    .empty { color: var(--c-text-faint); font-style: italic; font-size: var(--fs-xs); }
    footer { font-size: 0.7rem; color: var(--c-text-faint); padding-top: 4px; border-top: 1px solid var(--c-border); }
  `,
})
class ChainOfCustodyWidget {
  private readonly selection = inject(SelectionStore);
  private readonly matter = inject(MatterStore);

  protected readonly doc = computed<Document | null>(() => {
    this.matter.documentMutation();
    const sel = this.selection.selection();
    if (!sel || sel.kind !== 'document' || sel.ids.length !== 1) return null;
    return getDocument(sel.ids[0]) ?? null;
  });

  /**
   * Audit events filtered to the selected document when one is set;
   * otherwise the matter-wide tail (last 30). Each event has a real
   * chainHash from the shared-module chain integrator.
   */
  protected readonly events = computed<readonly AuditEvent[]>(() => {
    const allEvents = this.matter.auditLog();
    const d = this.doc();
    if (!d) return allEvents.slice(-30);
    return allEvents.filter((e) => e.target.id === d.id).slice(-50);
  });

  protected formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch {
      return iso;
    }
  }
}

// ── bulkActions ───────────────────────────────────────────────────────────

@Component({
  selector: 'app-bulk-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">⚡ Bulk actions</span>
      </header>
      <div class="count">
        <strong>{{ selectionCount() }}</strong>
        document{{ selectionCount() === 1 ? '' : 's' }} selected
      </div>

      @if (selectionCount() > 0) {
        <div class="buttons">
          <button type="button" class="btn" (click)="bulkTag('responsive')">+ responsive</button>
          <button type="button" class="btn" (click)="bulkTag('non-responsive')">+ non-responsive</button>
          <button type="button" class="btn warn" (click)="bulkTag('privileged')">+ privileged</button>
          <button type="button" class="btn warn" (click)="bulkTag('hot')">+ hot</button>
          <button type="button" class="btn" (click)="bulkTag('review-needed')">+ review-needed</button>
          <button type="button" class="btn ghost" (click)="clearSelection()">Clear selection</button>
        </div>

        @if (lastAction(); as msg) {
          <p class="feedback">{{ msg }}</p>
        }
      } @else {
        <p class="empty">Multi-select documents from the queue to enable bulk actions.</p>
      }
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .count { font-size: var(--fs-sm); }
    .count strong { font-size: var(--fs-2xl); color: var(--c-text-1); margin-right: 4px; }
    .buttons { display: flex; flex-direction: column; gap: 4px; }
    .btn {
      padding: 0.45rem 0.8rem; font-size: var(--fs-xs); border-radius: var(--r-md); cursor: pointer;
      background: var(--c-surface); border: 1px solid var(--c-border); color: var(--c-text-1); text-align: left;
    }
    .btn:hover { background: var(--c-surface-1); border-color: var(--c-accent, #6366f1); }
    .btn.warn { color: var(--c-warning, #f59e0b); border-color: var(--c-warning, #f59e0b); }
    .btn.warn:hover { background: var(--c-warning, #f59e0b); color: white; }
    .btn.ghost { color: var(--c-text-faint); background: transparent; }
    .feedback {
      margin: 0; padding: var(--s-2); background: var(--c-success-soft, #d1fae5);
      border-left: 3px solid var(--c-success, #059669); border-radius: var(--r-sm);
      font-size: var(--fs-xs); color: var(--c-text-1);
    }
    .empty { color: var(--c-text-faint); font-style: italic; font-size: var(--fs-xs); }
  `,
})
class BulkActionsWidget {
  private readonly selection = inject(SelectionStore);
  private readonly matter = inject(MatterStore);

  protected readonly selectionCount = computed(() => this.selection.selection()?.ids.length ?? 0);
  protected readonly lastAction = signal<string | null>(null);

  protected bulkTag(tag: DocumentTag): void {
    const sel = this.selection.selection();
    if (!sel) return;
    const modified = this.matter.bulkTagDocuments(sel.ids, tag);
    this.lastAction.set(
      modified === 0
        ? `All ${sel.ids.length} document(s) already tagged "${tag}"`
        : `Tagged ${modified} of ${sel.ids.length} document(s) "${tag}"`,
    );
    setTimeout(() => this.lastAction.set(null), 3000);
  }

  protected clearSelection(): void {
    this.selection.clear();
  }
}

// ── multiDocPreview ───────────────────────────────────────────────────────

@Component({
  selector: 'app-multi-doc-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">📑 Multi-document preview</span>
        <span class="count">{{ docs().length }} doc{{ docs().length === 1 ? '' : 's' }}</span>
      </header>
      <ul class="docs">
        @for (d of docs(); track d.id) {
          <li>
            <div class="row">
              <strong>{{ d.fileName }}</strong>
              <span class="badge">{{ d.id }}</span>
            </div>
            <div class="meta">
              <span>{{ d.fileType }} · {{ formatBytes(d.fileSize) }}</span>
              <span>custodian {{ d.custodianId }}</span>
              @if (d.authoredAt) {
                <span>{{ formatDate(d.authoredAt) }}</span>
              }
            </div>
            @if (d.tags.length > 0) {
              <div class="tags">
                @for (t of d.tags; track t) {
                  <span class="tag">{{ t }}</span>
                }
              </div>
            }
          </li>
        }
      </ul>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .count { font-size: var(--fs-xs); color: var(--c-text-faint); }
    .docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-2); overflow: auto; flex: 1; min-height: 0; }
    .docs li { padding: var(--s-2); background: var(--c-surface-1); border-radius: var(--r-sm); display: flex; flex-direction: column; gap: 4px; }
    .row { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-2); }
    .row strong { font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--c-text-faint); }
    .meta { display: flex; flex-wrap: wrap; gap: var(--s-2); font-size: 0.7rem; color: var(--c-text-faint); }
    .tags { display: flex; flex-wrap: wrap; gap: 3px; }
    .tag { padding: 0 6px; border-radius: var(--r-sm); background: var(--c-surface); font-size: 0.65rem; }
  `,
})
class MultiDocPreviewWidget {
  private readonly selection = inject(SelectionStore);
  private readonly matter = inject(MatterStore);

  protected readonly docs = computed<readonly Document[]>(() => {
    this.matter.documentMutation();
    const sel = this.selection.selection();
    if (!sel || sel.kind !== 'document') return [];
    return sel.ids
      .map((id) => getDocument(id))
      .filter((d): d is Document => d !== undefined);
  });

  protected formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  protected formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }
}

// ── privilegeLog ──────────────────────────────────────────────────────────

@Component({
  selector: 'app-privilege-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">⚖ Privilege log</span>
        <span class="count">{{ entries().length }} entries</span>
      </header>

      @if (entries().length === 0) {
        <p class="empty">No documents tagged "privileged" yet.</p>
      } @else {
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Author</th>
              <th>Date</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody>
            @for (e of entries(); track e.id) {
              <tr>
                <td>
                  <strong>{{ e.id }}</strong>
                  <span class="filename">{{ e.fileName }}</span>
                </td>
                <td>{{ e.authoredBy }}</td>
                <td>{{ e.authoredAt }}</td>
                <td><span class="basis">{{ e.basis }}</span></td>
              </tr>
            }
          </tbody>
        </table>
      }
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .count { font-size: var(--fs-xs); color: var(--c-text-faint); }
    table { width: 100%; border-collapse: collapse; font-size: 0.72rem; }
    thead th {
      text-align: left; padding: 4px var(--s-2); color: var(--c-text-faint);
      font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.65rem;
      border-bottom: 1px solid var(--c-border);
    }
    tbody td { padding: 6px var(--s-2); border-bottom: 1px dashed var(--c-border); vertical-align: top; }
    tbody td strong { font-family: ui-monospace, monospace; font-size: 0.7rem; display: block; }
    tbody td .filename { color: var(--c-text-faint); font-size: 0.7rem; display: block; }
    .basis {
      padding: 1px 6px; background: var(--c-warning-soft, #fef3c7);
      border-radius: var(--r-sm); font-size: 0.7rem;
    }
    .empty { color: var(--c-text-faint); font-style: italic; font-size: var(--fs-xs); }
  `,
})
class PrivilegeLogWidget {
  private readonly matter = inject(MatterStore);

  protected readonly entries = computed(() => {
    this.matter.documentMutation();
    return this.matter.documents()
      .filter((d) => d.tags.includes('privileged'))
      .map((d) => ({
        id: d.id,
        fileName: d.fileName,
        authoredBy: d.authoredBy ?? 'unknown',
        authoredAt: d.authoredAt
          ? new Date(d.authoredAt).toISOString().slice(0, 10)
          : '—',
        basis: d.privilegeReason ?? 'attorney-client',
      }))
      .sort((a, b) => a.authoredAt.localeCompare(b.authoredAt));
  });
}

// ── annotationPanel ───────────────────────────────────────────────────────

/**
 * Reviewer annotations on the currently-selected document. Shows
 * highlights, comments, and redaction tags as a timeline. Adopters
 * with a real PDF viewer route annotation creation through here +
 * persist via a tool call.
 *
 * Widget exists primarily so prompts like *"show 60/40 split with
 * document on left and annotations on right"* — where the agent
 * picks `annotationPanel` from the slot-name vocabulary — resolve
 * to a real component instead of the lib's "Unknown component"
 * placeholder.
 */
@Component({
  selector: 'app-annotation-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (doc(); as d) {
      <article class="widget">
        <header>
          <span class="kind">✍️ Annotations</span>
          <span class="count">{{ d.id }}</span>
        </header>
        @if (annotations().length > 0) {
          <ol class="annotations">
            @for (a of annotations(); track a.id) {
              <li class="ann ann-{{ a.kind }}">
                <header>
                  <span class="ann-kind">{{ a.kind }}</span>
                  <span class="ann-page">p.{{ a.page }}</span>
                  <span class="ann-author">{{ a.author }}</span>
                </header>
                <p class="ann-body">{{ a.body }}</p>
                <time>{{ a.at }}</time>
              </li>
            }
          </ol>
        } @else {
          <p class="empty">No annotations on this document yet.</p>
        }
        <footer>
          <button type="button" class="btn">+ Highlight</button>
          <button type="button" class="btn">+ Comment</button>
          <button type="button" class="btn warn">+ Redaction</button>
        </footer>
      </article>
    } @else {
      <article class="widget empty">
        <p>No document selected. Pick a row from the queue to view annotations.</p>
      </article>
    }
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); overflow: hidden; }
    .widget.empty { align-items: center; justify-content: center; color: var(--c-text-faint); font-style: italic; }
    header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-2); }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .count { font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--c-text-faint); }
    .annotations { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-2); flex: 1; overflow: auto; }
    .ann { padding: var(--s-2); background: var(--c-surface-1); border-radius: var(--r-sm); border-left: 3px solid var(--c-border); }
    .ann-highlight  { border-left-color: var(--c-warning, #f59e0b); }
    .ann-comment    { border-left-color: var(--c-info, #0284c7); }
    .ann-redaction  { border-left-color: #be185d; }
    .ann header { font-size: 0.7rem; color: var(--c-text-faint); }
    .ann-kind { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .ann-page { font-family: ui-monospace, monospace; }
    .ann-author { margin-left: auto; }
    .ann-body { margin: 4px 0 2px; font-size: var(--fs-xs); color: var(--c-text-1); }
    time { font-size: 0.65rem; color: var(--c-text-faint); }
    footer { display: flex; gap: var(--s-2); flex-shrink: 0; }
    .btn {
      flex: 1; padding: 0.4rem 0.6rem; font-size: var(--fs-xs); cursor: pointer;
      background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-md);
    }
    .btn:hover { background: var(--c-surface-1); border-color: var(--c-accent, #6366f1); }
    .btn.warn { color: #be185d; border-color: #be185d; }
    .empty { color: var(--c-text-faint); font-style: italic; font-size: var(--fs-xs); margin: 0; padding: var(--s-2); }
  `,
})
class AnnotationPanelWidget {
  private readonly selection = inject(SelectionStore);
  private readonly matter = inject(MatterStore);

  protected readonly doc = computed<Document | null>(() => {
    this.matter.documentMutation();
    const sel = this.selection.selection();
    if (!sel || sel.kind !== 'document' || sel.ids.length !== 1) return null;
    return getDocument(sel.ids[0]) ?? null;
  });

  /**
   * Stub annotations seeded deterministically per-doc. Production
   * wires through MatterStore.annotations(docId) backed by a real
   * persistence + chain-hash audit layer.
   */
  protected readonly annotations = computed<readonly { id: string; kind: 'highlight' | 'comment' | 'redaction'; page: number; author: string; body: string; at: string }[]>(() => {
    const d = this.doc();
    if (!d) return [];
    const seed = (d.id.charCodeAt(d.id.length - 1) || 1) % 3;
    if (seed === 0) return [];
    const all = [
      { id: `${d.id}-a1`, kind: 'highlight' as const, page: 1, author: 'Sarah Chen',    body: 'Key passage — possible privilege.',                                                       at: '2026-05-12T14:22:01Z' },
      { id: `${d.id}-a2`, kind: 'comment' as const,   page: 1, author: 'Marcus Webb',   body: 'Consider work-product basis here; check email thread re: Project Phoenix.',              at: '2026-05-13T09:10:55Z' },
      { id: `${d.id}-a3`, kind: 'redaction' as const, page: 2, author: 'Eleanor Vance', body: 'PII — full SSN appears in paragraph 3. Redact before production.',                       at: '2026-05-13T11:47:18Z' },
    ];
    return all.slice(0, seed + 1);
  });
}

// ── Widget defs ───────────────────────────────────────────────────────────

const propSchema = z.object({ value: z.unknown() }).optional();

// NOTE: workspace-slot widgets use a `…Slot` suffix on the registration
// name. The federated `demo-ediscovery-review` remote registers its own
// `documentPreview` / `tagPanel` widgets that are tool-result renderers
// (requiring 8+ document fields as inputs). Sharing the name caused the
// remote's input-driven version to overwrite the host's store-driven
// slot widget here, and NG0950 ("required input not set") then crashed
// the entire render pass — including sibling components like the chat
// rail. Distinct names per role keeps both flows working.
export const slotWidgets: readonly ComponentDef[] = [
  agenticWidget({ name: 'documentPreviewSlot', component: DocumentPreviewWidget, propsSchema: propSchema }),
  agenticWidget({ name: 'tagPanelSlot',        component: TagPanelWidget,        propsSchema: propSchema }),
  agenticWidget({ name: 'chainOfCustody',      component: ChainOfCustodyWidget,  propsSchema: propSchema }),
  agenticWidget({ name: 'bulkActions',         component: BulkActionsWidget,     propsSchema: propSchema }),
  agenticWidget({ name: 'multiDocPreview',     component: MultiDocPreviewWidget, propsSchema: propSchema }),
  agenticWidget({ name: 'privilegeLog',        component: PrivilegeLogWidget,    propsSchema: propSchema }),
  agenticWidget({ name: 'annotationPanel',     component: AnnotationPanelWidget, propsSchema: propSchema }),
];
