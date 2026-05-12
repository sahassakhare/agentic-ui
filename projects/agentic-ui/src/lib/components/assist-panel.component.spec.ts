import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { IntentRegistry, agenticIntent } from '../internal';
import { provideLayoutPolicy } from '../platform/provide-layout-policy';
import {
  AssistPanelComponent,
  type AssistAction,
  type AssistIntentFilter,
} from './assist-panel.component';

/** Reach into the assist panel to drive its internal `askText` signal directly. */
function getAskText(fixture: ComponentFixture<unknown>): WritableSignal<string> {
  const panel = fixture.debugElement.query(By.directive(AssistPanelComponent))
    .componentInstance as unknown as { askText: WritableSignal<string> };
  return panel.askText;
}

function seedIntents(): void {
  const reg = TestBed.inject(IntentRegistry);
  reg.register(
    agenticIntent({
      id: 'runHoldAck',
      description: 'Run hold acknowledgment check',
      examples: ['check ack'],
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

@Component({
  imports: [AssistPanelComponent],
  template: `
    <mvk-assist-panel
      [context]="context()"
      [intents]="intents()"
      [filterContext]="filterContext()"
      [filter]="filter()"
      [focusedItem]="focusedItem()"
      [focusLabel]="focusLabel()"
      [askPlaceholder]="askPlaceholder()"
      (intentSelected)="onAction($event)"
      (explain)="onExplain($event)"
      (ask)="onAsk($event)" />
  `,
})
class HostComponent {
  context: WritableSignal<string> = signal('Editing custodian C-117 intake');
  intents: WritableSignal<readonly string[]> = signal(['runHoldAck', 'openInReview', 'releaseHold']);
  filterContext: WritableSignal<unknown> = signal({ status: 'active' });
  filter: WritableSignal<AssistIntentFilter> = signal(() => true);
  focusedItem: WritableSignal<unknown> = signal(undefined);
  focusLabel: WritableSignal<string> = signal('this');
  askPlaceholder: WritableSignal<string> = signal('Ask the agent…');
  actions: AssistAction[] = [];
  explainPayloads: unknown[] = [];
  askMessages: string[] = [];
  onAction(a: AssistAction): void { this.actions.push(a); }
  onExplain(p: unknown): void { this.explainPayloads.push(p); }
  onAsk(text: string): void { this.askMessages.push(text); }
}

function setup(initial: Partial<HostComponent> = {}, providers: unknown[] = []): ComponentFixture<HostComponent> {
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: providers as never,
  });
  seedIntents();
  const fixture = TestBed.createComponent(HostComponent);
  const c = fixture.componentInstance;
  // Selectively replace signals so callers can pass either a value
  // or a signal (here we always replace via .set).
  for (const [k, v] of Object.entries(initial)) {
    const sig = (c as unknown as Record<string, WritableSignal<unknown> | unknown>)[k];
    // Angular signals are *functions*, not objects — `typeof signal === 'function'`.
    if (typeof sig === 'function' && 'set' in (sig as object)) {
      (sig as WritableSignal<unknown>).set(v);
    }
  }
  fixture.detectChanges();
  return fixture;
}

// ── context summary ───────────────────────────────────────────────

describe('AssistPanelComponent — context summary', () => {
  beforeEach(() => undefined);

  it('renders the [context] string in the header', () => {
    const fixture = setup({ context: 'Editing custodian C-117 intake' as unknown as WritableSignal<string> });
    const summary = fixture.nativeElement.querySelector('.summary') as HTMLElement;
    expect(summary.textContent?.trim()).toBe('Editing custodian C-117 intake');
  });

  it('hides the header when context is empty', () => {
    const fixture = setup({ context: '' as unknown as WritableSignal<string> });
    expect(fixture.nativeElement.querySelector('.context')).toBeNull();
  });
});

// ── suggested actions ──────────────────────────────────────────────

describe('AssistPanelComponent — suggested actions', () => {
  beforeEach(() => undefined);

  it('resolves and renders one button per intent in order', () => {
    const fixture = setup();
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.action .label')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(labels).toEqual([
      'Run hold acknowledgment check',
      'Open in review queue',
      'Release the hold',
    ]);
  });

  it('hides intents the persona cannot see', () => {
    const fixture = setup();
    TestBed.inject(IntentRegistry).setScopePolicy((entry) => entry.name !== 'releaseHold');
    fixture.detectChanges();

    const labels = Array.from(fixture.nativeElement.querySelectorAll('.action .label')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(labels).toEqual(['Run hold acknowledgment check', 'Open in review queue']);
  });

  it('hides intents the context filter rejects', () => {
    const fixture = setup({
      filter: ((intent: { id: string }, ctx: unknown) => {
        const c = ctx as { status: string };
        if (intent.id === 'releaseHold' && c.status !== 'active') return false;
        return true;
      }) as unknown as WritableSignal<AssistIntentFilter>,
      filterContext: { status: 'released' } as unknown as WritableSignal<unknown>,
    });
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.action .label')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(labels).not.toContain('Release the hold');
  });

  it('shows empty-state copy when every intent filters out', () => {
    const fixture = setup({
      filter: (() => false) as unknown as WritableSignal<AssistIntentFilter>,
    });
    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain('No suggested actions');
  });

  it('renders kind badges reflecting mapsTo.kind', () => {
    const fixture = setup();
    const kinds = Array.from(fixture.nativeElement.querySelectorAll('.action .kind')).map((el) =>
      (el as HTMLElement).getAttribute('data-kind'),
    );
    expect(kinds).toEqual(['tool', 'route', 'action']);
  });

  it('emits intentSelected with the typed result on click', () => {
    const fixture = setup();
    (fixture.nativeElement.querySelector('button.action.kind-route') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.actions).toHaveLength(1);
    expect(fixture.componentInstance.actions[0]?.mapsTo).toEqual({ kind: 'route', target: '/review-queue' });
  });
});

// ── explain affordance ────────────────────────────────────────────

describe('AssistPanelComponent — explain affordance', () => {
  beforeEach(() => undefined);

  it('hides the Explain button when focusedItem is undefined', () => {
    const fixture = setup({ focusedItem: undefined as unknown as WritableSignal<unknown> });
    expect(fixture.nativeElement.querySelector('.explain')).toBeNull();
  });

  it('shows the Explain button when focusedItem is provided', () => {
    const fixture = setup({
      focusedItem: { fieldName: 'department' } as unknown as WritableSignal<unknown>,
      focusLabel: 'the department field' as unknown as WritableSignal<string>,
    });
    const btn = fixture.nativeElement.querySelector('.explain') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Explain the department field');
  });

  it('emits explain with the focusedItem on click', () => {
    const focus = { fieldName: 'department' };
    const fixture = setup({
      focusedItem: focus as unknown as WritableSignal<unknown>,
    });
    (fixture.nativeElement.querySelector('.explain') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.explainPayloads).toEqual([focus]);
  });
});

// ── ask input ──────────────────────────────────────────────────────

describe('AssistPanelComponent — ask input', () => {
  beforeEach(() => undefined);

  it('disables Send while the input is empty/whitespace', () => {
    const fixture = setup();
    const submit = fixture.nativeElement.querySelector('button.ask-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('emits ask with the trimmed text on submit', () => {
    const fixture = setup();
    // Drive the askText signal directly — jsdom's input/ngModel chain
    // is flaky in headless test runs; the component reads from the
    // signal on submit either way.
    getAskText(fixture).set('  what does this field require?  ');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button.ask-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.askMessages).toEqual(['what does this field require?']);
  });

  it('clears the input after a successful submit', () => {
    const fixture = setup();
    const askText = getAskText(fixture);
    askText.set('why is this privileged?');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button.ask-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(askText()).toBe('');
  });

  it('uses a custom askPlaceholder when supplied', () => {
    const fixture = setup({ askPlaceholder: 'Ask about this custodian…' as unknown as WritableSignal<string> });
    const input = fixture.nativeElement.querySelector('input.ask-input') as HTMLInputElement;
    expect(input.getAttribute('placeholder')).toBe('Ask about this custodian…');
  });
});

// ── density via LAYOUT_POLICY ─────────────────────────────────────

describe('AssistPanelComponent — density via LayoutPolicy', () => {
  beforeEach(() => undefined);

  it('renders comfortable density when no LayoutPolicy provider is wired', () => {
    const fixture = setup();
    const panel = fixture.nativeElement.querySelector('.panel') as HTMLElement;
    expect(panel.getAttribute('data-density')).toBe('comfortable');
  });

  it('honours density()="compact" from the active LayoutPolicy', () => {
    const fixture = setup({}, [provideLayoutPolicy({ density: () => 'compact' })]);
    const panel = fixture.nativeElement.querySelector('.panel') as HTMLElement;
    expect(panel.getAttribute('data-density')).toBe('compact');
  });

  it('honours density()="dense" from the active LayoutPolicy', () => {
    const fixture = setup({}, [provideLayoutPolicy({ density: () => 'dense' })]);
    const panel = fixture.nativeElement.querySelector('.panel') as HTMLElement;
    expect(panel.getAttribute('data-density')).toBe('dense');
  });
});
