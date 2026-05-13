import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  TimelineCanvasComponent as MvkTimelineCanvas,
  type TimelineEvent,
  type TimelineEventOpen,
  type TimelineFilterChange,
  type TimelineKeyMomentToggle,
} from '@infra-tools/agentic-ui';

function seedTimeline(): readonly TimelineEvent[] {
  const day = (offsetHours: number) =>
    new Date(Date.now() - offsetHours * 60 * 60 * 1000).toISOString();
  return [
    { id: 'e1', kind: 'email',       title: 'Initial deal discussion', at: day(96), actor: 'jchen@acme.com', summary: 'Acme + Target exec exchange on valuation.', tags: ['custodian:jchen'] },
    { id: 'e2', kind: 'doc',         title: 'Term sheet v1 uploaded',   at: day(80), actor: 'kim@acme.com',   summary: 'Initial term sheet shared internally.' },
    { id: 'e3', kind: 'chat',        title: 'Slack — heads-up to Legal', at: day(72), actor: 'jchen@acme.com', summary: 'Mentioned the deal to outside counsel.',  keyMoment: true, tags: ['priv-candidate'] },
    { id: 'e4', kind: 'meeting',     title: 'Board call — review',      at: day(48), actor: 'board@acme.com',  summary: 'Discussed potential acquisition.' },
    { id: 'e5', kind: 'transaction', title: 'Engagement letter signed', at: day(24), actor: 'latham.com',     summary: 'Outside counsel engagement formalised.', keyMoment: true },
    { id: 'e6', kind: 'email',       title: 'Final agreement circulated', at: day(2),  actor: 'kim@acme.com',  summary: 'Definitive agreement v3.', tags: ['priv-candidate'] },
  ];
}

/**
 * `/timeline` route — Workflow D investigation timeline (post-chat-
 * surfaces P4). Renders `<mvk-timeline-canvas>` with seeded events.
 *
 * Production hosts would build the event list from a
 * `reconstructTimeline` tool call (agent reconstructs sequence from
 * the corpus); the demo seeds it so the surface lights up without an
 * agent round-trip.
 *
 * (toggleKey) writes back to the event list — same shape a host
 * store would handle. (open) drills into a detail page (here just
 * logs).
 */
@Component({
  selector: 'app-timeline-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MvkTimelineCanvas],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Workflow</p>
        <h1>Investigation timeline</h1>
        <p class="muted">
          Workflow D — agent-reconstructed sequence. Filter kinds, star key
          moments, drill into the source record.
        </p>
      </div>
    </section>
    <mvk-timeline-canvas
      [events]="events()"
      title="Acme acquisition — communication trail"
      subtitle="Last 96 hours · {{ keyCount() }} starred"
      (toggleKey)="onToggleKey($event)"
      (open)="onOpen($event)"
      (filterChange)="onFilterChange($event)" />
  `,
  styles: `
    :host { display: block; max-width: 920px; }
    .page-head { margin-bottom: var(--s-5); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
  `,
})
export class TimelinePage {
  protected readonly events = signal<readonly TimelineEvent[]>(seedTimeline());
  protected readonly keyCount = computed(() => this.events().filter((e) => e.keyMoment).length);

  protected onToggleKey(ev: TimelineKeyMomentToggle): void {
    this.events.update((arr) =>
      arr.map((e) => (e.id === ev.eventId ? { ...e, keyMoment: ev.nextValue } : e)),
    );
  }

  protected onOpen(ev: TimelineEventOpen): void {
    console.info('[timeline] open requested:', ev.eventId);
  }

  protected onFilterChange(ev: TimelineFilterChange): void {
    console.info('[timeline] filter changed:', ev.kinds);
  }
}
