import { Component, input, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ComponentRegistry,
  LayoutRegistry,
  ToolRegistry,
  agenticTool,
  agenticWidget,
  type LayoutDef,
  type ToolDef,
} from '../internal';
import type { DashboardDef, TileDef } from '../types/registry-defs';
import {
  DashboardCanvasComponent,
  type CanvasTileDrilldown,
  type CanvasTileExplain,
} from './dashboard-canvas.component';

@Component({
  selector: 'mvk-test-tile-value',
  template: `<div data-testid="val">val={{ stringify(value()) }}</div>`,
})
class TestValueWidgetComponent {
  readonly value = input<unknown>(undefined);
  stringify(v: unknown): string {
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
}

@Component({
  imports: [DashboardCanvasComponent],
  template: `
    <mvk-dashboard-canvas
      [dashboard]="dashboard()"
      (drilldown)="drilldowns.push($event)"
      (explain)="explains.push($event)" />
  `,
})
class HostComponent {
  dashboard: WritableSignal<DashboardDef | null> = signal(null);
  drilldowns: CanvasTileDrilldown[] = [];
  explains: CanvasTileExplain[] = [];
}

function seedFixtures(): void {
  TestBed.inject(ComponentRegistry).register(
    agenticWidget({
      name: 'valueWidget',
      component: TestValueWidgetComponent,
      propsSchema: z.object({ value: z.unknown().optional() }),
    }),
  );

  // A minimal layout with two slots: primary + sidebar.
  TestBed.inject(LayoutRegistry).register({
    name: 'two-col',
    description: '',
    slots: ['primary', 'sidebar'],
    component: TestValueWidgetComponent,   // unused for the canvas path
  } as LayoutDef);
}

async function settle(fixture: ComponentFixture<HostComponent>): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
}

async function setup(dashboard: DashboardDef | null): Promise<ComponentFixture<HostComponent>> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  seedFixtures();
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.dashboard.set(dashboard);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

function tile(id: string, slot: string, overrides: Partial<TileDef> = {}): TileDef {
  return {
    id,
    slot,
    title: `Tile ${id}`,
    component: 'valueWidget',
    invocation: { kind: 'static', props: `value-${id}` },
    ...overrides,
  };
}

// ── empty / header ───────────────────────────────────────────────

describe('DashboardCanvasComponent — header + empty', () => {
  beforeEach(() => undefined);

  it('shows the empty state when [dashboard] is null', async () => {
    const fixture = await setup(null);
    expect(fixture.nativeElement.querySelector('.canvas.empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.canvas.empty')?.textContent).toContain('No dashboard');
  });

  it('renders title + description in the header', async () => {
    const fixture = await setup({
      name: 'matter-health',
      title: 'Matter health',
      description: 'Daily snapshot of open holds + production status',
      layout: 'two-col',
      tiles: [],
    });
    expect(fixture.nativeElement.querySelector('.title')?.textContent?.trim()).toBe('Matter health');
    expect(fixture.nativeElement.querySelector('.desc')?.textContent?.trim()).toContain('Daily snapshot');
  });
});

// ── layout resolution + slot composition ─────────────────────────

describe('DashboardCanvasComponent — layout + slots', () => {
  beforeEach(() => undefined);

  it('renders one .slot per declared slot of the resolved layout in declared order', async () => {
    const fixture = await setup({
      name: 'd',
      title: 't',
      layout: 'two-col',
      tiles: [tile('a', 'primary'), tile('b', 'sidebar')],
    });
    const slots = Array.from(fixture.nativeElement.querySelectorAll('.slot')).map((el) =>
      (el as HTMLElement).getAttribute('data-slot'),
    );
    expect(slots).toEqual(['primary', 'sidebar']);
  });

  it('pins each tile into its declared slot', async () => {
    const fixture = await setup({
      name: 'd',
      title: 't',
      layout: 'two-col',
      tiles: [tile('a', 'primary'), tile('b', 'sidebar')],
    });
    const primary = fixture.nativeElement.querySelector('.slot[data-slot="primary"]') as HTMLElement;
    const sidebar = fixture.nativeElement.querySelector('.slot[data-slot="sidebar"]') as HTMLElement;
    expect(primary.textContent).toContain('val=value-a');
    expect(sidebar.textContent).toContain('val=value-b');
  });

  it('stacks multiple tiles in the same slot', async () => {
    const fixture = await setup({
      name: 'd',
      title: 't',
      layout: 'two-col',
      tiles: [tile('a', 'primary'), tile('b', 'primary'), tile('c', 'sidebar')],
    });
    const primaryTiles = fixture.nativeElement.querySelectorAll('.slot[data-slot="primary"] mvk-dashboard-tile');
    expect(primaryTiles).toHaveLength(2);
  });

  it('renders tiles whose slot is not declared by the layout under an "(unslotted)" group with a warning', async () => {
    const fixture = await setup({
      name: 'd',
      title: 't',
      layout: 'two-col',
      tiles: [tile('a', 'primary'), tile('typo', 'sideabar')],
    });
    const unslotted = fixture.nativeElement.querySelector('.slot-unslotted') as HTMLElement;
    expect(unslotted).not.toBeNull();
    expect(unslotted.textContent).toContain('1 tile(s) reference slots not declared');
    expect(unslotted.textContent).toContain('val=value-typo');
  });

  it('supports an inline LayoutDef (no LayoutRegistry round-trip)', async () => {
    const inlineLayout: LayoutDef = {
      name: 'inline',
      description: '',
      slots: ['main'],
      component: TestValueWidgetComponent,
    };
    const fixture = await setup({
      name: 'd',
      title: 't',
      layout: inlineLayout,
      tiles: [tile('a', 'main')],
    });
    expect(fixture.nativeElement.querySelector('.slot[data-slot="main"]')).not.toBeNull();
  });
});

// ── filters ──────────────────────────────────────────────────────

describe('DashboardCanvasComponent — filters', () => {
  beforeEach(() => undefined);

  it('renders one chip per FilterDef', async () => {
    const fixture = await setup({
      name: 'd',
      title: 't',
      layout: 'two-col',
      tiles: [],
      filters: [
        { id: 'matters', argKey: 'matterIds', value: ['M-1', 'M-2'], label: 'Matters' },
        { id: 'window', argKey: 'days', value: 30, label: 'Window' },
      ],
    });
    const chips = Array.from(fixture.nativeElement.querySelectorAll('.chip'));
    expect(chips).toHaveLength(2);
    expect((chips[0] as HTMLElement).textContent).toContain('Matters');
    expect((chips[1] as HTMLElement).textContent).toContain('Window');
  });

  it('threads filter values into every tool tile\'s args', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedFixtures();
    const calls: { args: unknown }[] = [];
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'rollup',
        description: '',
        schema: z.object({ matterIds: z.array(z.string()), days: z.number() }),
        handler: async (args) => {
          calls.push({ args });
          return args;
        },
      }) as ToolDef,
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.dashboard.set({
      name: 'd',
      title: 't',
      layout: 'two-col',
      tiles: [
        {
          id: 'a',
          slot: 'primary',
          title: 'Rollup',
          component: 'valueWidget',
          invocation: { kind: 'tool', tool: 'rollup', args: { days: 30 } },
        },
      ],
      filters: [
        { id: 'matters', argKey: 'matterIds', value: ['M-1', 'M-2'], label: 'Matters' },
      ],
    });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual({ matterIds: ['M-1', 'M-2'], days: 30 });
  });

  it('tile-level args win over filter values on key collision', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedFixtures();
    const calls: { args: unknown }[] = [];
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'rollup',
        description: '',
        schema: z.object({ days: z.number() }),
        handler: async (args) => {
          calls.push({ args });
          return args;
        },
      }) as ToolDef,
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.dashboard.set({
      name: 'd',
      title: 't',
      layout: 'two-col',
      tiles: [
        {
          id: 'a',
          slot: 'primary',
          title: 'Rollup',
          component: 'valueWidget',
          // tile says days=7 — should override the filter's days=30
          invocation: { kind: 'tool', tool: 'rollup', args: { days: 7 } },
        },
      ],
      filters: [{ id: 'window', argKey: 'days', value: 30, label: 'Window' }],
    });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));

    expect((calls[0]?.args as { days: number }).days).toBe(7);
  });

  it('does not modify data/static tile args', async () => {
    const fixture = await setup({
      name: 'd',
      title: 't',
      layout: 'two-col',
      tiles: [tile('a', 'primary')],     // kind: 'static'
      filters: [{ id: 'f', argKey: 'shouldNotAppear', value: 'X', label: 'F' }],
    });
    // Static tile renders value-a verbatim, unaffected by filters.
    expect(fixture.nativeElement.querySelector('[data-testid="val"]')?.textContent).toContain(
      'val=value-a',
    );
  });
});

// ── bubble events ────────────────────────────────────────────────

describe('DashboardCanvasComponent — bubble drilldown + explain', () => {
  beforeEach(() => undefined);

  it('bubbles tile drilldown with the dashboard name attached', async () => {
    const fixture = await setup({
      name: 'matter-health',
      title: 't',
      layout: 'two-col',
      tiles: [
        tile('a', 'primary', { drilldown: { route: '/matters/M-1' } }),
      ],
    });
    (fixture.nativeElement.querySelector('mvk-dashboard-tile .body') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.drilldowns).toEqual([
      { tileId: 'a', target: { route: '/matters/M-1' }, dashboardName: 'matter-health' },
    ]);
  });

  it('bubbles tile explain with the dashboard name attached', async () => {
    const fixture = await setup({
      name: 'matter-health',
      title: 't',
      layout: 'two-col',
      tiles: [tile('a', 'primary', { explainable: true })],
    });
    const explainBtn = fixture.nativeElement.querySelector(
      'button[aria-label="Explain this tile"]',
    ) as HTMLButtonElement;
    explainBtn.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.explains).toHaveLength(1);
    expect(fixture.componentInstance.explains[0]?.tileId).toBe('a');
    expect(fixture.componentInstance.explains[0]?.dashboardName).toBe('matter-health');
  });
});

// ── refresh all ──────────────────────────────────────────────────

describe('DashboardCanvasComponent — refresh-all', () => {
  beforeEach(() => undefined);

  it('refresh-all button re-fires every refreshOn:event tile', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedFixtures();
    let calls = 0;
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'tick',
        description: '',
        schema: z.object({}),
        handler: async () => {
          calls += 1;
          return calls;
        },
      }) as ToolDef,
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.dashboard.set({
      name: 'd',
      title: 't',
      layout: 'two-col',
      tiles: [
        {
          id: 't1',
          slot: 'primary',
          title: 'T',
          component: 'valueWidget',
          invocation: { kind: 'tool', tool: 'tick', args: {} },
          refreshOn: 'event',
        },
      ],
    });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(calls).toBe(1);

    (fixture.nativeElement.querySelector('.refresh-all') as HTMLButtonElement).click();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(calls).toBe(2);
  });
});
