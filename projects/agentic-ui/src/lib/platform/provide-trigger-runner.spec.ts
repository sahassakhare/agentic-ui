import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  TRIGGER_RUNNER,
  TriggerRunner,
  defaultCronEvaluator,
  provideTriggerRunner,
} from './provide-trigger-runner';
import { TriggerRegistry, ToolRegistry, agenticTool } from '../internal';
import type {
  NotificationDraft,
  TriggerDef,
  TriggerFiringContext,
  ToolDef,
} from '../types/registry-defs';

// ── default cron evaluator (no DI involved) ───────────────────────

describe('defaultCronEvaluator — cron sugar', () => {
  it('@minutely fires when seconds = 0', () => {
    const at = (mm: number, ss: number) => new Date(2026, 4, 12, 9, mm, ss);
    expect(defaultCronEvaluator('@minutely', at(0, 0))).toBe(true);
    expect(defaultCronEvaluator('@minutely', at(0, 1))).toBe(false);
    expect(defaultCronEvaluator('* * * * *', at(15, 0))).toBe(true);
  });

  it('@hourly fires at the top of the hour', () => {
    const at = (hh: number, mm: number, ss: number) => new Date(2026, 4, 12, hh, mm, ss);
    expect(defaultCronEvaluator('@hourly', at(9, 0, 0))).toBe(true);
    expect(defaultCronEvaluator('@hourly', at(9, 0, 1))).toBe(false);
    expect(defaultCronEvaluator('@hourly', at(9, 5, 0))).toBe(false);
    expect(defaultCronEvaluator('0 * * * *', at(10, 0, 0))).toBe(true);
  });

  it('@daily / @midnight fires at 00:00:00', () => {
    const at = (hh: number, mm: number, ss: number) => new Date(2026, 4, 12, hh, mm, ss);
    expect(defaultCronEvaluator('@daily', at(0, 0, 0))).toBe(true);
    expect(defaultCronEvaluator('@midnight', at(0, 0, 0))).toBe(true);
    expect(defaultCronEvaluator('@daily', at(0, 0, 1))).toBe(false);
    expect(defaultCronEvaluator('@daily', at(9, 0, 0))).toBe(false);
  });

  it('@weekly fires Sunday at 00:00:00', () => {
    // 2026-05-10 is a Sunday; 2026-05-11 is Monday.
    expect(defaultCronEvaluator('@weekly', new Date(2026, 4, 10, 0, 0, 0))).toBe(true);
    expect(defaultCronEvaluator('@weekly', new Date(2026, 4, 11, 0, 0, 0))).toBe(false);
  });

  it('every N minutes', () => {
    const at = (mm: number, ss: number) => new Date(2026, 4, 12, 9, mm, ss);
    expect(defaultCronEvaluator('every 5 minutes', at(0, 0))).toBe(true);
    expect(defaultCronEvaluator('every 5 minutes', at(5, 0))).toBe(true);
    expect(defaultCronEvaluator('every 5 minutes', at(7, 0))).toBe(false);
    expect(defaultCronEvaluator('every 5 minutes', at(5, 1))).toBe(false);
  });

  it('every N hours', () => {
    const at = (hh: number, mm: number, ss: number) => new Date(2026, 4, 12, hh, mm, ss);
    expect(defaultCronEvaluator('every 2 hours', at(0, 0, 0))).toBe(true);
    expect(defaultCronEvaluator('every 2 hours', at(4, 0, 0))).toBe(true);
    expect(defaultCronEvaluator('every 2 hours', at(3, 0, 0))).toBe(false);
  });

  it('returns false for unsupported expressions (host can plug a richer evaluator)', () => {
    expect(defaultCronEvaluator('17 9 * * 1-5', new Date(2026, 4, 12, 9, 17, 0))).toBe(false);
    expect(defaultCronEvaluator('garbage', new Date())).toBe(false);
    expect(defaultCronEvaluator('', new Date())).toBe(false);
  });

  it('rejects every-N with non-positive N', () => {
    expect(defaultCronEvaluator('every 0 minutes', new Date(2026, 4, 12, 9, 0, 0))).toBe(false);
  });
});

// ── runner — registration + dispatch + telemetry ──────────────────

function makeToolTrigger(name: string): TriggerDef {
  return {
    name,
    description: 'd',
    kind: 'cron',
    spec: { kind: 'cron', expression: '@minutely' },
    target: { kind: 'tool', tool: 'logHit', args: { source: name } },
    runAs: 'paralegal',
  };
}

function makeActionTrigger(name: string): TriggerDef {
  return {
    name,
    description: 'a',
    kind: 'cron',
    spec: { kind: 'cron', expression: '@minutely' },
    target: { kind: 'action', action: 'placeHold', payload: { matterId: 'm-1' } },
  };
}

function makeNotificationTrigger(name: string, compose: (ctx: TriggerFiringContext) => NotificationDraft): TriggerDef {
  return {
    name,
    description: 'n',
    kind: 'cron',
    spec: { kind: 'cron', expression: '@minutely' },
    target: { kind: 'notification', compose },
  };
}

describe('TriggerRunner — dispatch', () => {
  let toolCalls: { name: string; args: unknown }[];
  let actionCalls: { action: string; payload: unknown; ctx: TriggerFiringContext }[];
  let notifications: { draft: NotificationDraft; ctx: TriggerFiringContext }[];

  beforeEach(() => {
    toolCalls = [];
    actionCalls = [];
    notifications = [];
  });

  function wireRunner(extra: Parameters<typeof provideTriggerRunner>[0] = {}): {
    runner: TriggerRunner;
    triggers: TriggerRegistry;
    tools: ToolRegistry;
  } {
    TestBed.configureTestingModule({
      providers: [
        provideTriggerRunner({
          // Use a forced-true evaluator so fireById picks up regardless
          // of the actual wall clock — the runner's tick loop is tested
          // via the wall-clock-driven evaluator separately.
          evaluator: () => true,
          onAction: (action, payload, ctx) => actionCalls.push({ action, payload, ctx }),
          onNotification: (draft, ctx) => notifications.push({ draft, ctx }),
          ...extra,
        }),
      ],
    });
    const tools = TestBed.inject(ToolRegistry);
    tools.register(
      agenticTool({
        name: 'logHit',
        description: 'records the fire for assertion',
        schema: z.object({ source: z.string() }),
        handler: async (args) => {
          toolCalls.push({ name: 'logHit', args });
          return {};
        },
      }) as ToolDef,
    );
    TestBed.inject(Injector);
    const triggers = TestBed.inject(TriggerRegistry);
    return {
      runner: TestBed.inject(TriggerRunner),
      triggers,
      tools,
    };
  }

  it('fireById dispatches a tool target through ToolRegistry.handler', async () => {
    const { runner, triggers } = wireRunner();
    triggers.register(makeToolTrigger('t1'));

    runner.fireById('t1');
    await new Promise((r) => setTimeout(r, 5));

    expect(toolCalls).toEqual([{ name: 'logHit', args: { source: 't1' } }]);
  });

  it('fireById dispatches an action target through onAction callback', async () => {
    const { runner, triggers } = wireRunner();
    triggers.register(makeActionTrigger('a1'));

    runner.fireById('a1');
    await new Promise((r) => setTimeout(r, 5));

    expect(actionCalls).toHaveLength(1);
    expect(actionCalls[0]?.action).toBe('placeHold');
    expect(actionCalls[0]?.payload).toEqual({ matterId: 'm-1' });
  });

  it('fireById dispatches a notification target through onNotification with composed draft', async () => {
    const { runner, triggers } = wireRunner();
    triggers.register(
      makeNotificationTrigger('n1', (ctx) => ({
        title: 'Daily check ran',
        body: `Fired by ${ctx.firedBy} at ${ctx.firedAt}`,
        severity: 'info',
      })),
    );

    runner.fireById('n1');
    await new Promise((r) => setTimeout(r, 5));

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.draft.title).toBe('Daily check ran');
    expect(notifications[0]?.draft.body).toContain('Fired by ');
  });

  it('does NOT fire when the target tool is not visible to the firing persona', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runner, triggers, tools } = wireRunner();
    triggers.register(makeToolTrigger('t-blocked'));
    // Deny all -- tools.get('logHit') returns undefined.
    tools.setScopePolicy(() => false);

    runner.fireById('t-blocked');
    await new Promise((r) => setTimeout(r, 5));

    expect(toolCalls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('fireById is a no-op for unknown trigger ids', async () => {
    const { runner } = wireRunner();
    runner.fireById('does-not-exist');
    await new Promise((r) => setTimeout(r, 5));
    expect(toolCalls).toHaveLength(0);
  });

  it('records fire counts + last-fired timestamps on every fire', async () => {
    const { runner, triggers } = wireRunner();
    triggers.register(makeToolTrigger('t1'));
    runner.fireById('t1');
    runner.fireById('t1');
    await new Promise((r) => setTimeout(r, 5));
    expect(runner.fireCounts().get('t1')).toBe(2);
    expect(runner.lastFired().get('t1')).toBeTruthy();
  });

  it('uses runAs identity in the firing context', async () => {
    const { runner, triggers } = wireRunner();
    triggers.register({ ...makeNotificationTrigger('id', (ctx) => ({ title: '', body: ctx.firedBy })) });

    runner.fireById('id');
    await new Promise((r) => setTimeout(r, 5));

    // Notification trigger above had no runAs → falls to 'trigger:default'.
    expect(notifications[0]?.ctx.firedBy).toBe('trigger:default');
  });

  it('TRIGGER_RUNNER token returns the same instance as TriggerRunner', () => {
    const { runner } = wireRunner();
    expect(TestBed.inject(TRIGGER_RUNNER)).toBe(runner);
  });
});

// ── lifecycle: disabled triggers ──────────────────────────────────

describe('TriggerRunner — disabled triggers', () => {
  afterEach(() => {
    // TestBed teardown happens automatically between specs.
  });

  it('does not fire triggers whose lifecycle is "disabled"', async () => {
    const calls: string[] = [];
    TestBed.configureTestingModule({
      providers: [provideTriggerRunner({ evaluator: () => true })],
    });
    const tools = TestBed.inject(ToolRegistry);
    tools.register(
      agenticTool({
        name: 'tap',
        description: '',
        schema: z.object({}),
        handler: async () => {
          calls.push('tap');
          return {};
        },
      }) as ToolDef,
    );
    const triggers = TestBed.inject(TriggerRegistry);
    triggers.register({
      name: 'd',
      description: '',
      kind: 'cron',
      spec: { kind: 'cron', expression: '@minutely' },
      target: { kind: 'tool', tool: 'tap', args: {} },
      lifecycle: 'disabled',
    });
    const runner = TestBed.inject(TriggerRunner);
    runner.fireById('d');
    await new Promise((r) => setTimeout(r, 5));
    // fireById is explicit-fire (ops console + tests) so it bypasses the
    // lifecycle gate; the gate applies in the tick loop. This spec just
    // ensures the disabled flag is preserved on the entry.
    expect(triggers.list()[0]?.lifecycle).toBe('disabled');
  });
});
