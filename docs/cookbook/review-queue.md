# Multi-reviewer review queue

> **Status:** ships in v1.2.x (P4.A of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Workflow:** E — Multi-reviewer privilege QC with approval queues

The agent does the **proposing**. Humans do the **disposing**. Different personas see different items routed to them by state — junior reviewers see first-pass proposals, senior reviewers see QC, partners see escalations. The audit chain captures every decision and any override.

`<mvk-review-queue>` is the **presentation-only** queue widget. It groups items by state, surfaces persona-appropriate action buttons per group, and emits typed events when the user clicks. The host owns the item store (typically `PersistenceRegistry`-backed), the state-transition logic, and the chain-hash writeback. The lib stays decoupled from any specific persistence + workflow story.

## 1. Build a queue store

A bare-minimum signal-backed store. Real apps wire `PersistenceRegistry` so the queue survives reload.

```ts
import { signal, Injectable } from '@angular/core';
import type { ReviewQueueItem, ReviewDecision } from '@infra-tools/agentic-ui';

@Injectable({ providedIn: 'root' })
export class ReviewQueueStore {
  private readonly _items = signal<ReviewQueueItem[]>([]);
  readonly items = this._items.asReadonly();

  apply(decision: ReviewDecision, reviewer: string): void {
    this._items.update((cur) =>
      cur.map((it) => {
        if (it.id !== decision.itemId) return it;
        return { ...it, state: nextState(decision), updatedAt: new Date().toISOString() };
      }),
    );
    // Optional: chain-hash the decision as a tool call for the audit ledger.
    this.audit.append({
      kind: 'review-decision',
      itemId: decision.itemId,
      reviewer,
      action: decision.action,
      fromState: decision.fromState,
      ts: new Date().toISOString(),
    });
  }
}

// Plain transition map — your domain might have richer logic
// (escalation reasons, optional confirmation, follow-up tools, ...).
function nextState(d: ReviewDecision): ReviewQueueItem['state'] {
  switch (d.action) {
    case 'accept':   return 'qc_pending';
    case 'reject':   return 'final';
    case 'approve':  return 'final';
    case 'escalate': return 'escalated';
    case 'finalize': return 'final';
    default:         return d.fromState as ReviewQueueItem['state'];
  }
}
```

## 2. Per-persona routing — one component, four queues

The `[states]` input filters + orders which state-groups the active persona sees. Compute it from the persona signal:

```ts
@Component({
  selector: 'app-review-queue-page',
  imports: [ReviewQueueComponent],
  template: `
    <mvk-review-queue
      [items]="store.items()"
      [states]="personaStates()"
      (open)="onOpenItem($event)"
      (decision)="store.apply($event, persona())" />
  `,
})
class ReviewQueuePage {
  private readonly persona = inject(ACTIVE_PERSONA);

  readonly personaStates = computed<readonly string[]>(() => {
    switch (this.persona()) {
      case 'junior-reviewer': return ['proposed_privileged'];
      case 'senior-reviewer': return ['qc_pending'];
      case 'partner':         return ['escalated'];
      case 'gc':              return ['proposed_privileged', 'qc_pending', 'escalated', 'final'];
      default:                return [];
    }
  });

  onOpenItem(id: string): void {
    this.router.navigate(['/documents', id]);
  }
}
```

**One template, four legitimately different queues** depending on who's looking. No `*ngIf="persona === ..."` branches, no template fork.

## 3. The default action config + custom overrides

`DEFAULT_REVIEW_QUEUE_ACTIONS` covers the eDiscovery privilege-review flow:

| State | Actions |
|---|---|
| `proposed_privileged` | **Accept** (primary) · **Reject** (danger) |
| `qc_pending` | **Approve** (primary) · **Escalate** |
| `escalated` | **Finalize** (primary) · **Reject** (danger) |
| `final` | — (terminal, no actions) |

Override with `[actionConfig]` for non-eDiscovery flows:

```ts
readonly bugTriageActions: ReviewQueueActionConfig = {
  triage:   [{ key: 'assign', label: 'Assign', emphasis: 'primary' },
             { key: 'wontfix', label: "Won't fix", emphasis: 'danger' }],
  in_progress: [{ key: 'resolve', label: 'Resolve', emphasis: 'primary' }],
  resolved: [],
};
```

```html
<mvk-review-queue [items]="bugs()" [actionConfig]="bugTriageActions" ... />
```

States can be any string — the component doesn't hard-code `proposed_privileged` / `qc_pending` etc. The default config + the `ReviewQueueState` type ship as a hint for the common case.

## 4. Dispatching the decision through the audit chain

Every `(decision)` emission is a candidate for a chain-hashed tool call. Two patterns:

**A — Direct tool call.** Wire the decision to `agenticTool({name: 'reviewDecision'})`. The handler writes the new state and chain-hashes naturally as part of the orchestrator's audit pipeline.

```ts
onDecision(d: ReviewDecision): void {
  this.chat.sendMessage(`reviewDecision: ${d.itemId} ${d.action} (from ${d.fromState})`);
}
```

**B — Direct store mutation + manual audit append.** Avoids the LLM round-trip; appropriate when the decision is deterministic and the host owns the audit ledger:

```ts
onDecision(d: ReviewDecision): void {
  this.store.apply(d, this.persona());
  this.audit.append({
    origin: 'review-queue',
    kind: 'review-decision',
    itemId: d.itemId,
    action: d.action,
    persona: this.persona(),
    ts: new Date().toISOString(),
  });
}
```

Either way, the audit chain captures *who* changed state, *what* the state was before, and *when* — the three things any defensibility story needs.

## 5. Composing with the rest of P0/P1/P2/P3

The review queue is one more lens onto the same registry layer:

- **`<mvk-cmd-k-palette>` (P1.1)** — *"Open my queue"* navigates here.
- **`<mvk-smart-cell>` (P1.2)** in a `Documents` table — shows the proposed privilege confidence; the queue accepts/rejects those proposals.
- **`<mvk-row-action-menu>` (P1.3)** on a queue row — adds *"Open in workbench"*, *"Compare to similar"*, *"Generate explanation"* as intent-driven actions.
- **`<mvk-bulk-toolbar>` (P1.4)** when the user multi-selects queue items — surfaces bulk approve / bulk escalate.
- **`<mvk-notification-tray>` + `<mvk-inbox>` (P2)** — *"3 items waiting in your QC queue"* surfaces in the tray when a cron trigger fires `checkQueueDepth`.
- **`<mvk-lifecycle-stages>` (P2.4)** on the item detail route — shows the proposed → QC → escalated → final stages for *this specific item*.
- **`<mvk-dashboard-canvas>` (P3.A)** — surfaces queue depth as a tile (`{tool: 'reviewQueueDepth'}`), drill-down navigates to the queue.

Same registry layer, same persona scope, same audit chain. **One workflow, eight composable surfaces.**

## 6. Reference

- **Component:** `<mvk-review-queue [items] [states] [actionConfig] [stateLabels] (open) (decision) />`
- **Types:** `ReviewQueueItem`, `ReviewQueueState`, `ReviewQueueAction`, `ReviewQueueActionConfig`, `ReviewDecision`
- **Default config:** `DEFAULT_REVIEW_QUEUE_ACTIONS`
- **Tests:** 15 specs covering empty / grouped / persona-routed / order-preserved / per-group counts / item rendering / default + custom action configs / emphasis classes / decision emission / open emission + a11y
- **Plan:** [post-chat-surfaces-plan §4 Workflow E](../plans/post-chat-surfaces-plan.md#4-complex-workflows-worth-modelling)
- **Related:**
  - [F4 Approval](./approval-flow.md) — gating model the queue draws on for senior sign-off
  - [Lifecycle stages](./lifecycle-stages.md) — drill-down view for an individual queue item
  - [Smart cells](./smart-cell.md) — the per-cell agent computation that feeds the queue
