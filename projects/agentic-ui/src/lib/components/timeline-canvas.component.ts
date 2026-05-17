import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

/**
 * Built-in event kinds modelled on the eDiscovery investigation
 * scenario. The component accepts any string — the union is a hint,
 * not a constraint.
 */
export type TimelineEventKind = 'email' | 'chat' | 'doc' | 'meeting' | 'transaction' | string;

/** One event on the timeline. */
export interface TimelineEvent {
  readonly id: string;
  readonly kind: TimelineEventKind;
  readonly title: string;
  /** ISO timestamp; the component groups events by calendar date. */
  readonly at: string;
  readonly actor?: string;
  readonly summary?: string;
  readonly keyMoment?: boolean;
  readonly tags?: readonly string[];
}

/** Emitted when the user toggles an event's key-moment flag. */
export interface TimelineKeyMomentToggle {
  readonly eventId: string;
  readonly nextValue: boolean;
}

/** Emitted when the user clicks the body of an event for drill-down. */
export interface TimelineEventOpen {
  readonly eventId: string;
}

/** Emitted when the kind filter chip set changes. */
export interface TimelineFilterChange {
  /** Active kinds — empty array means "show all kinds". */
  readonly kinds: readonly TimelineEventKind[];
}

/**
 * Investigation timeline canvas — Workflow D from
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Renders an agent-reconstructed sequence of events (emails, chats,
 * documents, meetings, transactions) grouped by calendar date.
 * Filter chips at the top toggle which kinds are visible; star
 * affordance on each event toggles its key-moment flag. Click
 * the event body to drill in.
 *
 * Presentation-only — the host provides the event list (typically
 * built from a `TimelineEvent[]` returned by a `reconstructTimeline`
 * tool), receives toggle / open events, and writes back to its store.
 *
 * @example
 * ```html
 * <mvk-timeline-canvas
 *   [events]="events()"
 *   [title]="custodian().name + ' — 90-day timeline'"
 *   (toggleKey)="onToggleKey($event)"
 *   (open)="onOpenEvent($event)"
 *   (filterChange)="store.setActiveKinds($event.kinds)" />
 * ```
 */
@Component({
  selector: 'mvk-timeline-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="timeline" aria-label="Timeline">
      <header class="head">
        <hgroup>
          <h2 class="title">{{ title() || 'Timeline' }}</h2>
          @if (subtitle()) {
            <p class="subtitle">{{ subtitle() }}</p>
          }
        </hgroup>

        @if (kinds().length > 0) {
          <nav class="filter-chips" aria-label="Filter by event kind">
            <button
              type="button"
              class="chip"
              [class.active]="activeKinds().length === 0"
              (click)="clearFilter()">
              All ({{ events().length }})
            </button>
            @for (k of kinds(); track k) {
              <button
                type="button"
                class="chip"
                [class.active]="isKindActive(k)"
                [attr.data-kind]="k"
                (click)="toggleKind(k)">
                {{ k }} ({{ countForKind(k) }})
              </button>
            }
          </nav>
        }
      </header>

      @if (groupsToShow().length === 0) {
        <p class="empty">No events match the current filter.</p>
      } @else {
        <ol class="days" role="list">
          @for (day of groupsToShow(); track day.label) {
            <li class="day">
              <header class="day-head">
                <time class="day-label" [attr.datetime]="day.iso">{{ day.label }}</time>
                <span class="day-count">{{ day.events.length }} event(s)</span>
              </header>
              <ul class="event-list" role="list">
                @for (ev of day.events; track ev.id) {
                  <li
                    class="event"
                    [class.key]="ev.keyMoment"
                    [attr.data-kind]="ev.kind">
                    <button
                      type="button"
                      class="star"
                      [class.starred]="ev.keyMoment"
                      [attr.aria-label]="(ev.keyMoment ? 'Unmark' : 'Mark') + ' as key moment'"
                      [attr.aria-pressed]="ev.keyMoment"
                      (click)="onToggleKey(ev)">★</button>
                    <button
                      type="button"
                      class="event-body"
                      [attr.aria-label]="'Open ' + ev.title"
                      (click)="onOpen(ev)">
                      <header class="event-head">
                        <span class="kind-chip" [attr.data-kind]="ev.kind">{{ ev.kind }}</span>
                        <span class="event-title">{{ ev.title }}</span>
                        @if (ev.actor) {
                          <span class="actor">— {{ ev.actor }}</span>
                        }
                        <time class="event-ts" [attr.datetime]="ev.at">{{ formatTime(ev.at) }}</time>
                      </header>
                      @if (ev.summary) {
                        <p class="summary">{{ ev.summary }}</p>
                      }
                      @if (ev.tags && ev.tags.length > 0) {
                        <ul class="tags" role="list">
                          @for (t of ev.tags; track t) {
                            <li class="tag">{{ t }}</li>
                          }
                        </ul>
                      }
                    </button>
                  </li>
                }
              </ul>
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; }
    .timeline { padding: 1rem 1.2rem; max-width: 920px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; margin-bottom: 1rem; flex-wrap: wrap; }
    hgroup { margin: 0; }
    .title { margin: 0; font-size: 1.25rem; font-weight: 700; color: #111827; }
    .subtitle { margin: 0.15rem 0 0; color: #6b7280; font-size: 0.85rem; }
    .filter-chips { display: flex; gap: 0.3rem; flex-wrap: wrap; }
    .chip {
      padding: 0.3rem 0.7rem; font: inherit; font-size: 0.75rem; font-weight: 600;
      background: white; color: #4b5563; border: 1px solid #e5e7eb;
      border-radius: 999px; cursor: pointer;
    }
    .chip:hover { background: #f5f3ff; }
    .chip.active { background: #4338ca; color: white; border-color: #4338ca; }
    .chip:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .empty { text-align: center; padding: 3rem 1rem; color: #6b7280; }
    .days { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1rem; }
    .day { border-left: 2px solid #e5e7eb; padding-left: 0.9rem; position: relative; }
    .day::before {
      content: ''; position: absolute; left: -5px; top: 0.4rem;
      width: 8px; height: 8px; border-radius: 50%; background: #6366f1;
    }
    .day-head { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.5rem; }
    .day-label { font-weight: 700; color: #111827; font-size: 0.9rem; }
    .day-count { color: #6b7280; font-size: 0.75rem; }
    .event-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .event {
      display: grid; grid-template-columns: 1.6rem 1fr; gap: 0.5rem;
      align-items: start;
      background: #fafafa; border: 1px solid #e5e7eb;
      border-radius: 0.4rem; padding: 0.55rem 0.7rem;
    }
    .event.key { background: #fef9c3; border-color: #facc15; }
    .star {
      width: 1.6rem; height: 1.6rem; padding: 0;
      background: transparent; border: 0; cursor: pointer;
      color: #9ca3af; font-size: 1.05rem; border-radius: 0.25rem;
    }
    .star:hover { background: #e5e7eb; }
    .star.starred { color: #d97706; }
    .star:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .event-body {
      background: transparent; border: 0; padding: 0;
      text-align: left; cursor: pointer; font: inherit; min-width: 0;
      display: flex; flex-direction: column; gap: 0.2rem;
    }
    .event-body:hover .event-title { text-decoration: underline; }
    .event-body:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; border-radius: 0.3rem; }
    .event-head { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
    .kind-chip {
      padding: 0.05rem 0.4rem; border-radius: 999px;
      background: #eef2ff; color: #4338ca;
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
    }
    .kind-chip[data-kind="email"] { background: #fee2e2; color: #991b1b; }
    .kind-chip[data-kind="chat"] { background: #dcfce7; color: #166534; }
    .kind-chip[data-kind="doc"] { background: #e0e7ff; color: #3730a3; }
    .kind-chip[data-kind="meeting"] { background: #fef3c7; color: #92400e; }
    .kind-chip[data-kind="transaction"] { background: #fae8ff; color: #86198f; }
    .event-title { font-weight: 600; color: #111827; font-size: 0.9rem; }
    .actor { color: #6b7280; font-size: 0.8rem; }
    .event-ts { color: #9ca3af; font-size: 0.75rem; margin-left: auto; }
    .summary { margin: 0; color: #4b5563; font-size: 0.83rem; line-height: 1.4; }
    .tags { list-style: none; margin: 0.2rem 0 0; padding: 0; display: flex; gap: 0.25rem; flex-wrap: wrap; }
    .tag {
      padding: 0.05rem 0.45rem; border-radius: 999px;
      background: #ede9fe; color: #5b21b6;
      font-size: 0.65rem; font-weight: 500;
    }
  `,
})
export class TimelineCanvasComponent {
  /** Events to render. */
  readonly events = input.required<readonly TimelineEvent[]>();

  /** Optional title (e.g. `'Sarah Chen — 90-day timeline'`). */
  readonly title = input<string | undefined>(undefined);

  /** Optional subtitle (date range, custodian summary, ...). */
  readonly subtitle = input<string | undefined>(undefined);

  /** Click an event body → host opens the underlying record. */
  readonly open = output<TimelineEventOpen>();

  /** Click the star → host writes back the new `keyMoment` value. */
  readonly toggleKey = output<TimelineKeyMomentToggle>();

  /** Active kinds changed (filter chip click). Empty = show all. */
  readonly filterChange = output<TimelineFilterChange>();

  /** Internal active-kinds state — empty array means "all visible". */
  protected readonly activeKinds = signal<readonly TimelineEventKind[]>([]);

  /** Distinct kinds present in the event list, in their first-seen order. */
  protected readonly kinds = computed<readonly TimelineEventKind[]>(() => {
    const seen = new Set<TimelineEventKind>();
    const out: TimelineEventKind[] = [];
    for (const ev of this.events()) {
      if (!seen.has(ev.kind)) {
        seen.add(ev.kind);
        out.push(ev.kind);
      }
    }
    return out;
  });

  /** Total count per kind, used in the chip labels. */
  protected countForKind(kind: TimelineEventKind): number {
    return this.events().filter((ev) => ev.kind === kind).length;
  }

  protected isKindActive(kind: TimelineEventKind): boolean {
    return this.activeKinds().includes(kind);
  }

  /** Events after the active-kinds filter applies (empty filter = show all). */
  private readonly filteredEvents = computed<readonly TimelineEvent[]>(() => {
    const active = this.activeKinds();
    if (active.length === 0) return this.events();
    const set = new Set(active);
    return this.events().filter((ev) => set.has(ev.kind));
  });

  /** Events grouped by calendar date, day-sorted ascending. */
  protected readonly groupsToShow = computed<readonly { iso: string; label: string; events: readonly TimelineEvent[] }[]>(() => {
    const byDay = new Map<string, TimelineEvent[]>();
    for (const ev of this.filteredEvents()) {
      const iso = dayIsoOf(ev.at);
      const bucket = byDay.get(iso) ?? [];
      bucket.push(ev);
      byDay.set(iso, bucket);
    }
    const days = Array.from(byDay.keys()).sort();   // ascending
    return days.map((iso) => ({
      iso,
      label: formatDayLabel(iso),
      // events within a day: chronological order
      events: (byDay.get(iso) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at)),
    }));
  });

  protected toggleKind(kind: TimelineEventKind): void {
    this.activeKinds.update((cur) => {
      const next = cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind];
      this.filterChange.emit({ kinds: next });
      return next;
    });
  }

  protected clearFilter(): void {
    this.activeKinds.set([]);
    this.filterChange.emit({ kinds: [] });
  }

  protected onOpen(ev: TimelineEvent): void {
    this.open.emit({ eventId: ev.id });
  }

  protected onToggleKey(ev: TimelineEvent): void {
    this.toggleKey.emit({ eventId: ev.id, nextValue: !ev.keyMoment });
  }

  protected formatTime(iso: string): string {
    const ts = Date.parse(iso);
    if (isNaN(ts)) return '';
    const date = new Date(ts);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
}

/** "2026-04-12" — the calendar day, in the event's local timezone. */
function dayIsoOf(iso: string): string {
  const ts = Date.parse(iso);
  if (isNaN(ts)) return '0000-00-00';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** "Sunday · Apr 12, 2026" */
function formatDayLabel(iso: string): string {
  const ts = Date.parse(iso);
  if (isNaN(ts)) return iso;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
