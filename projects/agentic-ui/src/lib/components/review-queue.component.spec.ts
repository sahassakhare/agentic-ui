import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_REVIEW_QUEUE_ACTIONS,
  ReviewQueueComponent,
  type ReviewDecision,
  type ReviewQueueActionConfig,
  type ReviewQueueItem,
} from './review-queue.component';

function item(
  id: string,
  state: ReviewQueueItem['state'],
  overrides: Partial<ReviewQueueItem> = {},
): ReviewQueueItem {
  return {
    id,
    state,
    title: `Item ${id}`,
    summary: `summary for ${id}`,
    proposedBy: 'agent',
    updatedAt: '2026-04-12T10:00:00Z',
    ...overrides,
  };
}

@Component({
  imports: [ReviewQueueComponent],
  template: `
    <mvk-review-queue
      [items]="items()"
      [states]="states()"
      [actionConfig]="actionConfig()"
      [stateLabels]="stateLabels()"
      (open)="opens.push($event)"
      (decision)="decisions.push($event)" />
  `,
})
class HostComponent {
  items: WritableSignal<readonly ReviewQueueItem[]> = signal([]);
  states: WritableSignal<readonly string[]> = signal([]);
  actionConfig: WritableSignal<ReviewQueueActionConfig> = signal(DEFAULT_REVIEW_QUEUE_ACTIONS);
  stateLabels: WritableSignal<Readonly<Record<string, string>>> = signal({});
  opens: string[] = [];
  decisions: ReviewDecision[] = [];
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

function groups(fixture: ComponentFixture<HostComponent>): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('section.group')) as HTMLElement[];
}

function itemTitles(fixture: ComponentFixture<HostComponent>, state: string): string[] {
  const group = fixture.nativeElement.querySelector(
    `section.group[data-state="${state}"]`,
  ) as HTMLElement | null;
  if (!group) return [];
  return Array.from(group.querySelectorAll('.item-title')).map((el) =>
    (el as HTMLElement).textContent?.trim() ?? '',
  );
}

// ── empty + grouping ─────────────────────────────────────────────

describe('ReviewQueueComponent — empty + grouping', () => {
  beforeEach(() => undefined);

  it('shows empty copy when items is empty and no states are pinned', () => {
    const fixture = setup({});
    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain('Nothing to review');
  });

  it('groups items by state when no [states] input is provided', () => {
    const fixture = setup({
      items: [
        item('a', 'proposed_privileged'),
        item('b', 'proposed_privileged'),
        item('c', 'qc_pending'),
      ] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
    });
    const states = groups(fixture).map((g) => g.getAttribute('data-state'));
    expect(states.sort()).toEqual(['proposed_privileged', 'qc_pending']);
    expect(itemTitles(fixture, 'proposed_privileged')).toEqual(['Item a', 'Item b']);
    expect(itemTitles(fixture, 'qc_pending')).toEqual(['Item c']);
  });

  it('honours [states] to filter + order groups for persona routing', () => {
    const fixture = setup({
      items: [
        item('a', 'proposed_privileged'),
        item('b', 'qc_pending'),
        item('c', 'escalated'),
        item('d', 'final'),
      ] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
      // Senior reviewer's view: only QC pending.
      states: ['qc_pending'] as unknown as WritableSignal<readonly string[]>,
    });
    const states = groups(fixture).map((g) => g.getAttribute('data-state'));
    expect(states).toEqual(['qc_pending']);
    expect(itemTitles(fixture, 'qc_pending')).toEqual(['Item b']);
  });

  it('preserves the persona-supplied state order', () => {
    const fixture = setup({
      items: [
        item('a', 'proposed_privileged'),
        item('b', 'qc_pending'),
        item('c', 'escalated'),
      ] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
      // GC sees all three in this order.
      states: ['escalated', 'qc_pending', 'proposed_privileged'] as unknown as WritableSignal<readonly string[]>,
    });
    const states = groups(fixture).map((g) => g.getAttribute('data-state'));
    expect(states).toEqual(['escalated', 'qc_pending', 'proposed_privileged']);
  });

  it('renders empty-state copy inside a group when [states] includes a state with no items', () => {
    const fixture = setup({
      items: [item('a', 'qc_pending')] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
      states: ['proposed_privileged', 'qc_pending'] as unknown as WritableSignal<readonly string[]>,
    });
    const proposed = fixture.nativeElement.querySelector(
      'section.group[data-state="proposed_privileged"]',
    ) as HTMLElement;
    expect(proposed.querySelector('.group-empty')).not.toBeNull();
  });

  it('shows per-group counts in the header', () => {
    const fixture = setup({
      items: [
        item('a', 'proposed_privileged'),
        item('b', 'proposed_privileged'),
        item('c', 'qc_pending'),
      ] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
      states: ['proposed_privileged', 'qc_pending'] as unknown as WritableSignal<readonly string[]>,
    });
    const counts = Array.from(fixture.nativeElement.querySelectorAll('.group-count')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(counts).toEqual(['2', '1']);
  });
});

// ── item rendering ───────────────────────────────────────────────

describe('ReviewQueueComponent — item rendering', () => {
  beforeEach(() => undefined);

  it('renders title + summary + proposedBy + updatedAt + tags', () => {
    const fixture = setup({
      items: [
        item('a', 'proposed_privileged', {
          tags: ['attorney-client', 'work-product'],
        }),
      ] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
    });
    const el = fixture.nativeElement.querySelector('.item') as HTMLElement;
    expect(el.querySelector('.item-title')?.textContent).toContain('Item a');
    expect(el.querySelector('.summary')?.textContent).toContain('summary for a');
    expect(el.querySelector('.proposed')?.textContent).toContain('agent');
    expect(el.querySelector('.ts')).not.toBeNull();
    const tags = Array.from(el.querySelectorAll('.tag')).map((t) => (t as HTMLElement).textContent?.trim());
    expect(tags).toEqual(['attorney-client', 'work-product']);
  });

  it('humanises state labels when no [stateLabels] override is supplied', () => {
    const fixture = setup({
      items: [item('a', 'proposed_privileged')] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
    });
    expect(fixture.nativeElement.querySelector('.group-title')?.textContent?.trim()).toBe(
      'Proposed Privileged',
    );
  });

  it('uses [stateLabels] override when supplied', () => {
    const fixture = setup({
      items: [item('a', 'qc_pending')] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
      stateLabels: { qc_pending: 'Waiting on QC' } as unknown as WritableSignal<
        Readonly<Record<string, string>>
      >,
    });
    expect(fixture.nativeElement.querySelector('.group-title')?.textContent?.trim()).toBe(
      'Waiting on QC',
    );
  });
});

// ── actions ──────────────────────────────────────────────────────

describe('ReviewQueueComponent — actions', () => {
  beforeEach(() => undefined);

  it('renders default action buttons per state from DEFAULT_REVIEW_QUEUE_ACTIONS', () => {
    const fixture = setup({
      items: [
        item('a', 'proposed_privileged'),
        item('b', 'qc_pending'),
        item('c', 'escalated'),
        item('d', 'final'),
      ] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
    });
    const labelsByState: Record<string, string[]> = {};
    for (const group of groups(fixture)) {
      const state = group.getAttribute('data-state') ?? '';
      labelsByState[state] = Array.from(group.querySelectorAll('.action-btn')).map((b) =>
        (b as HTMLElement).textContent?.trim() ?? '',
      );
    }
    expect(labelsByState['proposed_privileged']).toEqual(['Accept', 'Reject']);
    expect(labelsByState['qc_pending']).toEqual(['Approve', 'Escalate']);
    expect(labelsByState['escalated']).toEqual(['Finalize', 'Reject']);
    expect(labelsByState['final']).toEqual([]);
  });

  it('honours a custom [actionConfig]', () => {
    const fixture = setup({
      items: [item('a', 'pending')] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
      actionConfig: { pending: [{ key: 'kick', label: 'Kick' }] } as unknown as WritableSignal<ReviewQueueActionConfig>,
    });
    expect(
      (fixture.nativeElement.querySelector('.action-btn') as HTMLElement).textContent?.trim(),
    ).toBe('Kick');
  });

  it('applies .primary / .danger emphasis classes', () => {
    const fixture = setup({
      items: [item('a', 'proposed_privileged')] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
    });
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.action-btn'));
    // Default config: Accept (primary), Reject (danger).
    expect((buttons[0] as HTMLElement).classList.contains('primary')).toBe(true);
    expect((buttons[1] as HTMLElement).classList.contains('danger')).toBe(true);
  });

  it('emits (decision) with itemId + action + fromState on click', () => {
    const fixture = setup({
      items: [item('a', 'qc_pending')] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
    });
    const escalate = Array.from(fixture.nativeElement.querySelectorAll('.action-btn')).find(
      (b) => (b as HTMLElement).textContent?.trim() === 'Escalate',
    ) as HTMLButtonElement;
    escalate.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.decisions).toEqual([
      { itemId: 'a', action: 'escalate', fromState: 'qc_pending' },
    ]);
  });
});

// ── open + a11y ──────────────────────────────────────────────────

describe('ReviewQueueComponent — open + a11y', () => {
  beforeEach(() => undefined);

  it('clicking the item body emits (open) with the item id', () => {
    const fixture = setup({
      items: [item('a-117', 'qc_pending')] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
    });
    (fixture.nativeElement.querySelector('.item-body') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opens).toEqual(['a-117']);
  });

  it('the item-body button has an aria-label including the title', () => {
    const fixture = setup({
      items: [item('a', 'qc_pending', { title: 'Review D-117' })] as unknown as WritableSignal<readonly ReviewQueueItem[]>,
    });
    expect(
      (fixture.nativeElement.querySelector('.item-body') as HTMLButtonElement).getAttribute('aria-label'),
    ).toContain('Review D-117');
  });
});
