# Per-row context menus with `<mvk-row-action-menu>`

> **Status:** ships in v1.2.x (P1.3 of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Pattern:** §3 Pillar 1 row 2

A kebab (`⋮`) on every row of a table opens a context menu whose items the **agent picks based on the row's state** — *"Run hold acknowledgment check"*, *"Open in review"*, *"Release the hold"*. Different rows show different menus. Junior reviewers and partners see different menus on the *same row*. Same architectural property as the smart cell + the palette: the agent participates in every surface, the host wires dispatch.

This cookbook covers the canonical eDiscovery scenario: **per-row actions on the `Custodians` list**.

## 1. Register the intents once

`<mvk-row-action-menu>` reads from `IntentRegistry`. Register every intent the host can offer; persona scope filters the visible set per-user.

```ts
import { agenticIntent } from '@infra-tools/agentic-ui';
import { z } from 'zod';

provideAgenticUi({
  intents: [
    agenticIntent({
      id: 'runHoldAck',
      description: 'Run hold acknowledgment check',
      examples: ['check ack', 'verify acknowledgement'],
      schema: z.object({}),
      mapsTo: { kind: 'tool', target: 'runHoldAck' },
    }),
    agenticIntent({
      id: 'openInReview',
      description: 'Open in review queue',
      examples: ['open in review'],
      schema: z.object({}),
      mapsTo: { kind: 'route', target: '/review-queue' },
    }),
    agenticIntent({
      id: 'releaseHold',
      description: 'Release the hold',
      examples: ['release hold'],
      schema: z.object({}),
      mapsTo: { kind: 'action', target: 'releaseHold' },
    }),
  ],
});
```

## 2. Drop it into your table

```ts
import { RowActionMenuComponent, type RowActionResult, type RowIntentFilter } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-custodians-table',
  imports: [RowActionMenuComponent /* + your table primitives */],
  template: `
    <table>
      <tr *ngFor="let custodian of custodians()">
        <td>{{ custodian.name }}</td>
        <td>{{ custodian.department }}</td>
        <td>
          <mvk-row-action-menu
            [row]="custodian"
            entity="custodian"
            [intents]="['runHoldAck', 'openInReview', 'releaseHold']"
            [filter]="rowFilter"
            (selected)="onAction($event)" />
        </td>
      </tr>
    </table>
  `,
})
class CustodiansTable {
  // Don't show 'releaseHold' on already-released custodians.
  rowFilter: RowIntentFilter = (intent, row) => {
    const c = row as Custodian;
    if (intent.id === 'releaseHold' && c.status !== 'active') return false;
    return true;
  };

  onAction(r: RowActionResult): void {
    switch (r.mapsTo.kind) {
      case 'route':
        this.router.navigateByUrl(r.mapsTo.target);
        return;
      case 'action':
        this.actions.dispatch({ name: r.mapsTo.target, payload: r.row });
        return;
      case 'tool':
        // Send through the agent so the LLM picks args + audit chains the call.
        this.chat.sendMessage(`${r.intentId}: ${JSON.stringify(r.row)}`);
        return;
    }
  }
}
```

## 3. The three filters that decide what's in the menu

For each name in `[intents]`, the component asks three questions before showing the row:

1. **Does the intent exist?** `IntentRegistry.get(name)` returns undefined for unregistered names. Skipped silently — typos don't blow up the menu, they just hide the row.
2. **Can the persona see it?** `IntentRegistry.get()` applies `setScopePolicy` for free. Junior reviewer's `releaseHold` returns undefined → row hidden. Same scope policy the chat-shell tool list honours; no double-bookkeeping.
3. **Does the row's state allow it?** `[filter]="rowFilter"` is a host-supplied `(intent, row) => boolean` predicate. Returning `false` hides the intent for *this specific row* without affecting the rest of the table.

All three filters are AND-ed. The menu re-evaluates on every change to `[row]`, `[intents]`, `[filter]`, or the registry's scope policy.

## 4. Keyboard semantics

| Key | Action |
|---|---|
| `Tab` to kebab → `Enter` / `Space` | Open menu |
| `Esc` | Close menu (from anywhere in the document) |
| `↑` / `↓` | Navigate highlighted row |
| `Enter` | Select highlighted row |
| **Click outside** | Close menu |

The kebab itself has `aria-haspopup="menu"` + `aria-expanded` reflecting the open state. Each row has `role="menuitem"`. Screen readers announce the menu correctly.

## 5. Dispatch is host-driven (same as `<mvk-cmd-k-palette>`)

The component never executes anything. It emits a `RowActionResult` with:

```ts
interface RowActionResult {
  readonly intentId: string;          // 'releaseHold'
  readonly mapsTo: IntentTarget;      // { kind: 'action', target: 'releaseHold' }
  readonly row: unknown;              // the row state — your domain shape
  readonly entity?: string;           // 'custodian' — for audit attribution
  readonly label: string;             // 'Release the hold'
  readonly description?: string;
}
```

The host's `(selected)` handler switches on `mapsTo.kind` to route, dispatch, or send-through-chat. Same dispatch-agnostic pattern as `<mvk-cmd-k-palette>`. No coupling to `Router` / `ActionRegistry` / chat shell inside the component.

## 6. The architectural property

The menu is one more lens onto the same registry layer. The smart cell answers *"what does the agent think about this cell?"*. The row action menu answers *"what does the agent suggest the user do with this row?"*. The palette answers *"what does the agent let me do app-wide?"*. All three read from `IntentRegistry` / `ToolRegistry` / `ComponentRegistry` and honour the same persona scope.

That's the [post-chat-surfaces premise](../plans/post-chat-surfaces-plan.md#2-architectural-premise): *the agent is the registries; the surfaces are just lenses.*

## 7. Reference

- **Component:** `<mvk-row-action-menu [row] [intents] [entity] [filter] (selected)="..." />`
- **Result type:** `RowActionResult` carrying intentId + typed mapsTo + row + entity + label
- **Tests:** 13 specs covering kebab open/toggle, close on outside click + Escape, intent ordering, persona-scope hide, row-state filter hide, unknown-intent-name skip, empty-state row, kind badge per mapsTo, click + Enter dispatch + close
- **Plan:** [post-chat-surfaces-plan §3 Pillar 1 pattern 2](../plans/post-chat-surfaces-plan.md#pillar-1--web-surface-patterns-post-chat-affordances)
- **Related:**
  - [⌘K / Ctrl+K palette](./cmd-k-palette.md) — app-wide summon
  - [`<mvk-smart-cell>`](./smart-cell.md) — agent-computed cell value
  - [Agent-directed workspace layouts (ADR-043)](./agent-directed-workspace-layouts.md) — slot-based whole-route layouts
