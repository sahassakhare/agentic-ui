# Selection-aware bulk toolbar with `<mvk-bulk-toolbar>`

> **Status:** ships in v1.2.x (P1.4 of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Pattern:** §3 Pillar 1 row 3

User multi-selects 47 documents. A toolbar materialises at the top of the page with operations the agent thinks make sense for *this* selection — *"Bulk-tag privileged"*, *"Send to review queue"*, *"Run redaction proposal"*. If the selection is all from one custodian, *"Generate custodian summary"* appears. If it spans dates, *"Build timeline"* appears.

The toolbar isn't hard-coded. It's an `IntentRegistry` query against `{ selection, persona, route }` — same three-stage filter chain as `<mvk-row-action-menu>` but against the *aggregate* selection state.

## 1. Drop it above your table

```ts
import { signal, computed } from '@angular/core';
import { BulkToolbarComponent, type BulkActionResult, type BulkIntentFilter } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-documents-page',
  imports: [BulkToolbarComponent /* + your table primitives */],
  template: `
    <mvk-bulk-toolbar
      [selection]="selectedDocs()"
      entity="document"
      [intents]="[
        'bulkTagPrivileged',
        'sendToReviewQueue',
        'runRedactionProposal',
        'generateCustodianSummary',
        'buildTimeline'
      ]"
      [filter]="bulkFilter"
      [selectionLabelFn]="describeSelection"
      (selected)="onBulkAction($event)"
      (dismiss)="clearSelection()" />

    <table>
      <!-- your existing documents table; each row binds (change)="toggleSelected(row)" -->
    </table>
  `,
})
class DocumentsPage {
  readonly selectedDocs = signal<readonly Document[]>([]);

  // Selection-state predicate: contextual intents like the custodian
  // summary only make sense for single-custodian selections.
  bulkFilter: BulkIntentFilter = (intent, selection) => {
    if (intent.id === 'generateCustodianSummary') {
      const docs = selection as Document[];
      const custodians = new Set(docs.map((d) => d.custodianId));
      return custodians.size === 1;
    }
    if (intent.id === 'buildTimeline') {
      const docs = selection as Document[];
      const dates = new Set(docs.map((d) => d.date.slice(0, 7))); // year-month
      return dates.size > 1;     // only show when the selection spans months
    }
    return true;
  };

  // Custom label: "47 documents · 1 custodian"
  describeSelection = (selection: readonly unknown[]): string => {
    const docs = selection as Document[];
    const custodians = new Set(docs.map((d) => d.custodianId));
    return `${docs.length} documents · ${custodians.size} custodian${custodians.size === 1 ? '' : 's'}`;
  };

  onBulkAction(r: BulkActionResult): void {
    switch (r.mapsTo.kind) {
      case 'route':
        this.router.navigateByUrl(r.mapsTo.target);
        return;
      case 'action':
        this.actions.dispatch({ name: r.mapsTo.target, payload: r.selection });
        return;
      case 'tool':
        // Send through the agent so the LLM can orchestrate the batch
        // and audit-chain captures the bulk op as a single tool call.
        const ids = (r.selection as Document[]).map((d) => d.id);
        this.chat.sendMessage(`${r.intentId}: ${ids.join(',')}`);
        return;
    }
  }

  clearSelection(): void {
    this.selectedDocs.set([]);
  }
}
```

The toolbar:
- **Stays hidden** while `selection` is empty.
- **Slides in** when selection becomes non-empty (160ms ease-out, respects `prefers-reduced-motion`).
- **Shows count via** the default label (`"3 selected"`) or a custom `selectionLabelFn` for entity-aware phrasing.
- **Renders one button per resolved intent** with a `kind` badge (`tool` / `action` / `route` colour-coded).
- **Has a `×` dismiss button** that emits `(dismiss)` so the host can clear its selection state.

## 2. The three-stage filter chain (same shape as the row menu)

For each name in `[intents]`:

1. **Allow-list.** Names not in `[intents]` are never even considered.
2. **Persona scope.** `IntentRegistry.get(name)` returns undefined for personas denied via `setScopePolicy`. The junior reviewer's `bulkRelease` is filtered automatically.
3. **Selection state.** `[filter]=(intent, selection) => boolean` predicate. `false` hides for *this* selection only.

All three are AND-ed. The toolbar re-evaluates on every change to `selection` / `intents` / `filter` / scope-policy signal.

## 3. Why the filter takes the *whole* selection

Row-level actions live on `<mvk-row-action-menu>` — the filter there takes a single row. The bulk toolbar's filter takes the **aggregate** selection because the interesting intents at the bulk tier are about properties of the *set* (size, spans, uniqueness) that can't be expressed row-by-row:

- *"Build timeline"* — only when selection spans multiple dates.
- *"Generate custodian summary"* — only when selection is from a single custodian.
- *"Bulk-tag privileged"* — only when no item is already tagged privileged.
- *"Run redaction proposal"* — only when selection size ≤ 100 (cost gate).

If you find yourself filtering per-row and aggregating, the smart cell + row action menu is the right surface. The bulk toolbar is for set-level intents.

## 4. The `(dismiss)` contract

`(dismiss)` is emitted when the user clicks `×`. The toolbar does **not** clear its own selection state — the host owns that. The pattern lets the host show a confirmation, persist an "undo" stack, or keep the selection for a partial dismissal (e.g. clearing only the items that failed an action). The default and simplest host wiring: `(dismiss)="selection.set([])"`.

## 5. Dispatch is host-driven (same as the rest of P1)

`BulkActionResult` carries the typed `mapsTo` target plus the full selection:

```ts
interface BulkActionResult {
  readonly intentId: string;                  // 'bulkTagPrivileged'
  readonly mapsTo: IntentTarget;              // { kind: 'tool', target: 'bulkTagPrivileged' }
  readonly selection: readonly unknown[];     // the full selection array
  readonly entity?: string;                   // 'document' — for audit
  readonly label: string;
  readonly description?: string;
}
```

Host's `(selected)` handler switches on `mapsTo.kind`. Same dispatch-agnostic pattern as `<mvk-cmd-k-palette>` and `<mvk-row-action-menu>`. No coupling to `Router` / `ActionRegistry` / chat shell inside the component.

## 6. The architectural property

Three surfaces, one registry layer:

- `<mvk-smart-cell>` — agent's view of **one cell** in **one row**.
- `<mvk-row-action-menu>` — agent's suggestions for **one row**.
- `<mvk-bulk-toolbar>` — agent's suggestions for **a set of rows**.

All three read from `IntentRegistry` / `ComponentRegistry` / `ToolRegistry` and honour the same persona scope. Junior reviewer's three surfaces show one consistent reduced surface; partner's three show one consistent full surface. No template forks, no admin overhead.

## 7. Reference

- **Component:** `<mvk-bulk-toolbar [selection] [intents] [entity] [filter] [selectionLabelFn] (selected) (dismiss) />`
- **Result type:** `BulkActionResult`
- **Filter type:** `BulkIntentFilter = (intent, selection) => boolean`
- **Tests:** 14 specs covering visibility toggle, materialise/hide, default + custom label, filter chain (allow-list + persona + selection-state), unknown intent silently skipped, empty-state row, dispatch on click, dismiss event, post-emit toolbar persistence (host controls clearing)
- **Plan:** [post-chat-surfaces-plan §3 Pillar 1 pattern 3](../plans/post-chat-surfaces-plan.md#pillar-1--web-surface-patterns-post-chat-affordances)
- **Related:**
  - [`<mvk-row-action-menu>`](./row-action-menu.md) — per-row context menu (same filter chain pattern, single-row state)
  - [`<mvk-smart-cell>`](./smart-cell.md) — per-cell agent computation
  - [⌘K / Ctrl+K palette](./cmd-k-palette.md) — app-wide summon
