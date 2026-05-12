import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { IntentRegistry, agenticIntent } from '../internal';
import {
  BulkToolbarComponent,
  type BulkActionResult,
  type BulkIntentFilter,
} from './bulk-toolbar.component';

function seedIntents(): void {
  const reg = TestBed.inject(IntentRegistry);
  reg.register(
    agenticIntent({
      id: 'bulkTagPrivileged',
      description: 'Bulk-tag as privileged',
      examples: ['tag privileged'],
      schema: z.object({}),
      mapsTo: { kind: 'tool', target: 'bulkTagPrivileged' },
    }),
  );
  reg.register(
    agenticIntent({
      id: 'sendToReviewQueue',
      description: 'Send to review queue',
      examples: ['send to review'],
      schema: z.object({}),
      mapsTo: { kind: 'action', target: 'sendToReviewQueue' },
    }),
  );
  reg.register(
    agenticIntent({
      id: 'generateCustodianSummary',
      description: 'Generate custodian summary',
      examples: ['summarise custodian'],
      schema: z.object({}),
      mapsTo: { kind: 'route', target: '/custodians/summary' },
    }),
  );
}

interface TestDoc {
  readonly id: string;
  readonly custodianId: string;
}

@Component({
  imports: [BulkToolbarComponent],
  template: `
    <mvk-bulk-toolbar
      [selection]="selection()"
      [intents]="intents()"
      [entity]="entity()"
      [filter]="filter()"
      [selectionLabelFn]="labelFn()"
      (selected)="onSelected($event)"
      (dismiss)="onDismiss()" />
  `,
})
class HostComponent {
  // Signal-backed inputs keep change detection coherent across mutations
  // — plain class fields trip NG0100 ExpressionChangedAfterItHasBeenCheckedError
  // under strict CD when the test mutates between detection cycles.
  selection: WritableSignal<readonly TestDoc[]> = signal([]);
  intents: WritableSignal<readonly string[]> = signal([
    'bulkTagPrivileged',
    'sendToReviewQueue',
    'generateCustodianSummary',
  ]);
  entity: WritableSignal<string | undefined> = signal('document');
  filter: WritableSignal<BulkIntentFilter> = signal(() => true);
  labelFn: WritableSignal<(selection: readonly unknown[]) => string> = signal(
    (s) => `${s.length} selected`,
  );
  received: BulkActionResult[] = [];
  dismissCount = 0;
  onSelected(r: BulkActionResult): void { this.received.push(r); }
  onDismiss(): void { this.dismissCount++; }
}

interface SetupInput {
  readonly selection?: readonly TestDoc[];
  readonly intents?: readonly string[];
  readonly entity?: string | undefined;
  readonly filter?: BulkIntentFilter;
  readonly labelFn?: (selection: readonly unknown[]) => string;
}

function setup(initial: SetupInput = {}): ComponentFixture<HostComponent> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  seedIntents();
  const fixture = TestBed.createComponent(HostComponent);
  const c = fixture.componentInstance;
  if (initial.selection !== undefined) c.selection.set(initial.selection);
  if (initial.intents !== undefined) c.intents.set(initial.intents);
  if (initial.entity !== undefined) c.entity.set(initial.entity);
  if (initial.filter !== undefined) c.filter.set(initial.filter);
  if (initial.labelFn !== undefined) c.labelFn.set(initial.labelFn);
  fixture.detectChanges();
  return fixture;
}

function bar(fixture: ComponentFixture<HostComponent>): HTMLElement | null {
  return fixture.nativeElement.querySelector('.bar');
}

function actionButtons(fixture: ComponentFixture<HostComponent>): HTMLButtonElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('button.action')) as HTMLButtonElement[];
}

// ── visibility ─────────────────────────────────────────────────────

describe('BulkToolbarComponent — visibility', () => {
  beforeEach(() => undefined);

  it('stays hidden when selection is empty', () => {
    const fixture = setup({ selection: [] });
    expect(bar(fixture)).toBeNull();
  });

  it('materialises when selection becomes non-empty', () => {
    const fixture = setup({ selection: [] });
    fixture.componentInstance.selection.set([{ id: 'd-1', custodianId: 'c-1' }]);
    fixture.detectChanges();
    expect(bar(fixture)).not.toBeNull();
  });

  it('hides again when selection returns to empty', () => {
    const fixture = setup({ selection: [{ id: 'd-1', custodianId: 'c-1' }] });
    expect(bar(fixture)).not.toBeNull();
    fixture.componentInstance.selection.set([]);
    fixture.detectChanges();
    expect(bar(fixture)).toBeNull();
  });

  it('shows the selection count via default label', () => {
    const fixture = setup({
      selection: [{ id: 'a', custodianId: 'c' }, { id: 'b', custodianId: 'c' }, { id: 'c', custodianId: 'd' }],
    });
    expect(bar(fixture)?.querySelector('.count')?.textContent).toBe('3 selected');
  });

  it('uses a custom selectionLabelFn when supplied', () => {
    const fixture = setup({
      selection: [{ id: 'a', custodianId: 'c1' }, { id: 'b', custodianId: 'c1' }],
      labelFn: (s) => {
        const docs = s as TestDoc[];
        const custodians = new Set(docs.map((d) => d.custodianId));
        return `${docs.length} documents · ${custodians.size} custodian(s)`;
      },
    });
    expect(bar(fixture)?.querySelector('.count')?.textContent).toBe('2 documents · 1 custodian(s)');
  });
});

// ── filter chain ───────────────────────────────────────────────────

describe('BulkToolbarComponent — filter chain', () => {
  beforeEach(() => undefined);

  it('renders one button per resolved intent in the supplied order', () => {
    const fixture = setup({ selection: [{ id: 'd-1', custodianId: 'c-1' }] });
    const labels = actionButtons(fixture).map((b) => b.querySelector('.label')?.textContent?.trim());
    expect(labels).toEqual([
      'Bulk-tag as privileged',
      'Send to review queue',
      'Generate custodian summary',
    ]);
  });

  it('skips intents the persona cannot see', () => {
    const fixture = setup({ selection: [{ id: 'd-1', custodianId: 'c-1' }] });
    TestBed.inject(IntentRegistry).setScopePolicy((entry) => entry.name !== 'generateCustodianSummary');
    fixture.detectChanges();

    const labels = actionButtons(fixture).map((b) => b.querySelector('.label')?.textContent?.trim());
    expect(labels).toEqual(['Bulk-tag as privileged', 'Send to review queue']);
  });

  it('skips intents the host filter rejects for the selection state', () => {
    const fixture = setup({
      selection: [{ id: 'd-1', custodianId: 'c-1' }, { id: 'd-2', custodianId: 'c-2' }],
      filter: (intent, selection) => {
        if (intent.id === 'generateCustodianSummary') {
          const docs = selection as TestDoc[];
          const custodians = new Set(docs.map((d) => d.custodianId));
          return custodians.size === 1;
        }
        return true;
      },
    });
    const labels = actionButtons(fixture).map((b) => b.querySelector('.label')?.textContent?.trim());
    expect(labels).toEqual(['Bulk-tag as privileged', 'Send to review queue']);
  });

  it('keeps the custodian-summary action when selection is from one custodian', () => {
    const fixture = setup({
      selection: [{ id: 'd-1', custodianId: 'c-1' }, { id: 'd-2', custodianId: 'c-1' }],
      filter: (intent, selection) => {
        if (intent.id === 'generateCustodianSummary') {
          const docs = selection as TestDoc[];
          const custodians = new Set(docs.map((d) => d.custodianId));
          return custodians.size === 1;
        }
        return true;
      },
    });
    const labels = actionButtons(fixture).map((b) => b.querySelector('.label')?.textContent?.trim());
    expect(labels).toContain('Generate custodian summary');
  });

  it('shows the "no bulk actions" empty state when every intent filters out', () => {
    const fixture = setup({
      selection: [{ id: 'd-1', custodianId: 'c-1' }],
      filter: () => false,
    });
    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain('No bulk actions');
  });

  it('silently skips intent names not present in the registry', () => {
    const fixture = setup({
      selection: [{ id: 'd-1', custodianId: 'c-1' }],
      intents: ['bulkTagPrivileged', 'doesNotExist', 'sendToReviewQueue'],
    });
    expect(actionButtons(fixture)).toHaveLength(2);
  });
});

// ── dispatch ───────────────────────────────────────────────────────

describe('BulkToolbarComponent — dispatch', () => {
  beforeEach(() => undefined);

  it('emits a typed BulkActionResult on button click', () => {
    const fixture = setup({
      selection: [{ id: 'd-1', custodianId: 'c-1' }, { id: 'd-2', custodianId: 'c-1' }],
    });
    actionButtons(fixture)[1]?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.received).toHaveLength(1);
    const r = fixture.componentInstance.received[0]!;
    expect(r.intentId).toBe('sendToReviewQueue');
    expect(r.mapsTo).toEqual({ kind: 'action', target: 'sendToReviewQueue' });
    expect(r.selection).toHaveLength(2);
    expect(r.entity).toBe('document');
  });

  it('emits dismiss when the × button is clicked', () => {
    const fixture = setup({ selection: [{ id: 'd-1', custodianId: 'c-1' }] });
    (fixture.nativeElement.querySelector('button.dismiss') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.dismissCount).toBe(1);
  });

  it('toolbar stays visible after a (selected) emission — host controls clearing', () => {
    const fixture = setup({ selection: [{ id: 'd-1', custodianId: 'c-1' }] });
    actionButtons(fixture)[0]?.click();
    fixture.detectChanges();
    expect(bar(fixture)).not.toBeNull();
  });
});
