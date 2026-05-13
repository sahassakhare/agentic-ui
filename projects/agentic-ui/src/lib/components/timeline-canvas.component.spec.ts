import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  TimelineCanvasComponent,
  type TimelineEvent,
  type TimelineEventOpen,
  type TimelineFilterChange,
  type TimelineKeyMomentToggle,
} from './timeline-canvas.component';

function event(id: string, at: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id,
    kind: 'email',
    title: `Event ${id}`,
    at,
    actor: 'Sarah Chen',
    summary: `summary for ${id}`,
    ...overrides,
  };
}

@Component({
  imports: [TimelineCanvasComponent],
  template: `
    <mvk-timeline-canvas
      [events]="events()"
      [title]="title()"
      (open)="opens.push($event)"
      (toggleKey)="toggles.push($event)"
      (filterChange)="filterChanges.push($event)" />
  `,
})
class HostComponent {
  events: WritableSignal<readonly TimelineEvent[]> = signal([]);
  title: WritableSignal<string | undefined> = signal('Timeline');
  opens: TimelineEventOpen[] = [];
  toggles: TimelineKeyMomentToggle[] = [];
  filterChanges: TimelineFilterChange[] = [];
}

function setup(initial: Partial<HostComponent> = {}): ComponentFixture<HostComponent> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  for (const [k, v] of Object.entries(initial)) {
    const sig = (fixture.componentInstance as unknown as Record<string, WritableSignal<unknown>>)[k];
    if (typeof sig === 'function' && 'set' in (sig as object)) {
      (sig as WritableSignal<unknown>).set(v);
    }
  }
  fixture.detectChanges();
  return fixture;
}

function dayEls(fixture: ComponentFixture<HostComponent>): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('li.day')) as HTMLElement[];
}

function evEls(fixture: ComponentFixture<HostComponent>): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('li.event')) as HTMLElement[];
}

// ── empty / day grouping ─────────────────────────────────────────

describe('TimelineCanvasComponent — grouping', () => {
  beforeEach(() => undefined);

  it('shows empty state when events is empty', () => {
    const fixture = setup({});
    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain(
      'No events match',
    );
  });

  it('groups events by calendar day in ascending date order', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z'),
        event('b', '2026-04-13T14:00:00Z'),
        event('c', '2026-04-12T17:30:00Z'),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    const days = dayEls(fixture);
    expect(days).toHaveLength(2);

    // Within a day, events are chronological.
    const firstDayEventIds = Array.from(days[0]!.querySelectorAll('.event'))
      .map((el) => (el as HTMLElement).querySelector('.event-title')?.textContent?.trim());
    expect(firstDayEventIds).toEqual(['Event a', 'Event c']);
  });

  it('renders the title in the header when supplied', () => {
    const fixture = setup({
      events: [event('a', '2026-04-12T09:00:00Z')] as unknown as WritableSignal<readonly TimelineEvent[]>,
      title: 'Sarah Chen — 90-day timeline' as unknown as WritableSignal<string>,
    });
    expect(fixture.nativeElement.querySelector('.title')?.textContent?.trim()).toBe(
      'Sarah Chen — 90-day timeline',
    );
  });
});

// ── filter chips ─────────────────────────────────────────────────

describe('TimelineCanvasComponent — kind filter chips', () => {
  beforeEach(() => undefined);

  it('renders one chip per distinct kind plus an "All" chip', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z', { kind: 'email' }),
        event('b', '2026-04-12T10:00:00Z', { kind: 'doc' }),
        event('c', '2026-04-12T11:00:00Z', { kind: 'email' }),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.chip')).map((el) =>
      (el as HTMLElement).textContent?.trim() ?? '',
    );
    // First chip is "All (3)", then "email (2)", "doc (1)" in first-seen order.
    expect(labels[0]).toContain('All (3)');
    expect(labels[1]).toContain('email (2)');
    expect(labels[2]).toContain('doc (1)');
  });

  it('clicking a kind chip filters events to that kind only', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z', { kind: 'email' }),
        event('b', '2026-04-12T10:00:00Z', { kind: 'doc' }),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    const emailChip = Array.from(fixture.nativeElement.querySelectorAll('.chip')).find((el) =>
      (el as HTMLElement).getAttribute('data-kind') === 'email',
    ) as HTMLButtonElement;
    emailChip.click();
    fixture.detectChanges();

    expect(evEls(fixture)).toHaveLength(1);
    expect(evEls(fixture)[0]?.textContent).toContain('Event a');
  });

  it('clicking a second kind chip extends the filter (multi-select)', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z', { kind: 'email' }),
        event('b', '2026-04-12T10:00:00Z', { kind: 'doc' }),
        event('c', '2026-04-12T11:00:00Z', { kind: 'chat' }),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    const chips = Array.from(fixture.nativeElement.querySelectorAll('.chip[data-kind]')) as HTMLButtonElement[];
    chips[0]?.click();   // email
    chips[1]?.click();   // doc
    fixture.detectChanges();
    expect(evEls(fixture)).toHaveLength(2);
  });

  it('clicking "All" clears the filter', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z', { kind: 'email' }),
        event('b', '2026-04-12T10:00:00Z', { kind: 'doc' }),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    const chips = Array.from(fixture.nativeElement.querySelectorAll('.chip')) as HTMLButtonElement[];
    chips[1]?.click();          // filter to email
    fixture.detectChanges();
    expect(evEls(fixture)).toHaveLength(1);

    chips[0]?.click();          // "All" chip — clears filter
    fixture.detectChanges();
    expect(evEls(fixture)).toHaveLength(2);
  });

  it('emits filterChange with the active kinds on every toggle + clear', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z', { kind: 'email' }),
        event('b', '2026-04-12T10:00:00Z', { kind: 'doc' }),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    const chips = Array.from(fixture.nativeElement.querySelectorAll('.chip')) as HTMLButtonElement[];
    chips[1]?.click();          // email
    fixture.detectChanges();
    expect(fixture.componentInstance.filterChanges.at(-1)?.kinds).toEqual(['email']);

    chips[0]?.click();          // All
    fixture.detectChanges();
    expect(fixture.componentInstance.filterChanges.at(-1)?.kinds).toEqual([]);
  });

  it('shows empty-state when every event filters out', () => {
    const fixture = setup({
      events: [event('a', '2026-04-12T09:00:00Z', { kind: 'email' })] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    // Toggle email off (it's the only kind) — filter active to non-existent kind.
    // Implementation: click email twice (on then off again).
    const emailChip = Array.from(fixture.nativeElement.querySelectorAll('.chip[data-kind]')) as HTMLButtonElement[];
    emailChip[0]?.click();      // active = ['email'] — still shows
    // Now we manually filter via the component (no other kinds available);
    // simulate by adding a synthetic kind that matches nothing.
    fixture.componentInstance.events.set([event('a', '2026-04-12T09:00:00Z', { kind: 'rare' })]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain('No events match');
  });
});

// ── key moment + open ────────────────────────────────────────────

describe('TimelineCanvasComponent — interactions', () => {
  beforeEach(() => undefined);

  it('renders the star as starred when keyMoment is true', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z', { keyMoment: false }),
        event('b', '2026-04-12T10:00:00Z', { keyMoment: true }),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    const stars = Array.from(fixture.nativeElement.querySelectorAll('button.star'));
    expect((stars[0] as HTMLElement).classList.contains('starred')).toBe(false);
    expect((stars[1] as HTMLElement).classList.contains('starred')).toBe(true);
  });

  it('star click emits toggleKey with the opposite nextValue', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z', { keyMoment: false }),
        event('b', '2026-04-12T10:00:00Z', { keyMoment: true }),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    const stars = Array.from(fixture.nativeElement.querySelectorAll('button.star')) as HTMLButtonElement[];
    stars[0]?.click();
    stars[1]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.toggles).toEqual([
      { eventId: 'a', nextValue: true },
      { eventId: 'b', nextValue: false },
    ]);
  });

  it('marks the event row with .key when keyMoment is true', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z', { keyMoment: true }),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    expect((evEls(fixture)[0] as HTMLElement).classList.contains('key')).toBe(true);
  });

  it('clicking the event body emits (open) with the event id', () => {
    const fixture = setup({
      events: [event('a-117', '2026-04-12T09:00:00Z')] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    (fixture.nativeElement.querySelector('.event-body') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opens).toEqual([{ eventId: 'a-117' }]);
  });

  it('renders kind chip + actor + tags when supplied', () => {
    const fixture = setup({
      events: [
        event('a', '2026-04-12T09:00:00Z', {
          kind: 'doc',
          actor: 'Sarah Chen',
          tags: ['privileged', 'finance'],
        }),
      ] as unknown as WritableSignal<readonly TimelineEvent[]>,
    });
    const ev = evEls(fixture)[0] as HTMLElement;
    expect(ev.querySelector('.kind-chip')?.getAttribute('data-kind')).toBe('doc');
    expect(ev.querySelector('.actor')?.textContent).toContain('Sarah Chen');
    const tags = Array.from(ev.querySelectorAll('.tag')).map((t) => (t as HTMLElement).textContent?.trim());
    expect(tags).toEqual(['privileged', 'finance']);
  });
});
