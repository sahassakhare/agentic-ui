import { Component, input, signal, WritableSignal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ComponentRegistry,
  DataSourceRegistry,
  ToolRegistry,
  agenticDataSource,
  agenticTool,
  agenticWidget,
  type DataSourceDef,
  type ToolDef,
} from '../internal';
import type { TileDef } from '../types/registry-defs';
import {
  DashboardTileComponent,
  type DashboardTileDrilldown,
  type DashboardTileExplain,
} from './dashboard-tile.component';

// ── test widgets ──────────────────────────────────────────────────

@Component({
  selector: 'mvk-test-tile-value',
  template: `<div data-testid="val">value={{ stringify(value()) }}</div>`,
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
  imports: [DashboardTileComponent],
  template: `
    <mvk-dashboard-tile
      [tile]="tile()"
      [refreshTick]="refreshTick()"
      (drilldown)="drilldownCalls.push($event)"
      (explain)="explainCalls.push($event)" />
  `,
})
class HostComponent {
  tile: WritableSignal<TileDef> = signal({
    id: 't1',
    slot: 'a',
    title: 'tile 1',
    component: 'valueWidget',
    invocation: { kind: 'static', props: 'hello' },
  });
  refreshTick: WritableSignal<number> = signal(0);
  drilldownCalls: DashboardTileDrilldown[] = [];
  explainCalls: DashboardTileExplain[] = [];
}

function seedComponents(): void {
  TestBed.inject(ComponentRegistry).register(
    agenticWidget({
      name: 'valueWidget',
      component: TestValueWidgetComponent,
      propsSchema: z.object({ value: z.unknown().optional() }),
    }),
  );
}

/** Flush microtasks until pending tool/data fires have resolved + Angular has re-rendered. */
async function settle(fixture: ComponentFixture<HostComponent>): Promise<void> {
  // setTimeout goes through the macrotask queue; jsdom flushes all
  // pending microtasks first, so the tile's await chain in fire()
  // completes before we re-detect.
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
}

async function setup(initialTile: TileDef): Promise<ComponentFixture<HostComponent>> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  seedComponents();
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.tile.set(initialTile);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

function val(fixture: ComponentFixture<HostComponent>): string | null {
  const el = fixture.nativeElement.querySelector('[data-testid="val"]') as HTMLElement | null;
  return el?.textContent ?? null;
}

// ── static tiles ──────────────────────────────────────────────────

describe('DashboardTileComponent — static invocation', () => {
  beforeEach(() => undefined);

  it('renders the static props verbatim through the registered widget', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'Static',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 'hello' },
    });
    expect(val(fixture)).toContain('value=hello');
  });

  it('shows the tile title in the header', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'Production throughput',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 42 },
    });
    expect(fixture.nativeElement.querySelector('.tile-title')?.textContent?.trim()).toBe(
      'Production throughput',
    );
  });

  it('renders the unknown-widget stub when the ComponentRegistry name is not registered', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'Missing',
      component: 'never-registered',
      invocation: { kind: 'static', props: 'x' },
    });
    expect(fixture.nativeElement.querySelector('.state-blocked')?.textContent).toContain(
      'Unknown widget',
    );
  });
});

// ── tool tiles ────────────────────────────────────────────────────

describe('DashboardTileComponent — tool invocation', () => {
  beforeEach(() => undefined);

  it('invokes the tool with supplied args and renders the result', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedComponents();
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'computeThroughput',
        description: 'throughput',
        schema: z.object({ week: z.string() }),
        handler: async (args) => ({ week: args.week, count: 47 }),
      }) as ToolDef,
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tile.set({
      id: 't1',
      slot: 'a',
      title: 'Throughput',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'computeThroughput', args: { week: '2026-W19' } },
    });
    fixture.detectChanges();
    await settle(fixture);

    expect(val(fixture)).toContain('"count":47');
  });

  it('renders persona-blocked stub when the tool is not visible to the active persona', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedComponents();
    const tools = TestBed.inject(ToolRegistry);
    tools.register(
      agenticTool({
        name: 'restrictedTool',
        description: '',
        schema: z.object({}),
        handler: async () => ({}),
      }) as ToolDef,
    );
    tools.setScopePolicy(() => false);

    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tile.set({
      id: 't1',
      slot: 'a',
      title: 'Restricted',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'restrictedTool', args: {} },
    });
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.nativeElement.querySelector('.state-blocked')?.textContent).toContain(
      'Unavailable',
    );
  });

  it('renders error state with message when the tool throws', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedComponents();
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'failingTool',
        description: '',
        schema: z.object({}),
        handler: async () => {
          throw new Error('upstream timeout');
        },
      }) as ToolDef,
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tile.set({
      id: 't1',
      slot: 'a',
      title: 'Will fail',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'failingTool', args: {} },
    });
    fixture.detectChanges();
    await settle(fixture);

    const err = fixture.nativeElement.querySelector('.state-error') as HTMLElement | null;
    expect(err).not.toBeNull();
    expect(err?.getAttribute('title')).toBe('upstream timeout');
  });

  it('treats unknown-tool-name as persona-blocked (same "not visible" semantic) and renders the unavailable stub', async () => {
    // From the tile's point of view there's no distinction between
    // "the tool exists but the persona can't see it" and "the tool
    // doesn't exist at all" -- both render as the unavailable stub.
    // The catalog's ops console surfaces the underlying cause; the
    // user-facing stub stays single-language.
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'Bad tool',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'no-such-tool', args: {} },
    });
    expect(fixture.nativeElement.querySelector('.state-blocked')?.textContent).toContain(
      'Unavailable',
    );
  });
});

// ── data tiles ────────────────────────────────────────────────────

describe('DashboardTileComponent — data invocation', () => {
  beforeEach(() => undefined);

  it('reads from the DataSourceRegistry via adapter() and renders the result', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedComponents();
    TestBed.inject(DataSourceRegistry).register(
      agenticDataSource({
        name: 'docs',
        kind: 'rest',
        adapter: (query) => Promise.resolve({ docs: 12, query }),
      }) as DataSourceDef,
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tile.set({
      id: 't1',
      slot: 'a',
      title: 'Doc count',
      component: 'valueWidget',
      invocation: { kind: 'data', source: 'docs', query: { matter: 'M-1' } },
    });
    fixture.detectChanges();
    await settle(fixture);

    expect(val(fixture)).toContain('"docs":12');
  });

  it('renders error stub when the data source is missing', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'No source',
      component: 'valueWidget',
      invocation: { kind: 'data', source: 'never-registered', query: {} },
    });
    expect(fixture.nativeElement.querySelector('.state-error')?.getAttribute('title')).toBe(
      'Unknown data source "never-registered"',
    );
  });
});

// ── drilldown + explain ──────────────────────────────────────────

describe('DashboardTileComponent — drilldown + explain', () => {
  beforeEach(() => undefined);

  it('emits drilldown with the typed target on body click', async () => {
    const fixture = await setup({
      id: 't-prod',
      slot: 'a',
      title: 'Throughput',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 42 },
      drilldown: { route: '/dashboards/production-throughput' },
    });
    (fixture.nativeElement.querySelector('.body') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.drilldownCalls).toEqual([
      { tileId: 't-prod', target: { route: '/dashboards/production-throughput' } },
    ]);
  });

  it('does not emit drilldown when no drilldown target is set', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'Plain',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 1 },
    });
    (fixture.nativeElement.querySelector('.body') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.drilldownCalls).toEqual([]);
  });

  it('shows the Explain affordance only when tile.explainable is true', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'No explain',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 1 },
    });
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Explain this tile"]'),
    ).toBeNull();

    fixture.componentInstance.tile.set({
      id: 't1',
      slot: 'a',
      title: 'Explain',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 1 },
      explainable: true,
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Explain this tile"]'),
    ).not.toBeNull();
  });

  it('emits explain with the current value when the affordance is clicked', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'Explain me',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 47 },
      explainable: true,
    });
    (fixture.nativeElement.querySelector('button[aria-label="Explain this tile"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.explainCalls).toEqual([{ tileId: 't1', value: 47 }]);
  });
});

// ── refresh button + event-tick refresh ──────────────────────────

describe('DashboardTileComponent — refresh', () => {
  beforeEach(() => undefined);

  it('refresh button re-fires the tile invocation', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedComponents();
    let calls = 0;
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'countingTool',
        description: '',
        schema: z.object({}),
        handler: async () => {
          calls += 1;
          return calls;
        },
      }) as ToolDef,
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tile.set({
      id: 't1',
      slot: 'a',
      title: 'Counter',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'countingTool', args: {} },
    });
    fixture.detectChanges();
    await settle(fixture);
    expect(calls).toBe(1);

    (fixture.nativeElement.querySelector('button[aria-label="Refresh tile"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settle(fixture);
    expect(calls).toBe(2);
  });

  it('refreshTick input re-fires the invocation for refreshOn:event tiles', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedComponents();
    let calls = 0;
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'eventTool',
        description: '',
        schema: z.object({}),
        handler: async () => {
          calls += 1;
          return calls;
        },
      }) as ToolDef,
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tile.set({
      id: 't1',
      slot: 'a',
      title: 'Event-driven',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'eventTool', args: {} },
      refreshOn: 'event',
    });
    fixture.detectChanges();
    await settle(fixture);
    expect(calls).toBe(1);

    fixture.componentInstance.refreshTick.set(1);
    fixture.detectChanges();
    await settle(fixture);
    expect(calls).toBe(2);
  });
});
