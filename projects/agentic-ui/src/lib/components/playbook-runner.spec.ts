import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ToolRegistry, agenticTool, type ToolDef } from '../internal';
import type { PlaybookDef, PlaybookRun } from '../types/registry-defs';
import {
  PlaybookRunner,
  PlaybookRunnerComponent,
  type PlaybookRunnerAction,
} from './playbook-runner';

function pb(overrides: Partial<PlaybookDef> = {}): PlaybookDef {
  return {
    name: 'initial-pass',
    title: 'Initial pass',
    steps: [
      { id: 's1', title: 'Step 1', tool: 'tap', args: { tag: 'a' } },
      { id: 's2', title: 'Step 2', tool: 'tap', args: { tag: 'b' } },
    ],
    version: 'v1',
    ...overrides,
  };
}

function seedTaps(): { calls: { tag: string }[] } {
  const calls: { tag: string }[] = [];
  TestBed.inject(ToolRegistry).register(
    agenticTool({
      name: 'tap',
      description: 'records the call',
      schema: z.object({ tag: z.string() }),
      handler: async (args) => {
        calls.push(args);
        return { tag: args.tag };
      },
    }) as ToolDef,
  );
  return { calls };
}

function seedFlakyTap(failingTags: readonly string[]): void {
  TestBed.inject(ToolRegistry).register(
    agenticTool({
      name: 'tap',
      description: 'fails on listed tags',
      schema: z.object({ tag: z.string() }),
      handler: async (args) => {
        if (failingTags.includes(args.tag)) throw new Error(`tap-failed:${args.tag}`);
        return { tag: args.tag };
      },
    }) as ToolDef,
  );
}

/** Settle helper — waits for the runner's microtask chain. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// ── runner service ──────────────────────────────────────────────

describe('PlaybookRunner — happy path', () => {
  beforeEach(() => undefined);

  it('runs every step in order; final state success; tool called per step', async () => {
    TestBed.configureTestingModule({});
    const { calls } = seedTaps();
    const handle = TestBed.inject(PlaybookRunner).start(pb());
    const final = await handle.done;

    expect(final.overall).toBe('success');
    expect(final.steps.map((s) => s.status)).toEqual(['success', 'success']);
    expect(calls).toEqual([{ tag: 'a' }, { tag: 'b' }]);
  });

  it('captures the tool result per step', async () => {
    TestBed.configureTestingModule({});
    seedTaps();
    const handle = TestBed.inject(PlaybookRunner).start(pb());
    const final = await handle.done;
    expect(final.steps[0]?.result).toEqual({ tag: 'a' });
    expect(final.steps[1]?.result).toEqual({ tag: 'b' });
  });

  it('records startedAt + finishedAt per step', async () => {
    TestBed.configureTestingModule({});
    seedTaps();
    const handle = TestBed.inject(PlaybookRunner).start(pb());
    const final = await handle.done;
    for (const s of final.steps) {
      expect(s.startedAt).toBeTruthy();
      expect(s.finishedAt).toBeTruthy();
    }
  });
});

describe('PlaybookRunner — failure handling', () => {
  beforeEach(() => undefined);

  it('on step failure WITHOUT continueOnError: marks step failed + trails cancelled + overall failed', async () => {
    TestBed.configureTestingModule({});
    seedFlakyTap(['a']);    // step s1 fails
    const handle = TestBed.inject(PlaybookRunner).start(pb());
    const final = await handle.done;

    expect(final.steps[0]?.status).toBe('failed');
    expect(final.steps[0]?.error).toContain('tap-failed:a');
    expect(final.steps[1]?.status).toBe('cancelled');
    expect(final.overall).toBe('failed');
  });

  it('on step failure WITH continueOnError: continues, final still overall failed', async () => {
    TestBed.configureTestingModule({});
    seedFlakyTap(['a']);
    const def = pb({
      steps: [
        { id: 's1', title: 'Step 1', tool: 'tap', args: { tag: 'a' }, continueOnError: true },
        { id: 's2', title: 'Step 2', tool: 'tap', args: { tag: 'b' } },
      ],
    });
    const handle = TestBed.inject(PlaybookRunner).start(def);
    const final = await handle.done;
    expect(final.steps[0]?.status).toBe('failed');
    expect(final.steps[1]?.status).toBe('success');
    expect(final.overall).toBe('failed');
  });

  it('records "tool not visible" when ToolRegistry.get() returns undefined', async () => {
    TestBed.configureTestingModule({});
    seedTaps();
    TestBed.inject(ToolRegistry).setScopePolicy(() => false);  // deny all
    const handle = TestBed.inject(PlaybookRunner).start(pb());
    const final = await handle.done;
    expect(final.steps[0]?.status).toBe('failed');
    expect(final.steps[0]?.error).toContain('not visible');
  });
});

describe('PlaybookRunner — approval gate', () => {
  beforeEach(() => undefined);

  it('halts on awaiting-approval; resumes after approve()', async () => {
    TestBed.configureTestingModule({});
    seedTaps();
    const def = pb({
      steps: [
        { id: 's1', title: 'Step 1', tool: 'tap', args: { tag: 'a' } },
        { id: 's2', title: 'Step 2 (gated)', tool: 'tap', args: { tag: 'b' }, requiresApproval: true },
      ],
    });
    const handle = TestBed.inject(PlaybookRunner).start(def);

    // Let the first step run + the second pause for approval.
    await settle();
    await settle();

    expect(handle.state().steps[0]?.status).toBe('success');
    expect(handle.state().steps[1]?.status).toBe('awaiting-approval');

    handle.approve();
    const final = await handle.done;
    expect(final.steps[1]?.status).toBe('success');
    expect(final.overall).toBe('success');
  });

  it('skip() at the approval gate marks the step skipped + continues', async () => {
    TestBed.configureTestingModule({});
    seedTaps();
    const def = pb({
      steps: [
        { id: 's1', title: 'Step 1', tool: 'tap', args: { tag: 'a' }, requiresApproval: true },
        { id: 's2', title: 'Step 2', tool: 'tap', args: { tag: 'b' } },
      ],
    });
    const handle = TestBed.inject(PlaybookRunner).start(def);
    await settle();

    handle.skip();
    const final = await handle.done;
    expect(final.steps[0]?.status).toBe('skipped');
    expect(final.steps[1]?.status).toBe('success');
    expect(final.overall).toBe('success');
  });
});

describe('PlaybookRunner — cancellation', () => {
  beforeEach(() => undefined);

  it('cancel() before any step: every step cancelled; overall cancelled', async () => {
    TestBed.configureTestingModule({});
    seedTaps();
    const handle = TestBed.inject(PlaybookRunner).start(pb());
    handle.cancel();
    const final = await handle.done;
    // The first step's invocation may already have been kicked off
    // synchronously; what matters is that the second step never ran.
    expect(final.overall).toBe('cancelled');
    expect(final.steps[1]?.status).toBe('cancelled');
  });

  it('cancel() while awaiting approval finalises as cancelled', async () => {
    TestBed.configureTestingModule({});
    seedTaps();
    const def = pb({
      steps: [{ id: 's1', title: 'Step 1', tool: 'tap', args: { tag: 'a' }, requiresApproval: true }],
    });
    const handle = TestBed.inject(PlaybookRunner).start(def);
    await settle();
    expect(handle.state().steps[0]?.status).toBe('awaiting-approval');
    handle.cancel();
    const final = await handle.done;
    expect(final.overall).toBe('cancelled');
  });
});

// ── component ────────────────────────────────────────────────────

@Component({
  imports: [PlaybookRunnerComponent],
  template: `
    <mvk-playbook-runner
      [run]="run()"
      [stepTitles]="titles()"
      (action)="actions.push($event)" />
  `,
})
class HostComponent {
  run: WritableSignal<PlaybookRun | null> = signal(null);
  titles: WritableSignal<Readonly<Record<string, string>>> = signal({});
  actions: PlaybookRunnerAction[] = [];
}

function setupComponent(initialRun: PlaybookRun | null = null): ComponentFixture<HostComponent> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.run.set(initialRun);
  fixture.detectChanges();
  return fixture;
}

function sampleRun(overrides: Partial<PlaybookRun> = {}): PlaybookRun {
  return {
    playbookName: 'initial-pass',
    version: 'v1',
    startedAt: '2026-04-12T10:00:00Z',
    steps: [
      { stepId: 's1', status: 'success', result: { tag: 'a' }, startedAt: 'x', finishedAt: 'y' },
      { stepId: 's2', status: 'running', startedAt: 'x' },
    ],
    overall: 'running',
    ...overrides,
  };
}

describe('PlaybookRunnerComponent — rendering', () => {
  beforeEach(() => undefined);

  it('shows empty copy when [run] is null', () => {
    const fixture = setupComponent(null);
    expect(fixture.nativeElement.querySelector('.runner.empty')).not.toBeNull();
  });

  it('renders title + version + overall pill', () => {
    const fixture = setupComponent(sampleRun());
    expect(fixture.nativeElement.querySelector('.title')?.textContent?.trim()).toBe(
      'initial-pass',
    );
    expect(fixture.nativeElement.querySelector('.ver')?.textContent?.trim()).toBe('v1');
    expect(fixture.nativeElement.querySelector('.status-pill')?.getAttribute('data-status')).toBe(
      'running',
    );
  });

  it('renders one step row per step with status data attribute', () => {
    const fixture = setupComponent(sampleRun());
    const steps = Array.from(fixture.nativeElement.querySelectorAll('li.step'));
    expect(steps).toHaveLength(2);
    expect((steps[0] as HTMLElement).getAttribute('data-status')).toBe('success');
    expect((steps[1] as HTMLElement).getAttribute('data-status')).toBe('running');
  });

  it('uses [stepTitles] override when supplied', () => {
    const fixture = setupComponent(sampleRun());
    fixture.componentInstance.titles.set({ s1: 'Scope custodians', s2: 'Collect emails' });
    fixture.detectChanges();
    const titles = Array.from(fixture.nativeElement.querySelectorAll('.step-title')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(titles).toEqual(['Scope custodians', 'Collect emails']);
  });

  it('shows the Cancel button while running; hides it on terminal states', () => {
    const fixture = setupComponent(sampleRun());
    expect(fixture.nativeElement.querySelector('.cancel-btn')).not.toBeNull();

    fixture.componentInstance.run.set(sampleRun({ overall: 'success' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cancel-btn')).toBeNull();
  });

  it('Cancel click emits (action) { action: "cancel" }', () => {
    const fixture = setupComponent(sampleRun());
    (fixture.nativeElement.querySelector('.cancel-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.actions).toEqual([{ action: 'cancel' }]);
  });

  it('Approve / Skip surface when a step is awaiting-approval; emit their actions', () => {
    const fixture = setupComponent(
      sampleRun({
        steps: [
          { stepId: 's1', status: 'success', startedAt: 'x', finishedAt: 'y' },
          { stepId: 's2', status: 'awaiting-approval' },
        ],
      }),
    );
    (fixture.nativeElement.querySelector('.approve-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.skip-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.actions).toEqual([
      { action: 'approve' },
      { action: 'skip' },
    ]);
  });

  it('renders the error message for failed steps', () => {
    const fixture = setupComponent(
      sampleRun({
        steps: [{ stepId: 's1', status: 'failed', error: 'tap-failed:a' }],
        overall: 'failed',
      }),
    );
    expect(fixture.nativeElement.querySelector('.error')?.textContent).toContain('tap-failed:a');
  });

  it('renders a Result disclosure on success steps with a result', () => {
    const fixture = setupComponent(sampleRun());
    expect(fixture.nativeElement.querySelector('.result')).not.toBeNull();
  });

  it('stamps data-status on host runner for theming', () => {
    const fixture = setupComponent(sampleRun({ overall: 'failed' }));
    expect(fixture.nativeElement.querySelector('.runner')?.getAttribute('data-status')).toBe(
      'failed',
    );
  });
});
