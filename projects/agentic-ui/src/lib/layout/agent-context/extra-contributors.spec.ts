import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DashboardTemplateRegistry, LayoutTemplateRegistry } from '../templates';
import { LayoutResolver } from '../resolver';
import {
  LAYOUT_INPUT,
  type LayoutInput,
  type LayoutInputSource,
  type LayoutRule,
} from '../resolver/types';
import { SelectionStore } from '../selection';
import {
  AvailableTemplatesContextContributor,
  MatterContextContributor,
  MATTER_CONTEXT_SIGNAL,
  OverrideStackContextContributor,
  RecentToolCallsContextContributor,
  RECENT_TOOL_CALLS_SIGNAL,
  SelectionContextContributor,
} from './extra-contributors';

describe('SelectionContextContributor', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('returns null when no selection is active', () => {
    TestBed.configureTestingModule({});
    const contributor = TestBed.inject(SelectionContextContributor);
    expect(contributor.contribute()).toBeNull();
  });

  it('emits <selection kind count> with the first 10 ids', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(SelectionStore);
    const contributor = TestBed.inject(SelectionContextContributor);
    store.set({ kind: 'document', ids: ['d1', 'd2', 'd3'] });
    const fragment = contributor.contribute();
    expect(fragment?.tag).toBe('selection');
    expect(fragment?.attrs).toEqual({ kind: 'document', count: 3 });
    expect(Array.isArray(fragment?.content)).toBe(true);
  });
});

describe('AvailableTemplatesContextContributor', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('returns null when no approved templates exist', () => {
    TestBed.configureTestingModule({});
    const contributor = TestBed.inject(AvailableTemplatesContextContributor);
    expect(contributor.contribute()).toBeNull();
  });

  it('emits approved layout + dashboard templates side by side', () => {
    TestBed.configureTestingModule({});
    const layoutReg = TestBed.inject(LayoutTemplateRegistry);
    const dashReg = TestBed.inject(DashboardTemplateRegistry);
    layoutReg.register({
      name: 'layout-a',
      title: 'Layout A',
      description: 'desc',
      approvalState: 'approved',
      approvalChain: [],
      author: { userId: 'u1', tenantId: 't1' },
      visibility: 'tenant',
      tags: ['x'],
      body: { name: 'layout-a', description: 'd', slots: ['primary'], component: class {} as never },
    });
    dashReg.register({
      name: 'dash-a',
      title: 'Dash A',
      description: 'desc',
      approvalState: 'approved',
      approvalChain: [],
      author: { userId: 'u1', tenantId: 't1' },
      visibility: 'matter',
      tags: [],
      body: { name: 'dash-a', title: 'Dash A', description: 'd', layout: 'rail', tiles: [] },
    });
    const contributor = TestBed.inject(AvailableTemplatesContextContributor);
    const fragment = contributor.contribute();
    expect(fragment?.tag).toBe('available-templates');
    const children = fragment?.content as Array<{ tag: string; attrs?: Record<string, unknown> }>;
    expect(children.map((c) => c.attrs?.['kind']).sort()).toEqual(['dashboard', 'layout']);
  });

  it('excludes templates in non-approved states', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(LayoutTemplateRegistry);
    reg.register({
      name: 'draft-template',
      title: 'Draft',
      description: 'd',
      approvalState: 'draft',
      approvalChain: [],
      author: { userId: 'u', tenantId: 't' },
      visibility: 'tenant',
      tags: [],
      body: { name: 'draft-template', description: 'd', slots: [], component: class {} as never },
    });
    expect(TestBed.inject(AvailableTemplatesContextContributor).contribute()).toBeNull();
  });
});

describe('OverrideStackContextContributor', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function makeInput(source: LayoutInputSource, rules: readonly LayoutRule[]) {
    const input: LayoutInput = {
      id: source,
      source,
      evaluate: () => rules,
    };
    return { provide: LAYOUT_INPUT, useValue: input, multi: true } as const;
  }

  it('returns null when no rules are firing', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(OverrideStackContextContributor).contribute()).toBeNull();
  });

  it('emits one <slot> child per applied rule with source + weight + reason', () => {
    TestBed.configureTestingModule({
      providers: [
        makeInput('route', [
          { id: 'r1', source: 'route', slots: { primary: { component: 'doc' } }, reason: 'route' },
        ]),
        makeInput('persona', [
          { id: 'p1', source: 'persona', slots: { sidebar: { component: 'panel' } }, reason: 'persona' },
        ]),
      ],
    });
    TestBed.inject(LayoutResolver);  // force resolver instantiation
    const fragment = TestBed.inject(OverrideStackContextContributor).contribute();
    expect(fragment?.tag).toBe('override-stack');
    const children = fragment?.content as Array<{ tag: string; attrs?: Record<string, unknown> }>;
    expect(children).toHaveLength(2);
    expect(children[0].attrs?.['source']).toBe('route');
    expect(children[1].attrs?.['source']).toBe('persona');
  });
});

describe('RecentToolCallsContextContributor', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('returns null when no recent calls are bound', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(RecentToolCallsContextContributor).contribute()).toBeNull();
  });

  it('emits the last 10 calls when bound', () => {
    const recent = signal(Array.from({ length: 15 }, (_, i) => ({
      timestamp: `2026-05-15T0${i}:00:00Z`,
      tool: `tool-${i}`,
    })));
    TestBed.configureTestingModule({
      providers: [{ provide: RECENT_TOOL_CALLS_SIGNAL, useValue: recent.asReadonly() }],
    });
    const fragment = TestBed.inject(RecentToolCallsContextContributor).contribute();
    expect(fragment?.tag).toBe('recent-tool-calls');
    const calls = fragment?.content as Array<{ tag: string }>;
    expect(calls).toHaveLength(10);
  });
});

describe('MatterContextContributor', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('returns null when no matter is bound', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(MatterContextContributor).contribute()).toBeNull();
  });

  it('emits matter id + phase + attributes', () => {
    const matter = signal({
      id: 'acme-2024',
      phase: 'review',
      attributes: { tenant: 't1', leadCounsel: 'marcus-webb' },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: MATTER_CONTEXT_SIGNAL, useValue: matter.asReadonly() }],
    });
    const fragment = TestBed.inject(MatterContextContributor).contribute();
    expect(fragment?.tag).toBe('matter');
    expect(fragment?.attrs).toEqual({ id: 'acme-2024', phase: 'review' });
    const children = fragment?.content as Array<{ tag: string; attrs?: Record<string, unknown> }>;
    expect(children?.length).toBe(2);
  });
});
