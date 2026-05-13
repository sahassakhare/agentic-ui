import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SmartCellComponent } from '@infra-tools/agentic-ui';
import {
  appendAudit,
  getCustodian,
  isoNow,
  listCustodians,
  listDocuments,
  nextAuditId,
  searchDocuments,
  updateDocument,
  type Document,
  type DocumentTag,
} from '@infra-tools/demo-ediscovery-shared';
import { environment } from '../../../environments/environment';
import { MatterStore } from '../../services/matter.store';
import { PersonaService } from '../../services/persona.service';
import { IconComponent } from '../../ui/icon.component';
import { TagChipComponent } from '../../ui/tag-chip.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { StatusBadgeComponent } from '../../ui/status-badge.component';

interface DocFilters {
  readonly q: string;
  readonly custodianId: string | null;
  readonly tag: string | null;
  readonly privilegeOnly: boolean;
}

const ALL_TAGS: readonly DocumentTag[] = ['responsive', 'non-responsive', 'privileged', 'hot', 'redact', 'review-needed'];

/**
 * Documents page. Three regions:
 *  - Filter rail (custodian / tag / privilege-only / free-text search)
 *  - Sortable table with multi-select for bulk ops
 *  - Slide-in detail drawer when a row is opened
 *
 * Uses the same `searchDocuments` helper the review-remote tool calls,
 * so the inline UX and the agent-driven UX sit on identical state.
 */
@Component({
  selector: 'app-documents',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, IconComponent, TagChipComponent, EmptyStateComponent, StatusBadgeComponent, SmartCellComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Review</p>
        <h1>Documents</h1>
        <p class="muted">
          {{ totalDocs() }} documents in matter {{ matterId }}.
          Filter by custodian, tag, or content. Open a row to inspect — or ask the coordinator to act in bulk.
        </p>
      </div>
      <div class="head-actions">
        <button type="button" class="ghost" (click)="resetFilters()">
          <svg-icon name="refresh" [size]="14" /> Reset filters
        </button>
        <span class="counter">{{ results().length }} / {{ totalDocs() }} shown</span>
      </div>
    </section>

    <section class="filters">
      <div class="search-row">
        <label class="search">
          <svg-icon name="search" [size]="15" />
          <input type="text" placeholder="Filename, snippet, or author"
                 [value]="filters().q"
                 (input)="patch({ q: $any($event.target).value })" />
          @if (filters().q) {
            <button type="button" (click)="patch({ q: '' })" class="clear" aria-label="Clear">
              <svg-icon name="close" [size]="13" />
            </button>
          }
        </label>
        <button type="button" class="chip" [class.on]="filters().privilegeOnly" (click)="patch({ privilegeOnly: !filters().privilegeOnly })">
          <svg-icon name="lock" [size]="13" /> Privileged only
        </button>
      </div>

      <div class="filter-row">
        <div class="filter-group">
          <span class="filter-label">Custodian</span>
          <div class="pills">
            <button type="button" class="chip" [class.on]="!filters().custodianId" (click)="patch({ custodianId: null })">All</button>
            @for (c of allCustodians; track c.id) {
              <button type="button" class="chip" [class.on]="filters().custodianId === c.id" (click)="patch({ custodianId: c.id })">
                <span class="avatar">{{ initials(c.name) }}</span>
                {{ c.name.split(' ')[0] }}
              </button>
            }
          </div>
        </div>

        <div class="filter-group">
          <span class="filter-label">Tag</span>
          <div class="pills">
            <button type="button" class="chip" [class.on]="!filters().tag" (click)="patch({ tag: null })">All</button>
            @for (t of allTags; track t) {
              <button type="button" class="chip-tag" [class.on]="filters().tag === t" (click)="patch({ tag: t })">
                <mvk-tag-chip [tag]="t" [showIcon]="false" />
              </button>
            }
          </div>
        </div>
      </div>

      @if (selected().length > 0) {
        <div class="bulk">
          <span><strong>{{ selected().length }}</strong> selected</span>
          <button type="button" (click)="bulkTag('responsive')">+ responsive</button>
          <button type="button" (click)="bulkTag('hot')">+ hot</button>
          <button type="button" class="warn" (click)="clearSelection()">Clear</button>
        </div>
      }
    </section>

    <section class="panel">
      @if (results().length === 0) {
        <mvk-empty-state title="No documents match" icon="search"
          message="Adjust your filters, or ask the review coordinator to broaden the search."
          hint="Find any documents about Project Phoenix from January" />
      } @else {
        <table>
          <thead>
            <tr>
              <th class="check">
                <input type="checkbox"
                       [checked]="allSelected()"
                       (change)="toggleAll($any($event.target).checked)" />
              </th>
              <th>Document</th>
              <th>Custodian</th>
              <th>Authored</th>
              <th class="num">Size</th>
              <th>AI flag</th>
              <th>Tags</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (d of results(); track d.id) {
              <tr [class.selected]="isSelected(d.id)" [class.privileged]="d.privilegeReason"
                  (click)="openRow(d.id)">
                <td class="check" (click)="$event.stopPropagation()">
                  <input type="checkbox"
                         [checked]="isSelected(d.id)"
                         (change)="toggleOne(d.id, $any($event.target).checked)" />
                </td>
                <td>
                  <div class="doc">
                    <span class="ext">.{{ ext(d.fileName) }}</span>
                    <div class="dmeta">
                      <strong>{{ d.fileName }}</strong>
                      <small>{{ snippetPreview(d.contentSnippet) }}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="cell-custodian">
                    <span class="avatar">{{ initials(custodianName(d.custodianId)) }}</span>
                    <span>{{ custodianName(d.custodianId) }}</span>
                  </div>
                </td>
                <td><span class="date">{{ shortDate(d.authoredAt) }}</span></td>
                <td class="num">{{ kb(d.fileSize) }}</td>
                <td class="ai-cell" (click)="$event.stopPropagation()">
                  <mvk-smart-cell
                    [value]="aiFlag(d)"
                    tool="markPrivileged" />
                </td>
                <td>
                  <div class="tags">
                    @if (d.tags.length === 0) { <span class="muted">—</span> }
                    @for (t of d.tags; track t) { <mvk-tag-chip [tag]="t" /> }
                    @if (d.privilegeReason) {
                      <mvk-status-badge tone="bad">{{ d.privilegeReason }}</mvk-status-badge>
                    }
                  </div>
                </td>
                <td><svg-icon name="chevron-right" [size]="14" /></td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    <!-- Slide-in drawer -->
    @if (openId(); as o) {
      @if (current(); as d) {
        <div class="drawer-scrim" (click)="close()"></div>
        <aside class="drawer">
          <header>
            <div>
              <code>{{ d.id }}</code>
              <h2>{{ d.fileName }}</h2>
            </div>
            <button type="button" class="icon-btn" (click)="close()" aria-label="Close">
              <svg-icon name="close" [size]="16" />
            </button>
          </header>

          <section class="block">
            <p class="b-title">Metadata</p>
            <dl>
              <dt>Custodian</dt>
              <dd>
                <div class="cell-custodian">
                  <span class="avatar">{{ initials(custodianName(d.custodianId)) }}</span>
                  <div>
                    <strong>{{ custodianName(d.custodianId) }}</strong>
                    <small>{{ d.custodianId }}</small>
                  </div>
                </div>
              </dd>
              <dt>Author</dt><dd>{{ d.authoredBy ?? '—' }}</dd>
              <dt>Authored</dt><dd>{{ longDate(d.authoredAt) }}</dd>
              <dt>File type</dt><dd><code>{{ d.fileType }}</code></dd>
              <dt>Size</dt><dd>{{ kb(d.fileSize) }} ({{ d.fileSize | number }} bytes)</dd>
              <dt>SHA-256</dt><dd><code>{{ d.hash }}</code></dd>
              @if (d.bates) { <dt>Bates</dt><dd><code>{{ d.bates }}</code></dd> }
            </dl>
          </section>

          <section class="block">
            <p class="b-title">Content snippet</p>
            <pre>{{ d.contentSnippet }}</pre>
          </section>

          <section class="block">
            <p class="b-title">Tags</p>
            <div class="tags">
              @if (d.tags.length === 0) { <span class="muted">No tags applied.</span> }
              @for (t of d.tags; track t) { <mvk-tag-chip [tag]="t" /> }
            </div>
            <div class="quick-actions">
              @for (t of allTags; track t) {
                <button type="button" class="ghost" (click)="addTag(d.id, t)" [disabled]="d.tags.includes(t)">
                  <svg-icon name="plus" [size]="11" /> {{ t }}
                </button>
              }
            </div>
          </section>

          @if (d.privilegeReason) {
            <section class="block flag">
              <p class="b-title"><svg-icon name="lock" [size]="13" /> Privilege flag</p>
              <p>This document is marked <strong>{{ d.privilegeReason }}</strong>. It will not be included in any production unless explicitly waived.</p>
            </section>
          }
        </aside>
      }
    }
  `,
  styles: `
    :host { display: block; max-width: 1280px; margin: 0 auto; }

    .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-4); margin-bottom: var(--s-5); }
    .crumb { margin: 0; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--c-brand); font-weight: 600; }
    h1 { margin: 0.2rem 0 0.3rem; font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -0.02em; }
    .muted { color: var(--c-text-mute); margin: 0; font-size: var(--fs-sm); max-width: 560px; }
    .head-actions { display: flex; align-items: center; gap: var(--s-3); }
    .counter { font-size: var(--fs-xs); color: var(--c-text-mute); font-variant-numeric: tabular-nums; }

    .ghost {
      display: inline-flex; align-items: center; gap: 0.3rem;
      padding: 5px 10px; background: transparent; border: 1px solid var(--c-border-strong);
      border-radius: var(--r-md); font-size: var(--fs-xs); color: var(--c-text-2);
      cursor: pointer; transition: background var(--t-fast);
    }
    .ghost:hover:not(:disabled) { background: var(--c-surface-2); }
    .ghost:disabled { opacity: 0.5; cursor: not-allowed; }

    .filters {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); padding: var(--s-4);
      margin-bottom: var(--s-4);
      display: grid; gap: var(--s-3);
    }
    .search-row { display: flex; align-items: center; gap: var(--s-3); }
    .search {
      flex: 1; display: inline-flex; align-items: center; gap: var(--s-2);
      padding: 0.4rem 0.7rem;
      background: var(--c-surface-1); border: 1px solid var(--c-border); border-radius: var(--r-md);
    }
    .search:focus-within { border-color: var(--c-brand); background: var(--c-surface-0); }
    .search input { flex: 1; border: 0; background: transparent; outline: none; font: inherit; color: var(--c-text); }
    .search .clear {
      width: 22px; height: 22px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 0; border-radius: var(--r-sm); cursor: pointer;
      color: var(--c-text-mute);
    }
    .search .clear:hover { background: var(--c-surface-2); }

    .filter-row { display: grid; gap: var(--s-2); }
    .filter-group { display: flex; align-items: center; gap: var(--s-3); }
    .filter-label {
      font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--c-text-faint); font-weight: 600; min-width: 70px;
    }
    .pills { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }

    .chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px;
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-pill); font-size: var(--fs-xs); color: var(--c-text-2);
      cursor: pointer; transition: all var(--t-fast);
    }
    .chip:hover { background: var(--c-surface-2); }
    .chip.on { background: var(--c-brand); border-color: var(--c-brand); color: white; }
    .chip .avatar {
      width: 18px; height: 18px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-2); color: var(--c-text-2);
      border-radius: var(--r-pill);
      font-size: 0.6rem; font-weight: 600;
    }
    .chip.on .avatar { background: rgba(255,255,255,0.25); color: white; }

    .chip-tag {
      padding: 2px;
      background: transparent; border: 1px solid transparent; border-radius: var(--r-pill);
      cursor: pointer; transition: all var(--t-fast);
    }
    .chip-tag:hover { background: var(--c-surface-2); }
    .chip-tag.on { background: var(--c-brand-tint); border-color: var(--c-brand-soft); }

    .bulk {
      display: flex; align-items: center; gap: var(--s-2);
      padding: var(--s-2) var(--s-3);
      background: var(--c-brand-tint); border-radius: var(--r-md);
      font-size: var(--fs-sm); color: var(--c-brand-strong);
    }
    .bulk strong { color: var(--c-text); }
    .bulk button {
      padding: 3px 9px;
      background: var(--c-surface-0); border: 1px solid var(--c-brand-soft);
      color: var(--c-brand-strong); border-radius: var(--r-sm);
      font-size: var(--fs-xs); cursor: pointer;
    }
    .bulk button:hover { background: var(--c-surface-1); }
    .bulk button.warn { background: transparent; border-color: transparent; color: var(--c-text-mute); }

    .panel {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); overflow: hidden;
      box-shadow: var(--sh-1);
    }
    table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    th, td { padding: 0.6rem 0.7rem; text-align: left; border-bottom: 1px solid var(--c-divider); }
    th {
      font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--c-text-mute); font-weight: 500;
      background: var(--c-surface-1); position: sticky; top: 0;
    }
    th.check, td.check { width: 36px; text-align: center; }
    tr { cursor: pointer; transition: background var(--t-fast); }
    tr:hover td { background: var(--c-surface-1); }
    tr.selected td { background: var(--c-brand-tint); }
    tr.privileged td:nth-child(2) { box-shadow: inset 3px 0 0 var(--c-bad); }
    tr:last-child td { border-bottom: 0; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

    .doc { display: flex; align-items: center; gap: var(--s-3); }
    .ext {
      width: 36px; padding: 4px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-2); color: var(--c-text-2);
      border-radius: var(--r-sm);
      font-family: ui-monospace, monospace; font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
    }
    .dmeta strong { display: block; color: var(--c-text); font-weight: 500; }
    .dmeta small { display: block; color: var(--c-text-mute); font-size: 0.7rem; max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .cell-custodian { display: inline-flex; align-items: center; gap: 0.4rem; }
    .avatar {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-2); color: var(--c-text-2);
      border-radius: var(--r-pill);
      font-size: 0.65rem; font-weight: 600;
    }

    .date { color: var(--c-text-2); }
    .tags { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }

    /* Drawer */
    .drawer-scrim {
      position: fixed; inset: 0; background: rgba(15,23,42,0.18); z-index: 50;
      animation: fade var(--t-med);
    }
    .drawer {
      position: fixed; right: 0; top: 0; bottom: 0;
      width: min(620px, calc(100vw - 80px));
      background: var(--c-surface-0);
      border-left: 1px solid var(--c-border);
      box-shadow: var(--sh-pop);
      overflow-y: auto;
      z-index: 51;
      animation: slide var(--t-med);
    }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slide { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    .drawer header {
      position: sticky; top: 0; z-index: 1;
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: var(--s-3);
      padding: var(--s-5);
      background: var(--c-surface-0); border-bottom: 1px solid var(--c-border);
    }
    .drawer header code { font-size: 0.7rem; color: var(--c-text-mute); }
    .drawer header h2 { margin: 4px 0 0; font-size: var(--fs-lg); font-weight: 600; word-break: break-all; }
    .icon-btn {
      width: 32px; height: 32px; padding: 0; background: transparent;
      border: 1px solid transparent; border-radius: var(--r-sm);
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--c-text-mute); cursor: pointer; flex-shrink: 0;
    }
    .icon-btn:hover { background: var(--c-surface-2); color: var(--c-text); }

    .block { padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--c-divider); }
    .block.flag { background: var(--c-bad-soft); }
    .b-title {
      margin: 0 0 var(--s-3);
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--c-text-faint); font-weight: 600;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .block dl { margin: 0; display: grid; grid-template-columns: 110px 1fr; gap: 0.5rem 1rem; font-size: var(--fs-sm); }
    .block dt { color: var(--c-text-mute); font-weight: 500; }
    .block dd { margin: 0; color: var(--c-text); }
    .block code { font-family: ui-monospace, monospace; font-size: 0.78rem; color: var(--c-text-2); background: var(--c-surface-1); padding: 2px 6px; border-radius: var(--r-sm); word-break: break-all; }
    .block pre {
      margin: 0; padding: var(--s-3);
      background: var(--c-surface-1); border-radius: var(--r-md);
      font: inherit; white-space: pre-wrap; word-break: break-word;
      color: var(--c-text-2); font-size: var(--fs-sm); line-height: 1.5;
    }
    .quick-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--s-3); }
    .quick-actions .ghost { font-size: 0.7rem; padding: 3px 8px; }
    .block .cell-custodian small { display: block; color: var(--c-text-mute); font-size: 0.7rem; }
    .block .cell-custodian strong { color: var(--c-text); }
    .block .avatar { width: 28px; height: 28px; font-size: 0.7rem; }

    .muted { color: var(--c-text-faint); }
  `,
})
export class DocumentsComponent {
  protected readonly matterId = environment.matterId;
  protected readonly allTags = ALL_TAGS;
  private readonly store = inject(MatterStore);
  private readonly persona = inject(PersonaService);

  protected readonly allCustodians = listCustodians(this.matterId);
  protected readonly totalDocs = computed(() => listDocuments(this.matterId).length + this.refresh() * 0);

  protected readonly filters = signal<DocFilters>({ q: '', custodianId: null, tag: null, privilegeOnly: false });
  protected readonly selected = signal<readonly string[]>([]);
  protected readonly openId = signal<string | null>(null);
  /** Bumps when we mutate so computed lists rerun (mock-data isn't a signal). */
  private readonly refresh = signal(0);

  /** Deep-link support: navigation actions push `?id=DOC-...`; this
      effect mirrors the param into `openId` so the drawer pops open. */
  private readonly route = inject(ActivatedRoute);
  private readonly idParam = toSignal(this.route.queryParamMap, { initialValue: null });
  private readonly _syncFromQuery = effect(() => {
    const id = this.idParam()?.get('id');
    if (id) this.openId.set(id);
  });

  protected readonly results = computed(() => {
    const f = this.filters();
    this.refresh();
    let docs = searchDocuments(
      this.matterId,
      f.q,
      { custodianIds: f.custodianId ? [f.custodianId] : undefined, tags: f.tag ? [f.tag] : undefined, limit: 200 },
    );
    if (f.privilegeOnly) docs = docs.filter((d) => Boolean(d.privilegeReason));
    return docs;
  });

  protected readonly current = computed<Document | undefined>(() => {
    const id = this.openId();
    if (!id) return undefined;
    this.refresh();
    return listDocuments(this.matterId).find((d) => d.id === id);
  });

  protected readonly allSelected = computed(() => {
    const r = this.results();
    if (r.length === 0) return false;
    const sel = new Set(this.selected());
    return r.every((d) => sel.has(d.id));
  });

  patch(p: Partial<DocFilters>): void { this.filters.update((f) => ({ ...f, ...p })); }
  resetFilters(): void { this.filters.set({ q: '', custodianId: null, tag: null, privilegeOnly: false }); }
  isSelected(id: string): boolean { return this.selected().includes(id); }
  toggleOne(id: string, on: boolean): void {
    this.selected.update((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  }
  toggleAll(on: boolean): void {
    this.selected.set(on ? this.results().map((d) => d.id) : []);
  }
  clearSelection(): void { this.selected.set([]); }

  openRow(id: string): void { this.openId.set(id); }
  close(): void { this.openId.set(null); }

  bulkTag(tag: DocumentTag): void {
    const ids = this.selected();
    if (ids.length === 0) return;
    for (const id of ids) this.applyTag(id, tag);
    this.refresh.update((n) => n + 1);
    this.clearSelection();
  }

  addTag(id: string, tag: DocumentTag): void {
    this.applyTag(id, tag);
    this.refresh.update((n) => n + 1);
  }

  /** Mutates mock-data + appends an audit entry. Keeps inline UX
      identical to the agent path so tools and clicks share the trail. */
  private applyTag(id: string, tag: DocumentTag): void {
    const docs = listDocuments(this.matterId);
    const doc = docs.find((d) => d.id === id);
    if (!doc) return;
    if (doc.tags.includes(tag)) return;
    const next = [...doc.tags, tag] as readonly DocumentTag[];
    updateDocument(id, { tags: next });
    appendAudit({
      id: nextAuditId(),
      matterId: this.matterId,
      timestamp: isoNow(),
      actor: `${this.persona.active()}@firm.example`,
      action: 'document.tag.added',
      target: { type: 'document', id },
      before: { tags: [...doc.tags] },
      after: { tags: next },
    });
  }

  custodianName(id: string): string {
    return getCustodian(id)?.name ?? id;
  }
  /**
   * Synthetic agent-classification flag shown in the `mvk-smart-cell`
   * "AI flag" column. In production this would be a row field populated
   * by a `markPrivileged` / `runTARClassifier` tool call; for the demo
   * we derive it from the row metadata so the surface lights up
   * without burning a chat turn per row.
   */
  aiFlag(d: Document): string {
    if (d.privilegeReason)        return 'PRIV';
    if (d.tags.includes('hot'))   return 'HOT';
    if (d.tags.includes('redact')) return 'REDACT';
    return '—';
  }
  initials(name: string): string {
    return (name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2) || '?').toUpperCase();
  }
  ext(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot === -1 ? 'file' : fileName.slice(dot + 1).toLowerCase();
  }
  kb(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1_048_576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1_048_576).toFixed(1) + ' MB';
  }
  snippetPreview(s: string): string {
    const clean = s.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.slice(0, 120) + (clean.length > 120 ? '…' : '');
  }
  shortDate(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  longDate(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
}
