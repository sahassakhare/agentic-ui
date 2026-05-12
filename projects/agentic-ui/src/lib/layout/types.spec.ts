import { describe, expect, it } from 'vitest';
import {
  CHAT_SHELL_MODES,
  DEFAULT_LAYOUT_POLICY,
  chatShellModeSchema,
  layoutRenderEventSchema,
  responsiveCollapseRuleSchema,
  slotDefSchema,
  slotMapSchema,
} from './types';

describe('CHAT_SHELL_MODES', () => {
  it('lists every mode the ADR ratified', () => {
    expect(CHAT_SHELL_MODES).toEqual([
      'rail',
      'pill',
      'overlay',
      'docked-bottom',
      'assist-panel',
      'hidden',
    ]);
  });

  it('chatShellModeSchema parses every member of the runtime set', () => {
    for (const mode of CHAT_SHELL_MODES) {
      expect(chatShellModeSchema.parse(mode)).toBe(mode);
    }
  });

  it('chatShellModeSchema rejects unknown values', () => {
    expect(() => chatShellModeSchema.parse('drawer')).toThrow();
    expect(() => chatShellModeSchema.parse('')).toThrow();
    expect(() => chatShellModeSchema.parse(null)).toThrow();
  });
});

describe('DEFAULT_LAYOUT_POLICY', () => {
  it('returns rail mode for every route', () => {
    expect(DEFAULT_LAYOUT_POLICY.shellMode('/')).toBe('rail');
    expect(DEFAULT_LAYOUT_POLICY.shellMode('/documents/123')).toBe('rail');
    expect(DEFAULT_LAYOUT_POLICY.shellMode('/audit')).toBe('rail');
  });

  it('returns comfortable density', () => {
    expect(DEFAULT_LAYOUT_POLICY.density()).toBe('comfortable');
  });

  it('does not define a workspaceLayout override', () => {
    expect(DEFAULT_LAYOUT_POLICY.workspaceLayout).toBeUndefined();
  });
});

describe('slotDefSchema', () => {
  it('parses a minimal slot ref', () => {
    expect(slotDefSchema.parse({ component: 'documentPreview' })).toEqual({
      component: 'documentPreview',
    });
  });

  it('parses every optional field', () => {
    const parsed = slotDefSchema.parse({
      component: 'tagPanel',
      props: { custodianId: 'c-1' },
      size: { default: '60%', min: '320px', max: '70%' },
      pinned: true,
      open: 'drawer',
    });
    expect(parsed.component).toBe('tagPanel');
    expect(parsed.size?.default).toBe('60%');
    expect(parsed.pinned).toBe(true);
    expect(parsed.open).toBe('drawer');
  });

  it('rejects an empty component name', () => {
    expect(() => slotDefSchema.parse({ component: '' })).toThrow();
  });

  it('rejects an unknown open mode', () => {
    expect(() =>
      slotDefSchema.parse({ component: 'x', open: 'tooltip' as 'inline' }),
    ).toThrow();
  });
});

describe('slotMapSchema', () => {
  it('accepts a map of slot name → SlotDef', () => {
    const parsed = slotMapSchema.parse({
      primary: { component: 'documentPreview' },
      sidebar: { component: 'tagPanel', size: { default: '25%' } },
    });
    expect(Object.keys(parsed)).toEqual(['primary', 'sidebar']);
  });

  it('rejects entries whose value is malformed', () => {
    expect(() =>
      slotMapSchema.parse({ primary: { component: 1 as unknown as string } }),
    ).toThrow();
  });
});

describe('responsiveCollapseRuleSchema', () => {
  it('parses a typical rule', () => {
    expect(
      responsiveCollapseRuleSchema.parse({
        belowPx: 1024,
        collapse: ['footer'],
        drawer: ['sidebar'],
      }),
    ).toEqual({
      belowPx: 1024,
      collapse: ['footer'],
      drawer: ['sidebar'],
    });
  });

  it('rejects non-positive breakpoints', () => {
    expect(() =>
      responsiveCollapseRuleSchema.parse({
        belowPx: 0,
        collapse: [],
        drawer: [],
      }),
    ).toThrow();
    expect(() =>
      responsiveCollapseRuleSchema.parse({
        belowPx: -100,
        collapse: [],
        drawer: [],
      }),
    ).toThrow();
  });

  it('rejects non-integer breakpoints', () => {
    expect(() =>
      responsiveCollapseRuleSchema.parse({
        belowPx: 1024.5,
        collapse: [],
        drawer: [],
      }),
    ).toThrow();
  });
});

describe('layoutRenderEventSchema', () => {
  it('parses an event with a registered layoutName', () => {
    const parsed = layoutRenderEventSchema.parse({
      type: 'LAYOUT_RENDER',
      layoutName: 'review-workbench',
      slots: {
        primary: { component: 'documentPreview' },
        sidebar: { component: 'tagPanel' },
      },
    });
    expect(parsed.type).toBe('LAYOUT_RENDER');
    expect(parsed.layoutName).toBe('review-workbench');
  });

  it('parses an ad-hoc event without layoutName', () => {
    const parsed = layoutRenderEventSchema.parse({
      type: 'LAYOUT_RENDER',
      slots: { main: { component: 'flightCard' } },
      responsive: [
        { belowPx: 768, collapse: ['sidebar'], drawer: [] },
      ],
    });
    expect(parsed.type).toBe('LAYOUT_RENDER');
    expect('responsive' in parsed ? parsed.responsive?.[0]?.belowPx : null).toBe(768);
  });

  it('rejects events with the wrong type tag', () => {
    expect(() =>
      layoutRenderEventSchema.parse({
        type: 'COMPONENTS_RENDER',
        slots: { main: { component: 'x' } },
      }),
    ).toThrow();
  });

  it('rejects events without a slots map', () => {
    expect(() =>
      layoutRenderEventSchema.parse({
        type: 'LAYOUT_RENDER',
        layoutName: 'x',
      }),
    ).toThrow();
  });

  it('parses optional shared `data` payload', () => {
    const parsed = layoutRenderEventSchema.parse({
      type: 'LAYOUT_RENDER',
      layoutName: 'workspace',
      slots: { main: { component: 'x' } },
      data: { custodianId: 'c-7', matterId: 'm-1' },
    });
    expect(parsed.data?.['custodianId']).toBe('c-7');
  });
});
