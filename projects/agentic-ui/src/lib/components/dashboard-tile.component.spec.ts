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
  type DashboardTileAnnotate,
  type DashboardTileDrilldown,
  type DashboardTileExplain,
  type TileAnnotation,
} from './dashboard-tile.component';
import { TileResultCache } from './tile-result-cache';

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
      [annotations]="annotations()"
      (drilldown)="drilldownCalls.push($event)"
      (explain)="explainCalls.push($event)"
      (annotate)="annotateCalls.push($event)" />
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
  annotations: WritableSignal<readonly TileAnnotation[]> = signal([]);
  drilldownCalls: DashboardTileDrilldown[] = [];
  explainCalls: DashboardTileExplain[] = [];
  annotateCalls: DashboardTileAnnotate[] = [];
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

// ── annotations ──────────────────────────────────────────────────

describe('DashboardTileComponent — annotations', () => {
  beforeEach(() => undefined);

  it('hides the notes badge when no annotations supplied', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'No notes',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 1 },
    });
    expect(fixture.nativeElement.querySelector('button.note-btn')).toBeNull();
  });

  it('shows the notes badge with count when annotations are provided', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'With notes',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 1 },
    });
    fixture.componentInstance.annotations.set([
      { id: 'a', author: 'Sarah', body: 'Worth a deeper look', createdAt: '2026-04-12T10:00:00Z' },
      { id: 'b', author: 'GC',    body: 'Approved',           createdAt: '2026-04-13T08:00:00Z' },
    ]);
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('button.note-btn') as HTMLButtonElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('2');
  });

  it('toggles the notes panel open/closed on badge click', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'With notes',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 1 },
    });
    fixture.componentInstance.annotations.set([
      { id: 'a', author: 'Sarah', body: 'A note', createdAt: '2026-04-12T10:00:00Z' },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('section.notes')).toBeNull();

    (fixture.nativeElement.querySelector('button.note-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('section.notes')).not.toBeNull();

    (fixture.nativeElement.querySelector('button.note-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('section.notes')).toBeNull();
  });

  it('posting a non-empty note emits (annotate) with the tile id + body, and clears the input', async () => {
    const fixture = await setup({
      id: 'tile-7',
      slot: 'a',
      title: 'Post note here',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 1 },
    });
    fixture.componentInstance.annotations.set([
      { id: 'seed', author: 'Sarah', body: 'first', createdAt: '2026-04-12T10:00:00Z' },
    ]);
    fixture.detectChanges();
    // open the notes panel
    (fixture.nativeElement.querySelector('button.note-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Drive the noteDraft signal directly (jsdom ngModel flake-proof).
    const panel = fixture.debugElement.children[0].componentInstance as unknown as {
      noteDraft: WritableSignal<string>;
    };
    panel.noteDraft.set('Looks good.');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button.note-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.annotateCalls).toEqual([
      { tileId: 'tile-7', body: 'Looks good.' },
    ]);
    expect(panel.noteDraft()).toBe('');
  });

  it('renders one li.note per supplied annotation with author + body', async () => {
    const fixture = await setup({
      id: 't1',
      slot: 'a',
      title: 'Notes',
      component: 'valueWidget',
      invocation: { kind: 'static', props: 1 },
    });
    fixture.componentInstance.annotations.set([
      { id: 'a', author: 'Sarah', body: 'first note',  createdAt: '2026-04-12T10:00:00Z' },
      { id: 'b', author: 'GC',    body: 'second note', createdAt: '2026-04-13T08:00:00Z' },
    ]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button.note-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    const notes = Array.from(fixture.nativeElement.querySelectorAll('li.note:not(.empty)'));
    expect(notes).toHaveLength(2);
    expect((notes[0] as HTMLElement).textContent).toContain('Sarah');
    expect((notes[0] as HTMLElement).textContent).toContain('first note');
  });
});

// ── cross-instance cache ─────────────────────────────────────────

describe('DashboardTileComponent — cross-instance cache dedupe', () => {
  beforeEach(() => undefined);

  it('two tiles with the same tool+args within TTL share one fetch', async () => {
    // Two host fixtures mounted concurrently — same TileResultCache
    // singleton (providedIn: 'root') means the second tile reads from
    // the cache when the first one warmed it.
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedComponents();
    let calls = 0;
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'shared',
        description: '',
        schema: z.object({ k: z.string() }),
        handler: async (args) => {
          calls += 1;
          return { k: args.k, calls };
        },
      }) as ToolDef,
    );
    const sharedArgs = { k: 'same' };
    const a = TestBed.createComponent(HostComponent);
    const b = TestBed.createComponent(HostComponent);
    a.componentInstance.tile.set({
      id: 'a',
      slot: 's',
      title: 'A',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'shared', args: sharedArgs },
      cacheTtlMs: 60_000,
    });
    b.componentInstance.tile.set({
      id: 'b',
      slot: 's',
      title: 'B',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'shared', args: sharedArgs },
      cacheTtlMs: 60_000,
    });
    a.detectChanges();
    b.detectChanges();

    // Both tiles fire concurrently — TileResultCache.track dedupes
    // the in-flight promise so only one handler call happens.
    await new Promise((r) => setTimeout(r, 5));
    a.detectChanges();
    b.detectChanges();
    await new Promise((r) => setTimeout(r, 5));
    a.detectChanges();
    b.detectChanges();

    expect(calls).toBe(1);

    // And both tiles render the same value from the shared cache.
    expect(a.nativeElement.querySelector('[data-testid="val"]')?.textContent).toContain('"calls":1');
    expect(b.nativeElement.querySelector('[data-testid="val"]')?.textContent).toContain('"calls":1');
  });

  it('different args bypass the shared cache (per-args keying)', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedComponents();
    let calls = 0;
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'perArg',
        description: '',
        schema: z.object({ k: z.string() }),
        handler: async (args) => {
          calls += 1;
          return args.k;
        },
      }) as ToolDef,
    );
    const a = TestBed.createComponent(HostComponent);
    const b = TestBed.createComponent(HostComponent);
    a.componentInstance.tile.set({
      id: 'a',
      slot: 's',
      title: 'A',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'perArg', args: { k: 'alpha' } },
      cacheTtlMs: 60_000,
    });
    b.componentInstance.tile.set({
      id: 'b',
      slot: 's',
      title: 'B',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'perArg', args: { k: 'beta' } },
      cacheTtlMs: 60_000,
    });
    a.detectChanges();
    b.detectChanges();
    await new Promise((r) => setTimeout(r, 5));
    a.detectChanges();
    b.detectChanges();
    await new Promise((r) => setTimeout(r, 5));

    expect(calls).toBe(2);
  });

  it('cacheTtlMs unset means no cache reuse — every fire hits the tool', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    seedComponents();
    TestBed.inject(TileResultCache).clear();
    let calls = 0;
    TestBed.inject(ToolRegistry).register(
      agenticTool({
        name: 'uncached',
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
      id: 't',
      slot: 's',
      title: 'T',
      component: 'valueWidget',
      invocation: { kind: 'tool', tool: 'uncached', args: {} },
      // no cacheTtlMs — cache is bypassed
    });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 5));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button[aria-label="Refresh tile"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 5));
    fixture.detectChanges();

    expect(calls).toBe(2);
  });
});
