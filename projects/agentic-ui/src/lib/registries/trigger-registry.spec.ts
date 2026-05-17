import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { TriggerRegistry } from './trigger-registry';
import type { TriggerDef } from '../types/registry-defs';

function makeCronTrigger(name: string, runAs?: string): TriggerDef {
  return {
    name,
    description: `Daily trigger ${name}`,
    kind: 'cron',
    spec: { kind: 'cron', expression: '@daily' },
    target: { kind: 'tool', tool: 'noop', args: {} },
    runAs,
  };
}

describe('TriggerRegistry', () => {
  it('registers and lists triggers', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(TriggerRegistry);
    reg.register(makeCronTrigger('daily-ack-check'));
    reg.register(makeCronTrigger('hourly-tile-refresh'));
    expect(reg.list().map((t) => t.name)).toEqual([
      'daily-ack-check',
      'hourly-tile-refresh',
    ]);
  });

  it('honours setScopePolicy on list() reads (persona scope works for triggers too)', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(TriggerRegistry);
    reg.register(makeCronTrigger('public', 'paralegal'));
    reg.register(makeCronTrigger('restricted', 'gc'));
    // Deny everything attributed to 'gc'.
    reg.setScopePolicy((entry) => (entry as TriggerDef).runAs !== 'gc');
    expect(reg.list().map((t) => t.name)).toEqual(['public']);
  });

  it('removeBySource symmetry (MFE unload — same shape as the other 16 registries)', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(TriggerRegistry);
    reg.register({ ...makeCronTrigger('host-trigger'), source: 'host' });
    reg.register({ ...makeCronTrigger('mfe-a-trigger-1'), source: 'remote:production' });
    reg.register({ ...makeCronTrigger('mfe-a-trigger-2'), source: 'remote:production' });
    reg.removeBySource('remote:production');
    expect(reg.list().map((t) => t.name)).toEqual(['host-trigger']);
  });

  it('disabled triggers stay registered but are flagged via lifecycle (filter is consumer-side)', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(TriggerRegistry);
    reg.register({ ...makeCronTrigger('a'), lifecycle: 'disabled' });
    reg.register({ ...makeCronTrigger('b'), lifecycle: 'published' });
    const all = reg.list();
    expect(all).toHaveLength(2);
    expect(all.find((t) => t.name === 'a')?.lifecycle).toBe('disabled');
  });
});
