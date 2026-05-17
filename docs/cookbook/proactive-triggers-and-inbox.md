# Proactive triggers + Inbox

> **Status:** ships in v1.2.x (P2 of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **ADR:** [0045](../adr/0045-trigger-registry.md) · **Pattern:** §3 Pillar 1 row 8 + Workflow A

Every tool call before this section was *user-initiated* — typed in chat, clicked from a row menu, fired from the palette, dispatched from a bulk toolbar, picked in an assist panel. P2 introduces the missing surface: the agent **acting at the user** on a schedule, a webhook, or an internal event.

Three pieces ship together:

- **[`TriggerRegistry`](../adr/0045-trigger-registry.md)** — the 17th registry. Registers cron / webhook / queue triggers, scopes them by persona, federates with MFE remotes via `removeBySource` symmetry.
- **`provideTriggerRunner({...})`** — the browser-side in-process scheduler. Ticks once per 30s by default, evaluates cron expressions, dispatches via the same tool-call pipeline as user-initiated calls.
- **`<mvk-notification-tray>` + `<mvk-inbox>`** — surfaces for the proactive notifications the runner emits.

## 1. Register a daily-ack-check trigger

```ts
import { agenticTool, TriggerRegistry } from '@infra-tools/agentic-ui';
import { z } from 'zod';

// First — the tool that does the work. Reads unacknowledged holds
// and emits one Inbox notification per overdue custodian.
agenticTool({
  name: 'checkAckSlas',
  description: 'Sweep custodians who have not acknowledged active holds within SLA',
  schema: z.object({ slaDays: z.number().default(7) }),
  handler: async (args, ctx) => {
    const overdue = await fetchOverdueCustodians({ olderThanDays: args.slaDays });
    return { overdueIds: overdue.map((c) => c.id), count: overdue.length };
  },
});

// Then — the trigger that runs it daily at 09:00 UTC.
const triggers = inject(TriggerRegistry);
triggers.register({
  name: 'daily-ack-sla-check',
  description: 'Sweep unacknowledged holds every weekday morning',
  kind: 'cron',
  spec: { kind: 'cron', expression: '@daily' },
  target: { kind: 'tool', tool: 'checkAckSlas', args: { slaDays: 7 } },
  runAs: 'paralegal',     // tool runs under the paralegal's persona scope
  tags: ['legal-hold', 'sla'],
  lifecycle: 'published',
});
```

The trigger is registered. It won't fire until you wire the runner.

## 2. Wire `provideTriggerRunner` once

```ts
// app.config.ts
import { provideTriggerRunner } from '@infra-tools/agentic-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgenticUi(),
    provideTriggerRunner({
      kinds: ['cron'],                  // browser-side only handles cron
      tickIntervalMs: 30_000,           // evaluate every 30s
      paused: () => document.hidden,    // halt while tab inactive — saves battery
      onNotification: (draft, ctx) => inboxStore.push(toTrayNotification(draft, ctx)),
      onAction: (action, payload, ctx) => actionDispatcher.dispatch({ action, payload, origin: ctx }),
      // Custom evaluator if the built-in sugar isn't enough:
      // evaluator: (expr, now) => cronParser.parseExpression(expr).next() <= now,
    }),
  ],
};
```

The default evaluator handles common sugar — `@minutely`, `@hourly`, `@daily`, `@midnight`, `@weekly`, and `every N (minutes|hours|days)`. For full POSIX cron, plug `cron-parser` (or any equivalent) via the `evaluator` option. The runtime tier ships zero new dependencies.

## 3. Wire your inbox store

The store is host-owned — the lib doesn't ship one because the persistence story varies (in-memory for the demo, IndexedDB for offline, server-backed for cross-device). Minimum signal-backed store:

```ts
import { signal, Injectable } from '@angular/core';
import type { TrayNotification, NotificationDraft, TriggerFiringContext } from '@infra-tools/agentic-ui';

@Injectable({ providedIn: 'root' })
export class InboxStore {
  private readonly _items = signal<readonly TrayNotification[]>([]);
  readonly list = this._items.asReadonly();

  push(notification: TrayNotification): void {
    this._items.update((prev) => [notification, ...prev]);
  }

  markRead(id: string): void {
    this._items.update((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  markAllRead(): void {
    this._items.update((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  clearRead(): void {
    this._items.update((prev) => prev.filter((n) => !n.read));
  }
}

// Helper to lift a TriggerFiringContext + NotificationDraft into a tray entry.
export function toTrayNotification(draft: NotificationDraft, ctx: TriggerFiringContext): TrayNotification {
  return {
    id: ctx.correlationId,
    draft,
    firedAt: ctx.firedAt,
    firedBy: ctx.firedBy,
    read: false,
    origin: ctx.triggerId,
  };
}
```

Now the runner's `onNotification` callback pushes into this store, and the same store feeds both UI surfaces.

## 4. Drop the tray into your top bar

```html
<header class="app-bar">
  <h1>eDiscovery</h1>
  <span class="spacer"></span>

  <mvk-notification-tray
    [notifications]="inboxStore.list()"
    (activate)="onNotificationActivate($event)"
    (markRead)="inboxStore.markRead($event)"
    (markAllRead)="inboxStore.markAllRead()" />

  <persona-switcher />
</header>
```

```ts
onNotificationActivate(n: TrayNotification): void {
  const cta = n.draft.cta;
  if (!cta) return;
  switch (cta.kind) {
    case 'route':  this.router.navigateByUrl(cta.target); return;
    case 'action': this.actions.dispatch({ name: cta.target, payload: n }); return;
    case 'tool':   this.chat.sendMessage(`${cta.tool} for notification ${n.id}`); return;
  }
}
```

Same handler shape as every other P0/P1 surface — switch on `kind`.

## 5. Add the `/inbox` route

```ts
// app.routes.ts
import { InboxComponent } from '@infra-tools/agentic-ui';

export const routes: Routes = [
  { path: 'inbox', component: InboxPageComponent },
  // ...
];
```

```ts
@Component({
  selector: 'app-inbox-page',
  imports: [InboxComponent],
  template: `
    <mvk-inbox
      [notifications]="inboxStore.list()"
      (activate)="onActivate($event)"
      (markRead)="inboxStore.markRead($event)"
      (markAllRead)="inboxStore.markAllRead()"
      (clearRead)="inboxStore.clearRead()" />
  `,
})
class InboxPageComponent {
  // same handlers as the tray
}
```

## 6. Compose a notification draft from a trigger

When the trigger's `target.kind === 'notification'`, the runner calls `target.compose(ctx)` and passes the resulting `NotificationDraft` to your `onNotification` callback.

```ts
triggers.register({
  name: 'weekly-tile-rollup',
  description: 'Roll up the week\'s production-throughput numbers',
  kind: 'cron',
  spec: { kind: 'cron', expression: '@weekly' },
  target: {
    kind: 'notification',
    compose: (ctx) => ({
      title: `Weekly production rollup`,
      body: `Generated by ${ctx.firedBy} at ${ctx.firedAt}`,
      severity: 'info',
      cta: { kind: 'route', target: '/dashboards/production-throughput' },
    }),
  },
});
```

The runner fires; `compose()` builds the draft; your store ingests it; both the tray and `/inbox` route show it.

## 7. Persona scope flows through automatically

A trigger's `runAs: 'paralegal'` means the runner invokes the target tool against the paralegal's `setScopePolicy` filter on `ToolRegistry`. When a paralegal can't see `checkAckSlas`, the runner logs a `console.warn` and skips the fire — no silent failure, no superuser escape hatch.

For a trigger without `runAs`, the runner falls back to the `'trigger:default'` locked-down persona. Apps must explicitly map this persona to a tool set (typically via the catalog's persona-resolver config); until they do, *no triggers actually do anything* — loud-safe default.

## 8. Disable a trigger without unregistering it

Set `lifecycle: 'disabled'` on the `TriggerDef`. The trigger stays in the registry (visible in the ops console), but the runner skips it on every tick.

```ts
triggers.register({
  name: 'experimental-tile-rollup',
  // ... other fields
  lifecycle: 'disabled',
});
```

This pairs with the existing catalog deny-list pattern from [ADR-033](../adr/0033-catalog-capability-authorizer.md) — operators toggle triggers from the ops console with the same UX as toggling tools or widgets.

## 9. What the browser-side runner DOESN'T do

Per [ADR-045](../adr/0045-trigger-registry.md):

- **Cross-session persistence.** Browser-side cron triggers are advisory — page reload restarts the schedule from the now-running tab. Durable schedules live in the future server-side runner package (ADR-045 D6 / forthcoming ADR-046).
- **Webhook / queue receivers.** The browser can't host inbound webhooks. Wire those through the server-side runner; the registry shape is identical.
- **Hidden-tab catch-up.** When `paused()` is true, missed cron boundaries are not replayed on resume — they just skip silently. Server-side runner is the right surface for SLA-bearing schedules.
- **Distributed locking.** Multiple tabs / pods will fire the same trigger independently. Browser-side is a single-user-single-tab default; server-side adds the lock.

## 10. Reference

- **ADR:** [0045 — TriggerRegistry](../adr/0045-trigger-registry.md)
- **Registry:** `TriggerRegistry` (17th registry; standard `register / list / signal / removeBySource / setScopePolicy`)
- **Provider:** `provideTriggerRunner({kinds, tickIntervalMs, paused, evaluator, defaultRunAs, onNotification, onAction})`
- **Tokens:** `TRIGGER_RUNNER` for ops-console + tests; injects `TriggerRunner`
- **Helpers:** `defaultCronEvaluator` (built-in sugar); replace via the `evaluator` option
- **Components:** `<mvk-notification-tray>` (bell + dropdown) · `<mvk-inbox>` (route widget)
- **Types:** `TriggerDef` · `TriggerKind` · `TriggerSpec` · `TriggerTarget` · `TriggerFiringContext` · `NotificationDraft` · `NotificationCta` · `TrayNotification`
- **Tests:** 21 trigger specs + 17 tray specs + 18 inbox specs (56 P2 specs in total)
