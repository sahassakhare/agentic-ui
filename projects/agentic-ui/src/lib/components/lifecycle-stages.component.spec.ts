import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  LifecycleStagesComponent,
  type StageAction,
  type StageDef,
  type StageStatus,
} from './lifecycle-stages.component';

function stage(id: string, status: StageStatus, overrides: Partial<StageDef> = {}): StageDef {
  return {
    id,
    title: id.charAt(0).toUpperCase() + id.slice(1),
    status,
    ...overrides,
  };
}

@Component({
  imports: [LifecycleStagesComponent],
  template: `
    <mvk-lifecycle-stages
      [stages]="stages()"
      [title]="title()"
      [orientation]="orientation()"
      (action)="received.push($event)" />
  `,
})
class HostComponent {
  stages: WritableSignal<readonly StageDef[]> = signal([]);
  title: WritableSignal<string | undefined> = signal(undefined);
  orientation: WritableSignal<'horizontal' | 'vertical'> = signal('horizontal');
  received: StageAction[] = [];
}

function setup(initial: Partial<HostComponent> = {}): ComponentFixture<HostComponent> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  for (const [k, v] of Object.entries(initial)) {
    const sig = (fixture.componentInstance as unknown as Record<string, WritableSignal<unknown>>)[k];
    if (typeof sig === 'function' && 'set' in sig) sig.set(v);
  }
  fixture.detectChanges();
  return fixture;
}

function stages(fixture: ComponentFixture<HostComponent>): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('li.stage')) as HTMLElement[];
}

// ── rendering ─────────────────────────────────────────────────────

describe('LifecycleStagesComponent — rendering', () => {
  beforeEach(() => undefined);

  it('renders one li.stage per supplied stage', () => {
    const fixture = setup({
      stages: [
        stage('issue', 'done'),
        stage('acknowledge', 'active'),
        stage('track', 'pending'),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    expect(stages(fixture)).toHaveLength(3);
  });

  it('encodes status as data-status on the stage and the marker', () => {
    const fixture = setup({
      stages: [
        stage('a', 'done'),
        stage('b', 'active'),
        stage('c', 'blocked'),
        stage('d', 'failed'),
        stage('e', 'pending'),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    const got = stages(fixture).map((el) => el.getAttribute('data-status'));
    expect(got).toEqual(['done', 'active', 'blocked', 'failed', 'pending']);

    const markers = Array.from(fixture.nativeElement.querySelectorAll('.marker')).map((el) =>
      (el as HTMLElement).getAttribute('data-status'),
    );
    expect(markers).toEqual(['done', 'active', 'blocked', 'failed', 'pending']);
  });

  it('marks the active stage with aria-current="step"', () => {
    const fixture = setup({
      stages: [stage('a', 'done'), stage('b', 'active'), stage('c', 'pending')] as unknown as WritableSignal<readonly StageDef[]>,
    });
    const aria = stages(fixture).map((el) => el.getAttribute('aria-current'));
    expect(aria).toEqual([null, 'step', null]);
  });

  it('uses a different glyph per status (✓ done · ● active · ⏸ blocked · ✗ failed · ○ pending)', () => {
    const fixture = setup({
      stages: [
        stage('a', 'done'),
        stage('b', 'active'),
        stage('c', 'blocked'),
        stage('d', 'failed'),
        stage('e', 'pending'),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    const glyphs = Array.from(fixture.nativeElement.querySelectorAll('.marker')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(glyphs).toEqual(['✓', '●', '⏸', '✗', '○']);
  });

  it('shows title + N/total complete in the header when [title] is set', () => {
    const fixture = setup({
      title: 'Hold H-117' as unknown as WritableSignal<string>,
      stages: [
        stage('a', 'done'),
        stage('b', 'done'),
        stage('c', 'active'),
        stage('d', 'pending'),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    expect(fixture.nativeElement.querySelector('.title')?.textContent?.trim()).toBe('Hold H-117');
    expect(fixture.nativeElement.querySelector('.progress')?.textContent?.trim()).toBe('2 / 4 complete');
  });

  it('omits the header when [title] is empty', () => {
    const fixture = setup({
      stages: [stage('a', 'done')] as unknown as WritableSignal<readonly StageDef[]>,
    });
    expect(fixture.nativeElement.querySelector('.head')).toBeNull();
  });
});

// ── orientation ───────────────────────────────────────────────────

describe('LifecycleStagesComponent — orientation', () => {
  beforeEach(() => undefined);

  it('defaults to horizontal', () => {
    const fixture = setup({
      stages: [stage('a', 'done')] as unknown as WritableSignal<readonly StageDef[]>,
    });
    expect(fixture.nativeElement.querySelector('.lifecycle')?.getAttribute('data-orientation')).toBe(
      'horizontal',
    );
  });

  it('honours vertical orientation via input', () => {
    const fixture = setup({
      stages: [stage('a', 'done')] as unknown as WritableSignal<readonly StageDef[]>,
      orientation: 'vertical' as unknown as WritableSignal<'horizontal' | 'vertical'>,
    });
    expect(fixture.nativeElement.querySelector('.lifecycle')?.getAttribute('data-orientation')).toBe(
      'vertical',
    );
  });
});

// ── owner / sla / description ─────────────────────────────────────

describe('LifecycleStagesComponent — metadata', () => {
  beforeEach(() => undefined);

  it('renders owner attribution per stage', () => {
    const fixture = setup({
      stages: [
        stage('a', 'done', { owner: 'partner: Sarah' }),
        stage('b', 'active', { owner: 'awaiting 3 custodians' }),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    const owners = Array.from(fixture.nativeElement.querySelectorAll('.owner')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(owners).toEqual(['partner: Sarah', 'awaiting 3 custodians']);
  });

  it('renders SLA warning chip when set', () => {
    const fixture = setup({
      stages: [stage('a', 'active', { slaWarning: '2 days overdue' })] as unknown as WritableSignal<readonly StageDef[]>,
    });
    const chip = fixture.nativeElement.querySelector('.sla');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('2 days overdue');
  });

  it('renders stage description when set', () => {
    const fixture = setup({
      stages: [
        stage('a', 'active', { description: 'Wait for custodian to acknowledge' }),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    expect(fixture.nativeElement.querySelector('.desc')?.textContent?.trim()).toBe(
      'Wait for custodian to acknowledge',
    );
  });
});

// ── action emission ───────────────────────────────────────────────

describe('LifecycleStagesComponent — action emission', () => {
  beforeEach(() => undefined);

  it('renders the action button on active stages with an action defined', () => {
    const fixture = setup({
      stages: [
        stage('a', 'active', { action: { label: 'Send reminders', key: 'send-reminders' } }),
        stage('b', 'pending'),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    const btns = Array.from(fixture.nativeElement.querySelectorAll('.stage-action'));
    expect(btns).toHaveLength(1);
    expect((btns[0] as HTMLElement).textContent?.trim()).toBe('Send reminders');
  });

  it('renders the action button on blocked stages with an action defined', () => {
    const fixture = setup({
      stages: [
        stage('a', 'blocked', { action: { label: 'Unblock', key: 'unblock' } }),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    expect(fixture.nativeElement.querySelectorAll('.stage-action')).toHaveLength(1);
  });

  it('does NOT render the action button on done/pending/failed stages', () => {
    const fixture = setup({
      stages: [
        stage('a', 'done', { action: { label: 'Re-run', key: 'rerun' } }),
        stage('b', 'pending', { action: { label: 'Skip', key: 'skip' } }),
        stage('c', 'failed', { action: { label: 'Retry', key: 'retry' } }),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    expect(fixture.nativeElement.querySelectorAll('.stage-action')).toHaveLength(0);
  });

  it('emits action with stageId + actionKey on click', () => {
    const fixture = setup({
      stages: [
        stage('a', 'active', { action: { label: 'Send', key: 'send-reminders' } }),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    (fixture.nativeElement.querySelector('.stage-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.received).toEqual([{ stageId: 'a', actionKey: 'send-reminders' }]);
  });
});

// ── connectors ────────────────────────────────────────────────────

describe('LifecycleStagesComponent — connectors', () => {
  beforeEach(() => undefined);

  it('renders a connector between consecutive stages (N-1 connectors for N stages)', () => {
    const fixture = setup({
      stages: [
        stage('a', 'done'),
        stage('b', 'active'),
        stage('c', 'pending'),
        stage('d', 'pending'),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    expect(fixture.nativeElement.querySelectorAll('.connector')).toHaveLength(3);
  });

  it('marks the connector .connector-done when the preceding stage is done', () => {
    const fixture = setup({
      stages: [
        stage('a', 'done'),
        stage('b', 'done'),
        stage('c', 'active'),
      ] as unknown as WritableSignal<readonly StageDef[]>,
    });
    const connectors = Array.from(fixture.nativeElement.querySelectorAll('.connector')) as HTMLElement[];
    expect(connectors[0]?.classList.contains('connector-done')).toBe(true);
    expect(connectors[1]?.classList.contains('connector-done')).toBe(true);
    // No connector after the last stage; only N-1 of them.
    expect(connectors).toHaveLength(2);
  });
});
