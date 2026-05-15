import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { agenticWidget, type ComponentDef } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { SelectionStore } from '@infra-tools/agentic-ui';
import { MatterStore } from '../services/matter.store';

/**
 * Slot widgets for the eDiscovery workspace. Each widget renders one
 * slot of the resolved layout — `documentPreview` in `primary`,
 * `tagPanel` in `sidebar`, `chainOfCustody` in `footer`, etc.
 *
 * These are PLACEHOLDERS for production widgets — they show the slot's
 * domain shape + the data binding (selection ids, matter id) so a real
 * adopter can see what each slot represents. Production would
 * substitute a PDF viewer, a real tag editor, a chain-of-custody
 * timeline component, etc.
 *
 * Each widget reads selection / matter context directly via signals,
 * which lets the resolver swap them into a slot without prop wiring.
 */

// ── documentPreview ───────────────────────────────────────────────────────

@Component({
  selector: 'app-document-preview-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">📄 Document preview</span>
        @if (selectedId(); as id) {
          <span class="badge">{{ id }}</span>
        }
      </header>
      @if (selectedId()) {
        <div class="body">
          <div class="page-stub">
            <p class="lorem">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua…</p>
            <p class="note">PDF preview placeholder — production would mount the redacted-PDF viewer with agent annotations layered over.</p>
            <div class="ai-flag">
              <span class="dot" aria-hidden="true">🟡</span>
              <span>AI flag: <strong>privilege candidate</strong> · 0.82 confidence</span>
            </div>
          </div>
        </div>
      } @else {
        <p class="empty">No document selected. Pick a row from the queue to preview.</p>
      }
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .badge { font-family: ui-monospace, monospace; font-size: var(--fs-xs); padding: 1px 6px; border-radius: var(--r-sm); background: var(--c-surface-1); }
    .body { flex: 1; overflow: auto; }
    .page-stub { background: var(--c-surface-1); padding: var(--s-3); border-radius: var(--r-md); }
    .lorem { margin: 0 0 var(--s-2); font-size: var(--fs-sm); color: var(--c-text-1); }
    .note { margin: 0 0 var(--s-3); font-size: var(--fs-xs); color: var(--c-text-faint); font-style: italic; }
    .ai-flag { display: flex; gap: var(--s-2); padding: var(--s-2); background: var(--c-warning-soft, #fef3c7); border-left: 3px solid var(--c-warning, #f59e0b); border-radius: var(--r-sm); font-size: var(--fs-xs); }
    .ai-flag .dot { font-size: 0.8rem; }
    .empty { color: var(--c-text-faint); font-size: var(--fs-xs); font-style: italic; margin: 0; }
  `,
})
class DocumentPreviewStub {
  private readonly selection = inject(SelectionStore);
  protected readonly selectedId = computed(() => {
    const sel = this.selection.selection();
    if (!sel || sel.kind !== 'document') return null;
    return sel.ids[0] ?? null;
  });
}

// ── tagPanel ──────────────────────────────────────────────────────────────

@Component({
  selector: 'app-tag-panel-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">🏷️ Tag panel</span>
      </header>
      <div class="tags">
        @for (t of suggestedTags; track t.name) {
          <button type="button" class="tag" [class.active]="t.active">
            @if (t.active) { <span aria-hidden="true">✓</span> } {{ t.name }}
          </button>
        }
      </div>
      <p class="note">Production would dispatch <code>tagDocuments</code> on click + audit-chain the action.</p>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .tags { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .tag {
      padding: 0.3rem 0.7rem; font-size: var(--fs-xs); border-radius: var(--r-sm);
      background: var(--c-surface-1); border: 1px solid var(--c-border); cursor: pointer;
    }
    .tag.active { background: var(--c-accent, #6366f1); color: white; border-color: transparent; }
    .tag:hover { filter: brightness(1.05); }
    .note { margin: auto 0 0; font-size: var(--fs-xs); color: var(--c-text-faint); font-style: italic; }
    code { font-family: ui-monospace, monospace; font-size: 0.9em; background: var(--c-surface-1); padding: 0 4px; border-radius: var(--r-sm); }
  `,
})
class TagPanelStub {
  protected readonly suggestedTags = [
    { name: 'responsive', active: true },
    { name: 'privileged', active: false },
    { name: 'work-product', active: false },
    { name: 'PII', active: false },
    { name: 'hot-doc', active: false },
    { name: 'duplicate', active: false },
  ];
}

// ── chainOfCustody ────────────────────────────────────────────────────────

@Component({
  selector: 'app-chain-of-custody-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">🔗 Chain of custody</span>
        @if (matterId(); as m) {
          <span class="badge">{{ m }}</span>
        }
      </header>
      <ol class="trail">
        @for (e of stubEvents; track e.hash) {
          <li>
            <time>{{ e.when }}</time>
            <span class="actor">{{ e.actor }}</span>
            <span class="action">{{ e.action }}</span>
            <code class="hash">{{ e.hash }}</code>
          </li>
        }
      </ol>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .badge { font-family: ui-monospace, monospace; font-size: var(--fs-xs); padding: 1px 6px; border-radius: var(--r-sm); background: var(--c-surface-1); }
    .trail { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; font-size: var(--fs-xs); }
    .trail li { display: grid; grid-template-columns: 70px 80px 1fr auto; gap: var(--s-2); align-items: baseline; }
    time { color: var(--c-text-faint); font-family: ui-monospace, monospace; }
    .actor { color: var(--c-text-1); font-weight: 500; }
    .action { color: var(--c-text-2); }
    .hash { font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--c-text-faint); }
  `,
})
class ChainOfCustodyStub {
  private readonly matter = inject(MatterStore);
  protected readonly matterId = computed(() => this.matter.matterId);
  protected readonly stubEvents = [
    { when: '09:31:02', actor: 'system',       action: 'document ingested',          hash: '0x4f2a' },
    { when: '09:47:18', actor: 'Sarah Chen',   action: 'tagged: responsive',         hash: '0x9b1c' },
    { when: '10:04:55', actor: 'TAR-CAL-3',    action: 'classified: high relevance', hash: '0x6e0d' },
    { when: '10:22:31', actor: 'Marcus Webb',  action: 'override: privilege review', hash: '0xa317' },
  ];
}

// ── bulkActions ───────────────────────────────────────────────────────────

@Component({
  selector: 'app-bulk-actions-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">⚡ Bulk actions</span>
      </header>
      <div class="count"><strong>{{ selectionCount() }}</strong> document{{ selectionCount() === 1 ? '' : 's' }} selected</div>
      <div class="buttons">
        <button type="button" class="btn">Tag all responsive</button>
        <button type="button" class="btn">Tag all privileged</button>
        <button type="button" class="btn warn">Apply rubric (TAR)</button>
        <button type="button" class="btn ghost">Clear selection</button>
      </div>
      <p class="note">Production routes through <code>bulkTagDocuments</code> + queues a long-running operation for ≥ 100 docs.</p>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .count { font-size: var(--fs-md); }
    .count strong { font-size: var(--fs-2xl); }
    .buttons { display: flex; flex-direction: column; gap: var(--s-2); }
    .btn {
      padding: 0.45rem 0.8rem; font-size: var(--fs-xs); border-radius: var(--r-md); cursor: pointer;
      background: var(--c-surface); border: 1px solid var(--c-border); color: var(--c-text-1); text-align: left;
    }
    .btn:hover { background: var(--c-surface-1); border-color: var(--c-accent, #6366f1); }
    .btn.warn { color: var(--c-warning, #f59e0b); border-color: var(--c-warning, #f59e0b); }
    .btn.ghost { color: var(--c-text-faint); background: transparent; }
    .note { margin: auto 0 0; font-size: var(--fs-xs); color: var(--c-text-faint); font-style: italic; }
    code { font-family: ui-monospace, monospace; font-size: 0.9em; background: var(--c-surface-1); padding: 0 4px; border-radius: var(--r-sm); }
  `,
})
class BulkActionsStub {
  private readonly selection = inject(SelectionStore);
  protected readonly selectionCount = computed(() => this.selection.selection()?.ids.length ?? 0);
}

// ── multiDocPreview ───────────────────────────────────────────────────────

@Component({
  selector: 'app-multi-doc-preview-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">📑 Multi-document preview</span>
        <span class="count">{{ ids().length }} doc(s)</span>
      </header>
      <ul class="docs">
        @for (id of ids(); track id) {
          <li>
            <span class="doc-id">{{ id }}</span>
            <span class="meta">~{{ stubPageCount() }} pages · responsive · last modified 2026-05-12</span>
          </li>
        }
      </ul>
      <p class="note">Production would render thumbnails + lazy-load each preview.</p>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .count { font-size: var(--fs-xs); color: var(--c-text-faint); }
    .docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-2); overflow: auto; flex: 1; }
    .docs li { padding: var(--s-2); background: var(--c-surface-1); border-radius: var(--r-sm); display: flex; flex-direction: column; gap: 2px; }
    .doc-id { font-family: ui-monospace, monospace; font-size: var(--fs-xs); }
    .meta { font-size: 0.7rem; color: var(--c-text-faint); }
    .note { margin: 0; font-size: var(--fs-xs); color: var(--c-text-faint); font-style: italic; }
  `,
})
class MultiDocPreviewStub {
  private readonly selection = inject(SelectionStore);
  protected readonly ids = computed(() => this.selection.selection()?.ids ?? []);
  protected stubPageCount(): number {
    return Math.floor(Math.random() * 40) + 4;
  }
}

// ── privilegeLog ──────────────────────────────────────────────────────────

@Component({
  selector: 'app-privilege-log-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="widget">
      <header>
        <span class="kind">⚖️ Privilege log</span>
        <span class="count">{{ entries.length }} entries</span>
      </header>
      <ol class="entries">
        @for (e of entries; track e.id) {
          <li>
            <span class="doc">{{ e.docId }}</span>
            <span class="basis">{{ e.basis }}</span>
            <span class="reviewer">{{ e.reviewer }}</span>
          </li>
        }
      </ol>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .widget { height: 100%; display: flex; flex-direction: column; gap: var(--s-2); }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .kind { font-size: var(--fs-xs); color: var(--c-text-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .count { font-size: var(--fs-xs); color: var(--c-text-faint); }
    .entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-xs); }
    .entries li { display: grid; grid-template-columns: 110px 1fr 110px; gap: var(--s-2); padding: 4px 0; border-bottom: 1px solid var(--c-border); }
    .doc { font-family: ui-monospace, monospace; }
    .basis { color: var(--c-text-2); }
    .reviewer { color: var(--c-text-faint); text-align: right; }
  `,
})
class PrivilegeLogStub {
  protected readonly entries = [
    { id: 'p1', docId: 'DOC-7891240', basis: 'work-product · TAR seed-set', reviewer: 'Marcus Webb' },
    { id: 'p2', docId: 'DOC-7891236', basis: 'attorney-client',             reviewer: 'Marcus Webb' },
    { id: 'p3', docId: 'DOC-7891251', basis: 'work-product',                reviewer: 'Eleanor Vance' },
  ];
}

// ── Widget defs ───────────────────────────────────────────────────────────

const propSchema = z.object({ value: z.unknown() }).optional();

export const slotWidgets: readonly ComponentDef[] = [
  agenticWidget({ name: 'documentPreview',   component: DocumentPreviewStub,  propsSchema: propSchema }),
  agenticWidget({ name: 'tagPanel',          component: TagPanelStub,         propsSchema: propSchema }),
  agenticWidget({ name: 'chainOfCustody',    component: ChainOfCustodyStub,   propsSchema: propSchema }),
  agenticWidget({ name: 'bulkActions',       component: BulkActionsStub,      propsSchema: propSchema }),
  agenticWidget({ name: 'multiDocPreview',   component: MultiDocPreviewStub,  propsSchema: propSchema }),
  agenticWidget({ name: 'privilegeLog',      component: PrivilegeLogStub,     propsSchema: propSchema }),
];
