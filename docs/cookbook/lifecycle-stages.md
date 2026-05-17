# Multi-stage lifecycle widget with `<mvk-lifecycle-stages>`

> **Status:** ships in v1.2.x (P2.4 of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Workflow:** A (legal-hold lifecycle)

Some artefacts have a **lifecycle**, not a state. A legal hold isn't issued *or* released — it goes through *Issue → Acknowledge → Track → Reissue → Release*, each transition owned by a different role, each gated by SLAs, each chain-hashed for defensibility. The same shape applies to the production pipeline (*Scope → Collect → ... → Deliver*) and to CAL training rounds (*Seed → Classify → Review → Re-train → Converge*).

`<mvk-lifecycle-stages>` renders this shape as a single widget: status per stage, owner attribution, SLA chips, and per-stage action buttons. It pairs with `TriggerRegistry` cron schedules (P2.1) so SLA-driven reminders fire automatically, and with `ApprovalRegistry` (F4) so reviewers approve transitions through the same HITL pattern as one-off tool calls.

## 1. The canonical legal-hold scenario

```ts
import { signal, computed } from '@angular/core';
import { LifecycleStagesComponent, type StageAction, type StageDef } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-hold-detail',
  imports: [LifecycleStagesComponent],
  template: `
    <mvk-lifecycle-stages
      [title]="'Hold ' + hold().id + ' — ' + hold().matter"
      [stages]="stages()"
      orientation="horizontal"
      (action)="onStageAction($event)" />
  `,
})
class HoldDetailPage {
  hold = signal({ id: 'H-117', matter: 'Project Phoenix' });

  stages = computed<StageDef[]>(() => [
    { id: 'issue',       title: 'Issue',       status: 'done',
      owner: 'partner: Sarah', updatedAt: '2026-04-12T14:30:00Z' },
    { id: 'acknowledge', title: 'Acknowledge', status: 'active',
      owner: 'awaiting 3 custodians',
      slaWarning: '2 days overdue',
      action: { label: 'Send reminders', key: 'send-reminders' } },
    { id: 'track',       title: 'Track',       status: 'pending' },
    { id: 'reissue',     title: 'Reissue',     status: 'pending' },
    { id: 'release',     title: 'Release',     status: 'pending' },
  ]);

  onStageAction(a: StageAction): void {
    // a.actionKey === 'send-reminders'
    this.chat.sendMessage(`draftAckReminders for ${this.hold().id}`);
  }
}
```

The widget renders:

- 5 stages with status-coded markers (`✓` done, `●` active pulsing, `○` pending)
- Owner attribution per stage
- The amber SLA chip on the overdue Acknowledge stage
- A `Send reminders` button on the active stage that emits `(action)` for the host to dispatch

## 2. Status taxonomy

Five statuses cover the typical lifecycle shape:

| Status | Marker | Visual | Use when |
|---|---|---|---|
| `done` | `✓` | green | Stage completed, irreversible |
| `active` | `●` (pulse) | blue | Currently in-flight |
| `pending` | `○` | grey | Not yet reached |
| `blocked` | `⏸` | amber | Gated externally — waiting on approval, upstream data, custodian response |
| `failed` | `✗` | red | Terminal failure; needs re-routing |

The marker glyph + colour is encoded in CSS via `[data-status="..."]`. Apps can override the styling without forking the component:

```css
mvk-lifecycle-stages .marker[data-status="active"] {
  background: var(--my-brand-accent);
}
```

## 3. Pair with a `TriggerRegistry` cron for SLA reminders

The widget renders the lifecycle. The trigger fires the reminder. The two are independent and compose naturally:

```ts
// Daily 09:00 UTC: sweep all holds for SLA violations
triggers.register({
  name: 'hold-sla-sweep',
  description: 'Check every active hold for acknowledgement SLA breaches',
  kind: 'cron',
  spec: { kind: 'cron', expression: '@daily' },
  target: {
    kind: 'notification',
    compose: async (ctx) => {
      const breaches = await fetchSlaBreaches();
      return {
        title: `${breaches.length} holds need attention`,
        body: `Breached SLAs in ${breaches.map((b) => b.id).join(', ')}`,
        severity: breaches.length > 5 ? 'warning' : 'info',
        cta: { kind: 'route', target: '/holds?filter=sla-breach' },
      };
    },
  },
  runAs: 'paralegal',
});
```

The notification surfaces in `<mvk-notification-tray>` and `<mvk-inbox>`. Click the CTA → route to the filtered holds list → click a row → land on the hold detail page → see `<mvk-lifecycle-stages>` with the overdue Acknowledge stage and the *Send reminders* action ready to fire.

End-to-end: the agent proactively flags the breach, the user takes one click to drill in, the lifecycle widget surfaces the action. No bespoke timer code anywhere.

## 4. Orientation: horizontal vs vertical

Default is horizontal (laptop-friendly). For mobile or sidebar layouts:

```html
<mvk-lifecycle-stages
  [stages]="stages()"
  orientation="vertical"
  [title]="'Hold H-117'" />
```

Vertical orientation flips the layout to a top-to-bottom progression with connectors on the left. The same `StageDef` shape works for both — the host picks the orientation per surface.

## 5. The action contract

A stage's `action` is optional and only surfaces when the stage is in `active` or `blocked` status. The widget emits `(action)` with `{stageId, actionKey}`; the host wires the actual side-effect.

| Stage status | Action button rendered? |
|---|---|
| `active` | ✓ when `action` is set |
| `blocked` | ✓ when `action` is set |
| `done` | ✗ (stage is terminal) |
| `pending` | ✗ (stage hasn't started) |
| `failed` | ✗ (stage is terminal — host shows a separate "Retry" CTA elsewhere) |

This matches the architectural pattern: the widget renders what's true *now*; user actions land through the same handler the rest of the host already wires.

## 6. The audit chain integration

When the host's `(action)` handler dispatches a tool call (typically through chat or a direct tool invocation), the audit chain captures it with `origin: 'lifecycle-stages'` if the host adds that tag — paralleling the `origin` field convention from [ADR-041 D3](../adr/0041-teams-copilot-external-surfaces.md). Combined with the trigger fire's `origin: 'trigger'`, the audit query reconstructs:

```
trigger:hold-sla-sweep@2026-04-12T09:00:00Z
  → notification posted, correlation:trg-hold-sla-sweep-...
  → user clicked tray, navigated to /holds/H-117
  → user clicked "Send reminders" on Acknowledge stage
    → chat.sendMessage('draftAckReminders for H-117')
    → tool: draftAckReminders
      → 3 reminders drafted, queued for approval
```

That single query graph is *the defensibility story* the post-chat-surfaces plan was after.

## 7. Reference

- **Component:** `<mvk-lifecycle-stages [stages] [title] [orientation] (action) />`
- **Types:** `StageDef`, `StageStatus`, `StageAction`
- **Tests:** 17 specs covering rendering per status, marker glyphs, aria-current="step" on active, header counts, orientation, owner + SLA + description metadata, action button conditional + click emit, connector count + done-styling
- **Plan:** [post-chat-surfaces-plan Workflow A](../plans/post-chat-surfaces-plan.md#4-complex-workflows-worth-modelling)
- **Related:**
  - [Proactive triggers + Inbox](./proactive-triggers-and-inbox.md) — the cron + notification surface that pairs with this widget
  - [ADR-045 TriggerRegistry](../adr/0045-trigger-registry.md) — registry mechanics
  - [F4 Approval](./approval-flow.md) — HITL gating for stage transitions that need senior sign-off
