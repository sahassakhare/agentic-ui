import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  NotificationTrayComponent,
  type TrayNotification,
} from './notification-tray.component';

function makeNotification(
  id: string,
  overrides: Partial<TrayNotification> = {},
): TrayNotification {
  return {
    id,
    draft: { title: `Notification ${id}`, body: `body for ${id}`, severity: 'info' },
    firedAt: new Date().toISOString(),
    firedBy: 'paralegal',
    read: false,
    origin: `trg-${id}`,
    ...overrides,
  };
}

@Component({
  imports: [NotificationTrayComponent],
  template: `
    <mvk-notification-tray
      [notifications]="notifications()"
      (activate)="activated.push($event)"
      (markRead)="readIds.push($event)"
      (markAllRead)="onMarkAll()" />
  `,
})
class HostComponent {
  notifications: WritableSignal<readonly TrayNotification[]> = signal([]);
  activated: TrayNotification[] = [];
  readIds: string[] = [];
  markAllCalls = 0;
  onMarkAll(): void { this.markAllCalls++; }
}

function setup(initial: readonly TrayNotification[] = []): ComponentFixture<HostComponent> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.notifications.set(initial);
  fixture.detectChanges();
  return fixture;
}

function bell(fixture: ComponentFixture<HostComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button.bell') as HTMLButtonElement;
}

// ── bell + badge ─────────────────────────────────────────────────

describe('NotificationTrayComponent — bell + unread badge', () => {
  beforeEach(() => undefined);

  it('hides the badge when there are zero unread', () => {
    const fixture = setup([makeNotification('a', { read: true })]);
    expect(fixture.nativeElement.querySelector('.badge')).toBeNull();
  });

  it('shows the unread count in the badge', () => {
    const fixture = setup([
      makeNotification('a', { read: false }),
      makeNotification('b', { read: false }),
      makeNotification('c', { read: true }),
    ]);
    expect(fixture.nativeElement.querySelector('.badge')?.textContent?.trim()).toBe('2');
  });

  it('renders "99+" when unread count exceeds 99', () => {
    const items = Array.from({ length: 105 }, (_, i) => makeNotification(`n-${i}`));
    const fixture = setup(items);
    expect(fixture.nativeElement.querySelector('.badge')?.textContent?.trim()).toBe('99+');
  });
});

// ── dropdown open/close ──────────────────────────────────────────

describe('NotificationTrayComponent — open/close', () => {
  beforeEach(() => undefined);

  it('opens the dropdown on bell click', () => {
    const fixture = setup([makeNotification('a')]);
    expect(fixture.nativeElement.querySelector('.dropdown')).toBeNull();
    bell(fixture).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dropdown')).not.toBeNull();
  });

  it('toggles closed on second bell click', () => {
    const fixture = setup([makeNotification('a')]);
    bell(fixture).click();
    fixture.detectChanges();
    bell(fixture).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dropdown')).toBeNull();
  });

  it('closes on outside click', () => {
    const fixture = setup([makeNotification('a')]);
    bell(fixture).click();
    fixture.detectChanges();

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dropdown')).toBeNull();
    outside.remove();
  });

  it('closes on global Escape', () => {
    const fixture = setup([makeNotification('a')]);
    bell(fixture).click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dropdown')).toBeNull();
  });
});

// ── dropdown content ─────────────────────────────────────────────

describe('NotificationTrayComponent — dropdown rows', () => {
  beforeEach(() => undefined);

  it('renders empty-state when no notifications', () => {
    const fixture = setup([]);
    bell(fixture).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.empty')?.textContent?.trim()).toBe('Nothing new.');
  });

  it('renders one item per notification with title + body', () => {
    const fixture = setup([
      makeNotification('a', { draft: { title: 'Alpha', body: 'first' } }),
      makeNotification('b', { draft: { title: 'Beta',  body: 'second' } }),
    ]);
    bell(fixture).click();
    fixture.detectChanges();
    const titles = Array.from(fixture.nativeElement.querySelectorAll('.item .item-header .title')).map(
      (el) => (el as HTMLElement).textContent?.trim(),
    );
    expect(titles).toEqual(['Alpha', 'Beta']);
  });

  it('applies severity-coded dot per item', () => {
    const fixture = setup([
      makeNotification('a', { draft: { title: 't', severity: 'info' } }),
      makeNotification('b', { draft: { title: 't', severity: 'warning' } }),
      makeNotification('c', { draft: { title: 't', severity: 'error' } }),
    ]);
    bell(fixture).click();
    fixture.detectChanges();
    const dots = Array.from(fixture.nativeElement.querySelectorAll('.dot')).map((el) =>
      (el as HTMLElement).getAttribute('data-severity'),
    );
    expect(dots).toEqual(['info', 'warning', 'error']);
  });

  it('flags unread items with the unread class', () => {
    const fixture = setup([
      makeNotification('a', { read: false }),
      makeNotification('b', { read: true }),
    ]);
    bell(fixture).click();
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('.item');
    expect(items[0]?.classList.contains('unread')).toBe(true);
    expect(items[1]?.classList.contains('unread')).toBe(false);
  });

  it('shows the "Mark all read" button only when there are unread items', () => {
    const fixture = setup([makeNotification('a', { read: true })]);
    bell(fixture).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mark-all')).toBeNull();

    fixture.componentInstance.notifications.set([makeNotification('a', { read: false })]);
    fixture.detectChanges();
    bell(fixture).click();        // toggle to apply new state
    bell(fixture).click();        // and re-open
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mark-all')).not.toBeNull();
  });
});

// ── dispatch ─────────────────────────────────────────────────────

describe('NotificationTrayComponent — dispatch', () => {
  beforeEach(() => undefined);

  it('emits activate on item click and marks read via markRead', () => {
    const fixture = setup([makeNotification('a', { read: false })]);
    bell(fixture).click();
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('.item') as HTMLElement;
    item.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.activated).toHaveLength(1);
    expect(fixture.componentInstance.activated[0]?.id).toBe('a');
    expect(fixture.componentInstance.readIds).toEqual(['a']);
  });

  it('does not re-emit markRead when activating an already-read item', () => {
    const fixture = setup([makeNotification('a', { read: true })]);
    bell(fixture).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.item') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.readIds).toEqual([]);
  });

  it('emits markAllRead when "Mark all read" is clicked', () => {
    const fixture = setup([makeNotification('a', { read: false })]);
    bell(fixture).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.mark-all') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.markAllCalls).toBe(1);
  });

  it('closes the dropdown after activating an item', () => {
    const fixture = setup([makeNotification('a')]);
    bell(fixture).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.item') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dropdown')).toBeNull();
  });

  it('Enter key on a focused item activates it', () => {
    const fixture = setup([makeNotification('a')]);
    bell(fixture).click();
    fixture.detectChanges();
    const item = fixture.nativeElement.querySelector('.item') as HTMLElement;
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activated).toHaveLength(1);
  });
});
