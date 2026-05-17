import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { IntentRegistry, agenticIntent } from '../internal';
import {
  RowActionMenuComponent,
  type RowActionResult,
  type RowIntentFilter,
} from './row-action-menu.component';

function seedIntents(): void {
  const reg = TestBed.inject(IntentRegistry);
  reg.register(
    agenticIntent({
      id: 'runHoldAck',
      description: 'Run hold acknowledgment check',
      examples: ['check ack', 'verify acknowledgement'],
      schema: z.object({}),
      mapsTo: { kind: 'tool', target: 'runHoldAck' },
    }),
  );
  reg.register(
    agenticIntent({
      id: 'openInReview',
      description: 'Open in review queue',
      examples: ['open in review'],
      schema: z.object({}),
      mapsTo: { kind: 'route', target: '/review-queue' },
    }),
  );
  reg.register(
    agenticIntent({
      id: 'releaseHold',
      description: 'Release the hold',
      examples: ['release hold'],
      schema: z.object({}),
      mapsTo: { kind: 'action', target: 'releaseHold' },
    }),
  );
}

interface TestRow {
  readonly id: string;
  readonly status: 'active' | 'released';
}

@Component({
  imports: [RowActionMenuComponent],
  template: `
    <mvk-row-action-menu
      [row]="row"
      [intents]="intents"
      [entity]="entity"
      [filter]="filter"
      (selected)="onSelected($event)" />
  `,
})
class HostComponent {
  row: TestRow = { id: 'c-1', status: 'active' };
  intents: readonly string[] = ['runHoldAck', 'openInReview', 'releaseHold'];
  entity: string | undefined = 'custodian';
  filter: RowIntentFilter = () => true;
  received: RowActionResult[] = [];
  onSelected(r: RowActionResult): void {
    this.received.push(r);
  }
}

function setup(initial: Partial<HostComponent> = {}): ComponentFixture<HostComponent> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  seedIntents();
  const fixture = TestBed.createComponent(HostComponent);
  Object.assign(fixture.componentInstance, initial);
  fixture.detectChanges();
  return fixture;
}

function kebab(fixture: ComponentFixture<HostComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button.kebab') as HTMLButtonElement;
}

function menuItems(fixture: ComponentFixture<HostComponent>): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('li.row:not(.empty)')) as HTMLElement[];
}

// ── open / close ───────────────────────────────────────────────────

describe('RowActionMenuComponent — open/close', () => {
  beforeEach(() => undefined);

  it('starts closed and opens on kebab click', () => {
    const fixture = setup();
    expect(fixture.nativeElement.querySelector('ul.menu')).toBeNull();
    kebab(fixture).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ul.menu')).not.toBeNull();
  });

  it('toggles closed on second kebab click', () => {
    const fixture = setup();
    kebab(fixture).click();
    fixture.detectChanges();
    kebab(fixture).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ul.menu')).toBeNull();
  });

  it('closes on click outside the component', () => {
    const fixture = setup();
    kebab(fixture).click();
    fixture.detectChanges();

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ul.menu')).toBeNull();
    outside.remove();
  });

  it('closes on global Escape', () => {
    const fixture = setup();
    kebab(fixture).click();
    fixture.detectChanges();

    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(ev);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ul.menu')).toBeNull();
  });
});

// ── menu population ────────────────────────────────────────────────

describe('RowActionMenuComponent — menu rows', () => {
  beforeEach(() => undefined);

  it('renders one row per resolved intent in the supplied order', () => {
    const fixture = setup();
    kebab(fixture).click();
    fixture.detectChanges();

    const items = menuItems(fixture);
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('Run hold acknowledgment check');
    expect(items[1]?.textContent).toContain('Open in review queue');
    expect(items[2]?.textContent).toContain('Release the hold');
  });

  it('skips intents the persona cannot see', () => {
    const fixture = setup();
    TestBed.inject(IntentRegistry).setScopePolicy((entry) => entry.name !== 'releaseHold');
    kebab(fixture).click();
    fixture.detectChanges();

    const labels = menuItems(fixture).map((el) => el.querySelector('.label')?.textContent?.trim());
    expect(labels).toEqual(['Run hold acknowledgment check', 'Open in review queue']);
  });

  it('skips intents the host filter rejects for the row state', () => {
    const fixture = setup({
      row: { id: 'c-1', status: 'released' },
      filter: (intent, row) => {
        const r = row as TestRow;
        if (intent.id === 'releaseHold' && r.status === 'released') return false;
        return true;
      },
    });
    kebab(fixture).click();
    fixture.detectChanges();

    const labels = menuItems(fixture).map((el) => el.querySelector('.label')?.textContent?.trim());
    expect(labels).toEqual(['Run hold acknowledgment check', 'Open in review queue']);
  });

  it('skips intent names not present in the registry', () => {
    const fixture = setup({ intents: ['runHoldAck', 'unknownIntent', 'releaseHold'] });
    kebab(fixture).click();
    fixture.detectChanges();
    expect(menuItems(fixture)).toHaveLength(2);
  });

  it('shows the "no actions" empty state when every intent filters out', () => {
    const fixture = setup({ filter: () => false });
    kebab(fixture).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('li.empty')).not.toBeNull();
  });

  it('renders a kind badge per row reflecting mapsTo.kind', () => {
    const fixture = setup();
    kebab(fixture).click();
    fixture.detectChanges();

    const kinds = menuItems(fixture).map((el) =>
      el.querySelector('.kind')?.getAttribute('data-kind'),
    );
    expect(kinds).toEqual(['tool', 'route', 'action']);
  });
});

// ── selection + dispatch ───────────────────────────────────────────

describe('RowActionMenuComponent — selection', () => {
  beforeEach(() => undefined);

  it('emits a typed result on row click and closes the menu', () => {
    const fixture = setup();
    kebab(fixture).click();
    fixture.detectChanges();
    menuItems(fixture)[1]?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.received).toHaveLength(1);
    const r = fixture.componentInstance.received[0]!;
    expect(r.intentId).toBe('openInReview');
    expect(r.mapsTo).toEqual({ kind: 'route', target: '/review-queue' });
    expect(r.row).toEqual({ id: 'c-1', status: 'active' });
    expect(r.entity).toBe('custodian');
    expect(fixture.nativeElement.querySelector('ul.menu')).toBeNull();
  });

  it('Enter selects the highlighted row', () => {
    const fixture = setup();
    kebab(fixture).click();
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('ul.menu') as HTMLElement;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.received).toHaveLength(1);
    expect(fixture.componentInstance.received[0]?.intentId).toBe('openInReview');
  });

  it('does not emit when clicking the empty-state row', () => {
    const fixture = setup({ filter: () => false });
    kebab(fixture).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('li.empty') as HTMLElement)?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.received).toHaveLength(0);
  });
});
