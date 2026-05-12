import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { InboxComponent, type InboxFilter } from './inbox.component';
import type { TrayNotification } from './notification-tray.component';

function makeNotification(
  id: string,
  overrides: Partial<TrayNotification> = {},
): TrayNotification {
  return {
    id,
    draft: { title: `Title ${id}`, body: `Body for ${id}`, severity: 'info' },
    firedAt: new Date().toISOString(),
    firedBy: 'paralegal',
    read: false,
    origin: `trg-${id}`,
    ...overrides,
  };
}

@Component({
  imports: [InboxComponent],
  template: `
    <mvk-inbox
      [notifications]="notifications()"
      [initialFilter]="initialFilter()"
      (activate)="activated.push($event)"
      (markRead)="readIds.push($event)"
      (markAllRead)="onMarkAll()"
      (clearRead)="onClearRead()" />
  `,
})
class HostComponent {
  notifications: WritableSignal<readonly TrayNotification[]> = signal([]);
  initialFilter: WritableSignal<InboxFilter> = signal('unread');
  activated: TrayNotification[] = [];
  readIds: string[] = [];
  markAllCalls = 0;
  clearReadCalls = 0;
  onMarkAll(): void { this.markAllCalls++; }
  onClearRead(): void { this.clearReadCalls++; }
}

async function setup(
  initial: readonly TrayNotification[] = [],
  initialFilter: InboxFilter = 'unread',
): Promise<ComponentFixture<HostComponent>> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.notifications.set(initial);
  fixture.componentInstance.initialFilter.set(initialFilter);
  fixture.detectChanges();
  // Inbox hydrates its filter from initialFilter on a microtask.
  await Promise.resolve();
  fixture.detectChanges();
  return fixture;
}

function items(fixture: ComponentFixture<HostComponent>): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('li.item')) as HTMLElement[];
}

function filterBtn(fixture: ComponentFixture<HostComponent>, label: 'unread' | 'all'): HTMLButtonElement {
  const buttons = Array.from(
    fixture.nativeElement.querySelectorAll('button.filter-btn'),
  ) as HTMLButtonElement[];
  const match = buttons.find((b) => b.textContent?.trim().toLowerCase().startsWith(label));
  if (!match) throw new Error(`Filter button "${label}" not found`);
  return match;
}

// ── counts + empty state ───────────────────────────────────────────

describe('InboxComponent — counts + empty state', () => {
  beforeEach(() => undefined);

  it('shows zero unread / zero total in the empty state', async () => {
    const fixture = await setup([]);
    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain('No unread');
  });

  it('uses different empty copy under the "all" filter', async () => {
    const fixture = await setup([], 'all');
    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain('Inbox is empty');
  });

  it('renders the unread/total counts in the header', async () => {
    const fixture = await setup([
      makeNotification('a', { read: false }),
      makeNotification('b', { read: true }),
      makeNotification('c', { read: false }),
    ]);
    const counts = Array.from(fixture.nativeElement.querySelectorAll('.count')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(counts).toContain('2 unread');
    expect(counts.some((c) => c?.includes('3 total'))).toBe(true);
  });
});

// ── filter (unread / all) ──────────────────────────────────────────

describe('InboxComponent — filter', () => {
  beforeEach(() => undefined);

  it('starts with the "unread" filter by default', async () => {
    const fixture = await setup([
      makeNotification('a', { read: false }),
      makeNotification('b', { read: true }),
    ]);
    expect(items(fixture)).toHaveLength(1);
    expect(items(fixture)[0]?.textContent).toContain('Title a');
  });

  it('honours initialFilter="all" when provided', async () => {
    const fixture = await setup(
      [makeNotification('a', { read: false }), makeNotification('b', { read: true })],
      'all',
    );
    expect(items(fixture)).toHaveLength(2);
  });

  it('switches to all filter on click and re-filters list', async () => {
    const fixture = await setup([
      makeNotification('a', { read: false }),
      makeNotification('b', { read: true }),
    ]);
    expect(items(fixture)).toHaveLength(1);

    filterBtn(fixture, 'all').click();
    fixture.detectChanges();

    expect(items(fixture)).toHaveLength(2);
  });

  it('switches back to unread filter on click', async () => {
    const fixture = await setup(
      [makeNotification('a', { read: false }), makeNotification('b', { read: true })],
      'all',
    );
    expect(items(fixture)).toHaveLength(2);

    filterBtn(fixture, 'unread').click();
    fixture.detectChanges();
    expect(items(fixture)).toHaveLength(1);
  });

  it('flags the active filter with the .active class', async () => {
    const fixture = await setup([makeNotification('a')]);
    expect(filterBtn(fixture, 'unread').classList.contains('active')).toBe(true);
    expect(filterBtn(fixture, 'all').classList.contains('active')).toBe(false);

    filterBtn(fixture, 'all').click();
    fixture.detectChanges();
    expect(filterBtn(fixture, 'all').classList.contains('active')).toBe(true);
    expect(filterBtn(fixture, 'unread').classList.contains('active')).toBe(false);
  });
});

// ── item rendering ─────────────────────────────────────────────────

describe('InboxComponent — item rendering', () => {
  beforeEach(() => undefined);

  it('renders title + body + firedBy + origin per item', async () => {
    const fixture = await setup(
      [
        makeNotification('a', {
          draft: { title: 'Hold ack due', body: 'C-117 has 2 days left', severity: 'warning' },
          firedBy: 'paralegal',
          origin: 'trg-daily-ack-check',
        }),
      ],
      'all',
    );
    const item = items(fixture)[0]!;
    expect(item.querySelector('.item-title')?.textContent?.trim()).toBe('Hold ack due');
    expect(item.querySelector('.body')?.textContent?.trim()).toBe('C-117 has 2 days left');
    expect(item.querySelector('.attribution')?.textContent).toContain('paralegal');
    expect(item.querySelector('.origin')?.textContent).toBe('trg-daily-ack-check');
  });

  it('encodes severity in the dot data attribute', async () => {
    const fixture = await setup(
      [
        makeNotification('a', { draft: { title: 't', severity: 'error' } }),
        makeNotification('b', { draft: { title: 't', severity: 'info' } }),
      ],
      'all',
    );
    const dots = Array.from(fixture.nativeElement.querySelectorAll('.dot')).map((el) =>
      (el as HTMLElement).getAttribute('data-severity'),
    );
    expect(dots).toEqual(['error', 'info']);
  });

  it('shows a cta button when draft.cta is set', async () => {
    const fixture = await setup(
      [
        makeNotification('a', {
          draft: {
            title: 't',
            cta: { kind: 'route', target: '/holds/H-1' },
          },
        }),
      ],
      'all',
    );
    expect(fixture.nativeElement.querySelector('.cta-btn')?.textContent?.trim()).toBe('Open');
  });

  it('cta label adapts to mapsTo kind', async () => {
    const fixture = await setup(
      [
        makeNotification('a', { draft: { title: 't', cta: { kind: 'route', target: '/x' } } }),
        makeNotification('b', { draft: { title: 't', cta: { kind: 'action', action: 'doX' } } }),
        makeNotification('c', { draft: { title: 't', cta: { kind: 'tool', tool: 'runX' } } }),
      ],
      'all',
    );
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.cta-btn')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(labels).toEqual(['Open', 'Run', 'Invoke']);
  });
});

// ── dispatch ───────────────────────────────────────────────────────

describe('InboxComponent — dispatch', () => {
  beforeEach(() => undefined);

  it('clicking an item emits activate + markRead (when unread)', async () => {
    const fixture = await setup([makeNotification('a', { read: false })]);
    items(fixture)[0]?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.activated).toHaveLength(1);
    expect(fixture.componentInstance.activated[0]?.id).toBe('a');
    expect(fixture.componentInstance.readIds).toEqual(['a']);
  });

  it('does not re-emit markRead for an already-read item', async () => {
    const fixture = await setup([makeNotification('a', { read: true })], 'all');
    items(fixture)[0]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.activated).toHaveLength(1);
    expect(fixture.componentInstance.readIds).toEqual([]);
  });

  it('cta button click activates without bubbling into the row click', async () => {
    const fixture = await setup(
      [
        makeNotification('a', {
          read: false,
          draft: { title: 't', cta: { kind: 'route', target: '/x' } },
        }),
      ],
      'all',
    );
    (fixture.nativeElement.querySelector('.cta-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.activated).toHaveLength(1);
    expect(fixture.componentInstance.readIds).toEqual(['a']);
  });

  it('mark-all-read button emits markAllRead', async () => {
    const fixture = await setup([makeNotification('a', { read: false })]);
    const btn = Array.from(fixture.nativeElement.querySelectorAll('.action-btn')).find((b) =>
      (b as HTMLElement).textContent?.trim() === 'Mark all read',
    ) as HTMLButtonElement | undefined;
    expect(btn).not.toBeUndefined();
    btn?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.markAllCalls).toBe(1);
  });

  it('clear-read button emits clearRead', async () => {
    const fixture = await setup(
      [
        makeNotification('a', { read: true }),
        makeNotification('b', { read: false }),
      ],
      'all',
    );
    const btn = Array.from(fixture.nativeElement.querySelectorAll('.action-btn')).find((b) =>
      (b as HTMLElement).textContent?.trim() === 'Clear read',
    ) as HTMLButtonElement | undefined;
    expect(btn).not.toBeUndefined();
    btn?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.clearReadCalls).toBe(1);
  });

  it('Enter key on a focused item activates it', async () => {
    const fixture = await setup([makeNotification('a')]);
    const item = items(fixture)[0]!;
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activated).toHaveLength(1);
  });
});
