import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { IntentRegistry } from '../registries/intent-registry';
import type { IntentDef, IntentTarget } from '../types/registry-defs';

/**
 * One resolved toolbar button — `IntentDef` projection ready for render.
 * Carries `mapsTo` verbatim so the host's `(selected)` handler dispatches
 * by `kind` without a second registry lookup.
 */
export interface BulkActionResult {
  readonly intentId: string;
  readonly mapsTo: IntentTarget;
  readonly selection: readonly unknown[];
  readonly entity?: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * Predicate to additionally filter intents against the current
 * selection's state — *"only show generateCustodianSummary when the
 * selection is from a single custodian"*.
 *
 * Applied after `IntentRegistry.get()` (which already applies
 * `setScopePolicy` for persona scope). Defaults to allow-all.
 */
export type BulkIntentFilter = (
  intent: IntentDef,
  selection: readonly unknown[],
) => boolean;

/**
 * Materialising bulk-operations toolbar — Pillar 1 pattern 3 of
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Stays hidden while `selection.length === 0`. When the user selects
 * one or more rows, the toolbar slides in with a row of action buttons
 * the agent considers applicable for *this specific selection*.
 *
 * The button set comes from a three-stage filter chain, all AND-ed:
 *
 * 1. **Allow-list.** `[intents]=['bulkTagPrivileged', 'sendToReviewQueue',
 *    'runRedactionProposal']` — only these are even considered.
 * 2. **Persona scope.** `IntentRegistry.get()` returns undefined when
 *    `setScopePolicy` denies the entry. Junior reviewer's
 *    `bulkRelease` is filtered automatically; same scope policy as the
 *    chat-shell tool list.
 * 3. **Selection state.** `[filter]=(intent, selection) => boolean` —
 *    *"only show generateCustodianSummary when the selection is from a
 *    single custodian"*. Returning `false` hides that intent for this
 *    selection only.
 *
 * Dispatch is host-driven (same as `<mvk-row-action-menu>` and
 * `<mvk-cmd-k-palette>`). The component emits a typed `BulkActionResult`
 * with intentId + mapsTo + the full selection — the host switches on
 * `mapsTo.kind` to dispatch.
 *
 * @example
 * ```html
 * <mvk-bulk-toolbar
 *   [selection]="selectedDocuments()"
 *   [intents]="['bulkTagPrivileged', 'sendToReviewQueue', 'runRedactionProposal', 'generateCustodianSummary']"
 *   entity="document"
 *   [filter]="bulkFilter"
 *   (selected)="onBulkAction($event)" />
 * ```
 *
 * @example
 * ```ts
 * bulkFilter: BulkIntentFilter = (intent, selection) => {
 *   if (intent.id === 'generateCustodianSummary') {
 *     const docs = selection as Document[];
 *     const custodians = new Set(docs.map(d => d.custodianId));
 *     return custodians.size === 1;
 *   }
 *   return true;
 * };
 * ```
 */
@Component({
  selector: 'mvk-bulk-toolbar',
  imports: [NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isVisible()) {
      <div class="bar" role="toolbar" [attr.aria-label]="ariaLabel()">
        <span class="count" aria-live="polite">{{ selectionLabel() }}</span>
        <span class="sep" aria-hidden="true">·</span>
        @for (action of actions(); track action.intentId) {
          <button
            type="button"
            class="action"
            [ngClass]="'kind-' + action.mapsTo.kind"
            [attr.data-intent]="action.intentId"
            (click)="select(action)">
            <span class="kind" [attr.data-kind]="action.mapsTo.kind">{{ action.mapsTo.kind }}</span>
            <span class="label">{{ action.label }}</span>
          </button>
        } @empty {
          <span class="empty">No bulk actions for this selection.</span>
        }
        <span class="spacer"></span>
        <button type="button" class="dismiss" aria-label="Clear selection" (click)="dismiss.emit()">×</button>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .bar {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.5rem 0.8rem;
      background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 0.5rem;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
      animation: slideIn 160ms ease-out;
      font-family: system-ui, sans-serif; font-size: 0.9em;
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .count { font-weight: 600; color: #1e1b4b; }
    .sep { color: #818cf8; }
    .action {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.35rem 0.7rem; border: 1px solid transparent;
      background: white; color: #1e1b4b; border-radius: 0.35rem;
      cursor: pointer; font: inherit; font-size: 0.9em;
    }
    .action:hover { background: #f5f3ff; border-color: #c7d2fe; }
    .action:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .kind {
      padding: 0.05rem 0.4rem; border-radius: 999px;
      font-size: 0.65em; font-weight: 600; text-transform: uppercase;
      color: white; background: #6366f1;
    }
    .kind[data-kind="tool"] { background: #2563eb; }
    .kind[data-kind="action"] { background: #16a34a; }
    .kind[data-kind="route"] { background: #ea580c; }
    .empty { color: #6b7280; font-style: italic; }
    .spacer { flex: 1; }
    .dismiss {
      background: transparent; border: 0; color: #4338ca; cursor: pointer;
      width: 1.6rem; height: 1.6rem; padding: 0;
      font-size: 1.1rem; line-height: 1; border-radius: 0.3rem;
    }
    .dismiss:hover { background: #ddd6fe; }
  `,
})
export class BulkToolbarComponent {
  /** The current selection. Empty → toolbar stays hidden. */
  readonly selection = input.required<readonly unknown[]>();

  /** Names of intents (`IntentDef.id`) to consider for this selection. */
  readonly intents = input<readonly string[]>([]);

  /**
   * Optional entity-type tag (`'document'`, `'custodian'`, ...). Forwarded
   * into `BulkActionResult.entity` for audit attribution.
   */
  readonly entity = input<string | undefined>(undefined);

  /**
   * Optional selection-state predicate. Applied after persona scope
   * and the `[intents]` allow-list. Returning `false` hides that
   * intent for this specific selection.
   */
  readonly filter = input<BulkIntentFilter>(() => true);

  /**
   * Optional label generator. Defaults to `"<n> selected"`. Override
   * when you want entity-specific phrasing — `"3 documents · 1 custodian"`.
   */
  readonly selectionLabelFn = input<(selection: readonly unknown[]) => string>(
    (s) => `${s.length} selected`,
  );

  /** Emits when the user picks an action. */
  readonly selected = output<BulkActionResult>();

  /** Emits when the user clicks the `×` button. Host clears its selection. */
  readonly dismiss = output<void>();

  private readonly registry = inject(IntentRegistry);

  /** Toolbar is hidden when the selection is empty. */
  protected readonly isVisible = computed(() => this.selection().length > 0);

  /**
   * Resolved action buttons. Persona-filtered via `IntentRegistry.get()`
   * then selection-filtered via `[filter]`. Recomputes when intents,
   * selection, filter, or registry's scope policy change.
   */
  protected readonly actions = computed<readonly BulkActionResult[]>(() => {
    const filter = this.filter();
    const selection = this.selection();
    const entity = this.entity();
    const out: BulkActionResult[] = [];
    for (const id of this.intents()) {
      const def = this.registry.get(id);
      if (!def) continue;                                // persona-blocked / unregistered
      if (!filter(def, selection)) continue;             // selection-state predicate
      out.push({
        intentId: def.id,
        mapsTo: def.mapsTo,
        selection,
        entity,
        label: def.description || def.name,
        description: def.examples[0],
      });
    }
    return out;
  });

  /** Cached label string for the count badge. */
  protected readonly selectionLabel = computed(() => this.selectionLabelFn()(this.selection()));

  protected readonly ariaLabel = computed(() => `Bulk actions for ${this.selectionLabel()}`);

  protected select(action: BulkActionResult): void {
    this.selected.emit(action);
  }
}
