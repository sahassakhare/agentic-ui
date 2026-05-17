# Investigation timeline reconstruction

> **Status:** ships in v1.2.x (P4.C of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Workflow:** D — Investigation timeline reconstruction

User selects a custodian + a date range. The agent reconstructs a timeline: emails, chats, document creations, meeting attendances, transactions. Rendered as `<mvk-timeline-canvas>` with day-grouped events, kind filters, and a star toggle for key moments. Each interaction is a chain-hashed tool call when the host wires it.

This is the **load-bearing investigation surface**. The chat box reconstructs; the canvas lets the human refine. Same registry layer underneath — the events come from a `reconstructTimeline` tool, the star/open events flow back through the orchestrator's chain-hash.

## 1. Reconstruct the timeline

A typical host-side reconstruction tool:

```ts
import { agenticTool } from '@infra-tools/agentic-ui';
import { z } from 'zod';

agenticTool({
  name: 'reconstructTimeline',
  description: 'Build a chronological timeline for a custodian + date range.',
  schema: z.object({
    custodianId: z.string(),
    from: z.string(),       // ISO date
    to: z.string(),
  }),
  handler: async (args, ctx) => {
    // Merge events from every relevant source. Each source is whatever
    // your data layer exposes (REST, GraphQL, doc index, etc).
    const [emails, chats, docs, meetings, transactions] = await Promise.all([
      emailsForCustodian(args),
      chatsForCustodian(args),
      docsForCustodian(args),
      meetingsForCustodian(args),
      transactionsForCustodian(args),
    ]);
    return [
      ...emails.map((e) => ({
        id: e.id, kind: 'email' as const,
        title: e.subject, actor: e.from, at: e.sentAt,
        summary: e.previewText,
        tags: e.tags,
      })),
      ...chats.map((c) => ({
        id: c.id, kind: 'chat' as const,
        title: c.channel, actor: c.author, at: c.postedAt,
        summary: c.body.slice(0, 140),
      })),
      ...docs.map((d) => ({
        id: d.id, kind: 'doc' as const,
        title: d.filename, actor: d.creator, at: d.createdAt,
        summary: `${d.fileType} · ${d.sizeBytes}b`,
      })),
      ...meetings.map((m) => ({
        id: m.id, kind: 'meeting' as const,
        title: m.title, actor: m.organiser, at: m.startsAt,
        summary: m.attendees.join(', '),
      })),
      ...transactions.map((t) => ({
        id: t.id, kind: 'transaction' as const,
        title: t.description, actor: t.party, at: t.timestamp,
        summary: `${t.currency} ${t.amount}`,
      })),
    ];
  },
});
```

The tool returns a `TimelineEvent[]`. The canvas takes it from there.

## 2. Drop the canvas on a route

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { TimelineCanvasComponent, type TimelineEvent, type TimelineKeyMomentToggle } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-timeline-page',
  imports: [TimelineCanvasComponent],
  template: `
    <mvk-timeline-canvas
      [events]="events()"
      [title]="custodian()?.name + ' — ' + dateRange()"
      [subtitle]="subtitle()"
      (open)="onOpenEvent($event)"
      (toggleKey)="onToggleKey($event)"
      (filterChange)="store.setActiveKinds($event.kinds)" />
  `,
})
class TimelinePage {
  private readonly store = inject(TimelineStore);
  private readonly chat = injectAgenticChat();

  readonly events = this.store.events;
  readonly custodian = this.store.custodian;
  readonly dateRange = computed(() => `${this.store.from()} → ${this.store.to()}`);
  readonly subtitle = computed(() => `${this.events().length} events · ${this.store.activeKinds().length || 'all'} kinds`);

  onOpenEvent({ eventId }: { eventId: string }): void {
    // Open the underlying record in a sister route (email viewer, doc preview, etc).
    this.router.navigate(['/timeline', eventId]);
  }

  onToggleKey(t: TimelineKeyMomentToggle): void {
    // Chain-hash the toggle as a tool call so audit captures who marked what.
    this.chat.sendMessage(
      `markKeyMoment ${t.eventId} ${t.nextValue ? 'true' : 'false'}`,
    );
    this.store.markKey(t.eventId, t.nextValue);
  }
}
```

## 3. What the canvas does on its own

- **Groups events by calendar day**, ascending. Within a day, events render chronologically.
- **Generates filter chips per distinct event `kind`**, in first-seen order, with per-kind counts.
- **Click a kind chip** → toggles that kind in the filter. Multi-select supported. Empty filter = show all.
- **Click "All"** → clears the filter (shows everything).
- **Star toggle** per event for key moments. The host writes back the new `keyMoment` value via `(toggleKey)`.
- **Click event body** → emits `(open)` with the event id. Host navigates to the record.
- **Key-moment events** render with a yellow background so reviewers visually scan the highlights.
- **Per-kind colour coding** on kind chips (email red, chat green, doc indigo, meeting amber, transaction fuchsia — overridable via CSS).

## 4. The "agent uses the timeline" property

Once events are in the timeline, the chat can read them. Two patterns:

**A — Reconstruct on demand.** *"Show me what happened in the week after the M-117 hold issued."* → chat calls `reconstructTimeline` with the date range → renders the canvas in a sister surface or the workspace.

**B — Cross-reference into other surfaces.** *"Find the email Sarah sent after the Q3 board meeting where transaction T-44492 was discussed."* → chat reads the timeline events, finds the meeting, finds the closest email after, returns the email id → the user clicks it from the chat transcript and lands in the email viewer.

Both patterns use the same `reconstructTimeline` tool the canvas displays. No separate reconciliation logic — the timeline is the substrate the agent and the user share.

## 5. Composing with the other 9 P0/P1/P2/P3/P4 surfaces

- **`<mvk-cmd-k-palette>` (P1.1)** — *"Build timeline for Sarah Chen, last 90 days"* compiles to a `reconstructTimeline` invocation.
- **`<mvk-bulk-toolbar>` (P1.4)** — when the user multi-selects timeline events, surfaces *"Mark all as key"*, *"Generate narrative"*, *"Export to PDF"*.
- **`<mvk-assist-panel>` (P1.5)** — on a custodian profile route, suggests *"Open 90-day timeline"* as a next-best-action.
- **`<mvk-notification-tray>` + `<mvk-inbox>` (P2)** — a `TriggerRegistry` cron flagging *"3 new key documents added to Sarah's matter since last review"* surfaces here.
- **`<mvk-lifecycle-stages>` (P2.4)** — the timeline is one stage of an investigation lifecycle (*Collect → Reconstruct timeline → Identify key moments → Interview prep*).
- **`<mvk-dashboard-canvas>` (P3.A)** — *"Timeline depth"* tile surfaces a count of timeline events per active matter; drill-down opens the timeline.
- **`<mvk-review-queue>` (P4.A)** — items in the queue can drill into a timeline focused on the custodian they implicate.

Same registry layer underneath. Same persona scope. Same chain-hash audit. **Ten composable surfaces, one workflow.**

## 6. Reference

- **Component:** `<mvk-timeline-canvas [events] [title] [subtitle] (open) (toggleKey) (filterChange) />`
- **Types:** `TimelineEvent`, `TimelineEventKind`, `TimelineKeyMomentToggle`, `TimelineEventOpen`, `TimelineFilterChange`
- **Tests:** 14 specs covering empty state, day-grouping ascending + intra-day chronological, title rendering, distinct-kind chip generation, "All" + per-kind chip filter behaviour, multi-select chips, filterChange emission with active kinds, empty-state when every event filters out, star starred/unstarred classes, toggleKey emit with `nextValue`, key-moment row class, event body click emits open, kind chip + actor + tags rendering
- **Plan:** [post-chat-surfaces-plan §4 Workflow D](../plans/post-chat-surfaces-plan.md#4-complex-workflows-worth-modelling)
- **Related:**
  - [Multi-reviewer review queue](./review-queue.md) — items often drill into custodian timelines
  - [Live + drillable dashboards](./live-dashboards.md) — tiles can drill-down to a timeline
  - [Lifecycle stages](./lifecycle-stages.md) — the timeline is typically one stage of an investigation lifecycle
