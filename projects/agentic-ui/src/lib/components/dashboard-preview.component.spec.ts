import { Component, input, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ComponentRegistry,
  LayoutRegistry,
  agenticWidget,
  type LayoutDef,
} from '../internal';
import type { DashboardDef, TileDef } from '../types/registry-defs';
import {
  DashboardPreviewComponent,
  bumpDashboardVersion,
} from './dashboard-preview.component';

@Component({
  selector: 'mvk-test-pill',
  template: `<span data-testid="pill">pill={{ value() }}</span>`,
})
class TestPillComponent {
  readonly value = input<unknown>(undefined);
}

@Component({
  selector: 'mvk-test-chart',
  template: `<span data-testid="chart">chart</span>`,
})
class TestChartComponent {
  readonly value = input<unknown>(undefined);
}

@Component({
  imports: [DashboardPreviewComponent],
  template: `
    <mvk-dashboard-preview
      [draft]="draft()"
      (commit)="commits.push($event)"
      (discard)="onDiscard()"
      (draftChange)="draftChanges.push($event)" />
  `,
})
class HostComponent {
  draft: WritableSignal<DashboardDef | null> = signal(null);
  commits: DashboardDef[] = [];
  discardCount = 0;
  draftChanges: DashboardDef[] = [];
  onDiscard(): void { this.discardCount++; }
}

function seedFixtures(): void {
  TestBed.inject(ComponentRegistry).register(
    agenticWidget({
      name: 'countTile',
      component: TestPillComponent,
      propsSchema: z.object({ value: z.unknown().optional() }),
    }),
  );
  TestBed.inject(ComponentRegistry).register(
    agenticWidget({
      name: 'chartTile',
      component: TestChartComponent,
      propsSchema: z.object({ value: z.unknown().optional() }),
    }),
  );
  TestBed.inject(LayoutRegistry).register({
    name: 'simple',
    description: '',
    slots: ['primary'],
    component: TestPillComponent,
  } as LayoutDef);
}

function makeDraft(overrides: Partial<DashboardDef> = {}): DashboardDef {
  return {
    name: 'draft',
    title: 'Draft dashboard',
    description: 'Built by the agent',
    layout: 'simple',
    tiles: [
      tile('open-holds'),
      tile('production-stage', { component: 'chartTile' }),
    ],
    ...overrides,
  };
}

function tile(id: string, overrides: Partial<TileDef> = {}): TileDef {
  return {
    id,
    slot: 'primary',
    title: `Tile ${id}`,
    component: 'countTile',
    invocation: { kind: 'static', props: id },
    ...overrides,
  };
}

async function setup(draft: DashboardDef | null): Promise<ComponentFixture<HostComponent>> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  seedFixtures();
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.draft.set(draft);
  fixture.detectChanges();
  // Constructor microtask + canvas async settling.
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  return fixture;
}

function preview(fixture: ComponentFixture<HostComponent>): DashboardPreviewComponent {
  return fixture.debugElement.query(By.directive(DashboardPreviewComponent))
    .componentInstance as DashboardPreviewComponent;
}

// ── empty + initial render ────────────────────────────────────────

describe('DashboardPreviewComponent — empty + initial render', () => {
  beforeEach(() => undefined);

  it('shows empty state when [draft] is null', async () => {
    const fixture = await setup(null);
    expect(fixture.nativeElement.querySelector('.preview.empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.preview.empty')?.textContent).toContain('No draft');
  });

  it('renders title + description inputs hydrated from the draft', async () => {
    const fixture = await setup(makeDraft());
    const titleInput = fixture.nativeElement.querySelector('input.title-input') as HTMLInputElement;
    const descInput = fixture.nativeElement.querySelector('input.desc-input') as HTMLInputElement;
    expect(titleInput.value).toBe('Draft dashboard');
    expect(descInput.value).toBe('Built by the agent');
  });

  it('renders DRAFT badge + the embedded mvk-dashboard-canvas', async () => {
    const fixture = await setup(makeDraft());
    expect(fixture.nativeElement.querySelector('.badge')?.textContent?.trim()).toBe('DRAFT');
    expect(fixture.nativeElement.querySelector('mvk-dashboard-canvas')).not.toBeNull();
  });

  it('lists every tile in the side panel with id + slot + invocation kind', async () => {
    const fixture = await setup(makeDraft());
    const rows = Array.from(fixture.nativeElement.querySelectorAll('li.tile-row'));
    expect(rows).toHaveLength(2);
    expect((rows[0] as HTMLElement).textContent).toContain('open-holds');
    expect((rows[0] as HTMLElement).textContent).toContain('primary');
    expect((rows[0] as HTMLElement).textContent).toContain('static');
  });
});

// ── inline edits ──────────────────────────────────────────────────

describe('DashboardPreviewComponent — inline edits', () => {
  beforeEach(() => undefined);

  it('setTitle updates the working draft and emits draftChange', async () => {
    const fixture = await setup(makeDraft());
    const p = preview(fixture) as unknown as { setTitle: (s: string) => void };
    p.setTitle('Revised title');
    fixture.detectChanges();
    const last = fixture.componentInstance.draftChanges.at(-1);
    expect(last?.title).toBe('Revised title');
  });

  it('setDescription writes the new value (empty -> undefined)', async () => {
    const fixture = await setup(makeDraft());
    const p = preview(fixture) as unknown as { setDescription: (s: string) => void };
    p.setDescription('New desc');
    fixture.detectChanges();
    expect(fixture.componentInstance.draftChanges.at(-1)?.description).toBe('New desc');

    p.setDescription('');
    fixture.detectChanges();
    expect(fixture.componentInstance.draftChanges.at(-1)?.description).toBeUndefined();
  });

  it('swapComponent replaces the tile\'s component name + emits draftChange', async () => {
    const fixture = await setup(makeDraft());
    const p = preview(fixture) as unknown as { swapComponent: (id: string, comp: string) => void };
    p.swapComponent('open-holds', 'chartTile');
    fixture.detectChanges();
    const last = fixture.componentInstance.draftChanges.at(-1)!;
    const updated = last.tiles.find((t) => t.id === 'open-holds');
    expect(updated?.component).toBe('chartTile');
  });

  it('swapComponent leaves the other tiles untouched', async () => {
    const fixture = await setup(makeDraft());
    const p = preview(fixture) as unknown as { swapComponent: (id: string, comp: string) => void };
    p.swapComponent('open-holds', 'chartTile');
    fixture.detectChanges();
    const last = fixture.componentInstance.draftChanges.at(-1)!;
    const other = last.tiles.find((t) => t.id === 'production-stage');
    expect(other?.component).toBe('chartTile');     // original draft already had chartTile
  });

  it('removeTile drops the tile from the working draft', async () => {
    const fixture = await setup(makeDraft());
    const p = preview(fixture) as unknown as { removeTile: (id: string) => void };
    p.removeTile('open-holds');
    fixture.detectChanges();
    const last = fixture.componentInstance.draftChanges.at(-1)!;
    expect(last.tiles.map((t) => t.id)).toEqual(['production-stage']);
  });

  it('clicking the remove × button drops the tile through the UI path', async () => {
    const fixture = await setup(makeDraft());
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button.remove-btn'),
    ) as HTMLButtonElement[];
    buttons[0]?.click();
    fixture.detectChanges();
    const last = fixture.componentInstance.draftChanges.at(-1)!;
    expect(last.tiles).toHaveLength(1);
  });

  it('available components dropdown lists every ComponentRegistry name', async () => {
    const fixture = await setup(makeDraft());
    const options = Array.from(
      fixture.nativeElement.querySelectorAll('select.component-select option'),
    ).map((el) => (el as HTMLOptionElement).value);
    // First select; same options on every select.
    expect(options.slice(0, 2)).toEqual(['countTile', 'chartTile']);
  });
});

// ── commit / discard ──────────────────────────────────────────────

describe('DashboardPreviewComponent — commit + discard', () => {
  beforeEach(() => undefined);

  it('commit button emits (commit) with the working draft', async () => {
    const fixture = await setup(makeDraft());
    const p = preview(fixture) as unknown as { setTitle: (s: string) => void };
    p.setTitle('Edited');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button.commit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.commits).toHaveLength(1);
    expect(fixture.componentInstance.commits[0]?.title).toBe('Edited');
  });

  it('discard button emits (discard)', async () => {
    const fixture = await setup(makeDraft());
    (fixture.nativeElement.querySelector('button.discard') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.discardCount).toBe(1);
  });

  it('commit does NOT mutate the original [draft] input (defensive cloning)', async () => {
    const original = makeDraft({ tiles: [tile('only-one')] });
    const fixture = await setup(original);
    const p = preview(fixture) as unknown as { removeTile: (id: string) => void };
    p.removeTile('only-one');
    (fixture.nativeElement.querySelector('button.commit') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Original draft retained its tile; the committed draft is a new object with no tiles.
    expect(original.tiles).toHaveLength(1);
    expect(fixture.componentInstance.commits[0]?.tiles).toHaveLength(0);
  });
});

// ── bumpDashboardVersion helper ───────────────────────────────────

describe('bumpDashboardVersion', () => {
  it('promotes "v1" to "v2" and chains parentVersion', () => {
    const prev: DashboardDef = { ...makeDraft(), version: 'v1' };
    const draft: DashboardDef = { ...makeDraft(), title: 'Edited' };
    const next = bumpDashboardVersion(prev, draft);
    expect(next.version).toBe('v2');
    expect(next.parentVersion).toBe('v1');
    expect(next.title).toBe('Edited');
  });

  it('defaults to "v1" when prev has no version', () => {
    const prev: DashboardDef = { ...makeDraft() };
    const draft: DashboardDef = { ...makeDraft() };
    const next = bumpDashboardVersion(prev, draft);
    expect(next.version).toBe('v1');
    expect(next.parentVersion).toBeUndefined();
  });

  it('falls through to "<prev>+1" suffix when version is not semver-ish', () => {
    const prev: DashboardDef = { ...makeDraft(), version: 'r3-alpha' };
    const draft: DashboardDef = { ...makeDraft() };
    const next = bumpDashboardVersion(prev, draft);
    expect(next.version).toBe('r3-alpha+1');
    expect(next.parentVersion).toBe('r3-alpha');
  });
});
