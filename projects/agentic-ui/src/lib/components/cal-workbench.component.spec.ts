import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CalWorkbenchComponent,
  type CalDecision,
  type CalProposal,
  type CalRoundStats,
} from './cal-workbench.component';

function proposal(overrides: Partial<CalProposal> = {}): CalProposal {
  return {
    itemId: 'D-117',
    title: 'Memo re: M&A discussions',
    predictedLabel: 'privileged',
    confidence: 0.87,
    rationale: 'phrase "attorney-client"; sender outside counsel',
    summary: 'Email thread from outside counsel about pending acquisition.',
    alternatives: ['non-privileged', 'work-product'],
    ...overrides,
  };
}

@Component({
  imports: [CalWorkbenchComponent],
  template: `
    <mvk-cal-workbench
      [current]="current()"
      [stats]="stats()"
      [advanceLabel]="advanceLabel()"
      [canNavigatePrev]="canNavigatePrev()"
      [canNavigateNext]="canNavigateNext()"
      [showAdvance]="showAdvance()"
      (decision)="decisions.push($event)"
      (navigate)="navs.push($event)"
      (advance)="advanceCount = advanceCount + 1">
      <div slot="document" data-testid="doc-slot">DOC PAYLOAD</div>
    </mvk-cal-workbench>
  `,
})
class HostComponent {
  current: WritableSignal<CalProposal | null> = signal(proposal());
  stats: WritableSignal<CalRoundStats | null> = signal({
    round: 1,
    tagged: 0,
    batchSize: 20,
    agreementRate: 0.6,
  });
  advanceLabel: WritableSignal<string> = signal('Train next round');
  canNavigatePrev: WritableSignal<boolean> = signal(false);
  canNavigateNext: WritableSignal<boolean> = signal(true);
  showAdvance: WritableSignal<boolean> = signal(true);
  decisions: CalDecision[] = [];
  navs: number[] = [];
  advanceCount = 0;
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

// ── header + stats ───────────────────────────────────────────────

describe('CalWorkbenchComponent — header + stats', () => {
  beforeEach(() => undefined);

  it('renders round number, tagged/batch progress, and agreement bar', () => {
    const fixture = setup({});
    expect(fixture.nativeElement.querySelector('.round-num')?.textContent?.trim()).toBe('Round 1');
    expect(fixture.nativeElement.querySelector('.round-progress')?.textContent).toContain('0 / 20');
    expect(fixture.nativeElement.querySelector('.agreement-value')?.textContent).toBe('60%');
  });

  it('hides the agreement bar when stats.agreementRate is undefined', () => {
    const fixture = setup({
      stats: { round: 1, tagged: 0, batchSize: 20 } as unknown as WritableSignal<CalRoundStats | null>,
    });
    expect(fixture.nativeElement.querySelector('.agreement')).toBeNull();
  });

  it('accepts agreementRate already in 0-100 percent form', () => {
    const fixture = setup({
      stats: { round: 2, tagged: 5, batchSize: 20, agreementRate: 78 } as unknown as WritableSignal<CalRoundStats | null>,
    });
    expect(fixture.nativeElement.querySelector('.agreement-value')?.textContent).toBe('78%');
  });

  it('shows the converged badge + sets data-converged on the host when stats.converged is true', () => {
    const fixture = setup({
      stats: { round: 5, tagged: 20, batchSize: 20, agreementRate: 0.99, converged: true } as unknown as WritableSignal<CalRoundStats | null>,
    });
    expect(fixture.nativeElement.querySelector('.convergence-badge')).not.toBeNull();
    expect(
      (fixture.nativeElement.querySelector('.workbench') as HTMLElement).getAttribute('data-converged'),
    ).toBe('true');
  });
});

// ── document slot ────────────────────────────────────────────────

describe('CalWorkbenchComponent — document slot', () => {
  beforeEach(() => undefined);

  it('renders the projected content via the document slot', () => {
    const fixture = setup({});
    const slotted = fixture.nativeElement.querySelector('[data-testid="doc-slot"]');
    expect(slotted).not.toBeNull();
    expect(slotted?.textContent?.trim()).toBe('DOC PAYLOAD');
  });

  it('renders the title + itemId in the document header', () => {
    const fixture = setup({});
    expect(fixture.nativeElement.querySelector('.doc-title')?.textContent?.trim()).toBe(
      'Memo re: M&A discussions',
    );
    expect(fixture.nativeElement.querySelector('.doc-id')?.textContent?.trim()).toBe('D-117');
  });
});

// ── proposal panel ───────────────────────────────────────────────

describe('CalWorkbenchComponent — proposal panel', () => {
  beforeEach(() => undefined);

  it('renders the predicted label + formatted confidence', () => {
    const fixture = setup({});
    expect(fixture.nativeElement.querySelector('.proposed-label')?.textContent?.trim()).toBe(
      'privileged',
    );
    expect(fixture.nativeElement.querySelector('.confidence')?.textContent?.trim()).toBe('87%');
  });

  it('confidence chip uses "high" bucket for confidence >= 80%', () => {
    const fixture = setup({ current: proposal({ confidence: 0.85 }) as unknown as WritableSignal<CalProposal | null> });
    expect(
      fixture.nativeElement.querySelector('.confidence')?.getAttribute('data-confidence-bucket'),
    ).toBe('high');
  });

  it('confidence chip uses "low" bucket for confidence < 50%', () => {
    const fixture = setup({ current: proposal({ confidence: 0.4 }) as unknown as WritableSignal<CalProposal | null> });
    expect(
      fixture.nativeElement.querySelector('.confidence')?.getAttribute('data-confidence-bucket'),
    ).toBe('low');
  });

  it('renders rationale + summary when supplied', () => {
    const fixture = setup({});
    expect(fixture.nativeElement.querySelector('.rationale')?.textContent).toContain('attorney-client');
    expect(fixture.nativeElement.querySelector('.summary')).not.toBeNull();
  });
});

// ── decisions: accept / reject / skip ────────────────────────────

describe('CalWorkbenchComponent — decisions', () => {
  beforeEach(() => undefined);

  it('emits decision { action: "accept" } on Accept click', () => {
    const fixture = setup({});
    (fixture.nativeElement.querySelector('button.accept') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.decisions).toEqual([
      { itemId: 'D-117', action: 'accept' },
    ]);
  });

  it('emits decision { action: "skip" } on Skip click', () => {
    const fixture = setup({});
    (fixture.nativeElement.querySelector('button.skip') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.decisions).toEqual([
      { itemId: 'D-117', action: 'skip' },
    ]);
  });

  it('Reject opens the correct panel before emitting (two-click flow)', () => {
    const fixture = setup({});
    expect(fixture.nativeElement.querySelector('.correct')).toBeNull();

    (fixture.nativeElement.querySelector('button.reject') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.correct')).not.toBeNull();
    expect(fixture.componentInstance.decisions).toHaveLength(0);
  });

  it('clicking an alternative label emits decision with correctedTo', () => {
    const fixture = setup({});
    (fixture.nativeElement.querySelector('button.reject') as HTMLButtonElement).click();
    fixture.detectChanges();

    const altBtn = Array.from(fixture.nativeElement.querySelectorAll('.alt-btn:not(.cancel)')).find(
      (b) => (b as HTMLElement).textContent?.trim() === 'work-product',
    ) as HTMLButtonElement;
    altBtn.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.decisions).toEqual([
      { itemId: 'D-117', action: 'reject', correctedTo: 'work-product' },
    ]);
    expect(fixture.nativeElement.querySelector('.correct')).toBeNull();
  });

  it('Cancel inside the correct panel closes it without emitting', () => {
    const fixture = setup({});
    (fixture.nativeElement.querySelector('button.reject') as HTMLButtonElement).click();
    fixture.detectChanges();

    const cancel = fixture.nativeElement.querySelector('.alt-btn.cancel') as HTMLButtonElement;
    cancel.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.correct')).toBeNull();
    expect(fixture.componentInstance.decisions).toHaveLength(0);
  });

  it('falls back to "not-<label>" correction when no alternatives are supplied', () => {
    const fixture = setup({
      current: proposal({ alternatives: undefined }) as unknown as WritableSignal<CalProposal | null>,
    });
    (fixture.nativeElement.querySelector('button.reject') as HTMLButtonElement).click();
    fixture.detectChanges();

    const fallback = Array.from(fixture.nativeElement.querySelectorAll('.alt-btn:not(.cancel)')) as HTMLButtonElement[];
    expect((fallback[0] as HTMLElement).textContent?.trim()).toContain('not privileged');
    fallback[0]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.decisions[0]?.correctedTo).toBe('not-privileged');
  });

  it('disables all decision actions when stats.converged is true', () => {
    const fixture = setup({
      stats: { round: 5, tagged: 20, batchSize: 20, converged: true } as unknown as WritableSignal<CalRoundStats | null>,
    });
    expect((fixture.nativeElement.querySelector('button.accept') as HTMLButtonElement).disabled).toBe(true);
    expect((fixture.nativeElement.querySelector('button.reject') as HTMLButtonElement).disabled).toBe(true);
    expect((fixture.nativeElement.querySelector('button.skip') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── navigation + advance ─────────────────────────────────────────

describe('CalWorkbenchComponent — navigation + advance', () => {
  beforeEach(() => undefined);

  it('Prev button is disabled when canNavigatePrev is false', () => {
    const fixture = setup({});
    const prev = Array.from(fixture.nativeElement.querySelectorAll('button.nav-btn')) as HTMLButtonElement[];
    expect(prev[0]?.disabled).toBe(true);
    expect(prev[1]?.disabled).toBe(false);
  });

  it('emits navigate(-1) / navigate(1) on Prev / Next click', () => {
    const fixture = setup({
      canNavigatePrev: true as unknown as WritableSignal<boolean>,
      canNavigateNext: true as unknown as WritableSignal<boolean>,
    });
    const [prev, next] = Array.from(fixture.nativeElement.querySelectorAll('button.nav-btn')) as HTMLButtonElement[];
    prev?.click();
    next?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.navs).toEqual([-1, 1]);
  });

  it('emits advance on the "Train next round" button click', () => {
    const fixture = setup({});
    const advance = fixture.nativeElement.querySelector('.advance-btn') as HTMLButtonElement;
    advance.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.advanceCount).toBe(1);
  });

  it('hides the advance button when [showAdvance] is false', () => {
    const fixture = setup({ showAdvance: false as unknown as WritableSignal<boolean> });
    expect(fixture.nativeElement.querySelector('.advance-btn')).toBeNull();
  });

  it('respects a custom [advanceLabel]', () => {
    const fixture = setup({
      advanceLabel: 'Run round 4' as unknown as WritableSignal<string>,
    });
    expect(fixture.nativeElement.querySelector('.advance-btn')?.textContent?.trim()).toBe('Run round 4');
  });
});

// ── empty state ──────────────────────────────────────────────────

describe('CalWorkbenchComponent — empty + converged states', () => {
  beforeEach(() => undefined);

  it('shows the empty-state copy + advance button when current is null', () => {
    const fixture = setup({
      current: null as unknown as WritableSignal<CalProposal | null>,
    });
    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain(
      'No item to review',
    );
    expect(fixture.nativeElement.querySelector('.empty .advance-btn')).not.toBeNull();
  });

  it('shows the converged copy when stats.converged is true and current is null', () => {
    const fixture = setup({
      current: null as unknown as WritableSignal<CalProposal | null>,
      stats: { round: 4, tagged: 20, batchSize: 20, converged: true } as unknown as WritableSignal<CalRoundStats | null>,
    });
    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain(
      'Training converged',
    );
  });
});
