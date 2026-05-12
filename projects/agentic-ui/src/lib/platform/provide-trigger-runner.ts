import {
  DestroyRef,
  ENVIRONMENT_INITIALIZER,
  InjectionToken,
  Injectable,
  Injector,
  Provider,
  Signal,
  inject,
  signal,
} from '@angular/core';
import { ToolRegistry } from '../registries/tool-registry';
import { TriggerRegistry } from '../registries/trigger-registry';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type {
  NotificationDraft,
  TriggerDef,
  TriggerFiringContext,
  TriggerTarget,
} from '../types/registry-defs';

/**
 * Decides whether a cron trigger should fire at the given moment.
 *
 * Apps wire `provideTriggerRunner({ evaluator })` to plug in a richer
 * cron library (e.g. `cron-parser`) when the built-in sugar isn't
 * enough. The default evaluator (`defaultCronEvaluator`) handles a
 * useful subset — common sugar like `@daily`, `@hourly`, `@minutely`,
 * and `every N (minutes|hours|days)`.
 *
 * @see [ADR-045 D3](../../../../docs/adr/0045-trigger-registry.md#d3--browser-side-runner-via-providetriggerrunner-kinds-cron-)
 */
export type CronEvaluator = (expression: string, now: Date) => boolean;

/** Configuration passed to `provideTriggerRunner`. */
export interface TriggerRunnerOptions {
  /**
   * Trigger kinds the browser-side runner should handle. Default is
   * `['cron']`. `'webhook'` and `'queue'` require the server-side
   * runner (ADR-045 D6 / future ADR-046) and are explicitly skipped
   * by the browser-side runner — registered triggers of those kinds
   * stay in the registry but never fire here.
   */
  readonly kinds?: readonly ('cron' | 'webhook' | 'queue')[];
  /**
   * Tick interval in milliseconds. The runner evaluates cron triggers
   * once per tick. Default is 30s (a good balance between latency and
   * battery — minute-granularity cron expressions don't need sub-second
   * resolution).
   */
  readonly tickIntervalMs?: number;
  /**
   * Pause predicate. When true, no triggers fire — useful to halt on
   * `document.hidden` to spare battery and quota. Default never pauses.
   */
  readonly paused?: () => boolean;
  /**
   * Custom cron evaluator. Default handles common sugar; replace this
   * to plug `cron-parser` or another POSIX-compliant library.
   */
  readonly evaluator?: CronEvaluator;
  /**
   * Default `runAs` persona used by triggers that don't carry their
   * own `runAs`. When unset, the locked-down `'trigger:default'`
   * persona id is used — apps must explicitly map that to a tool set
   * (or replace the default here) before triggers actually invoke
   * anything.
   */
  readonly defaultRunAs?: string;
  /**
   * Callback for `notification` targets. The runner builds a
   * `NotificationDraft` via the trigger's `compose` and hands it to
   * this callback so the host can post into its Inbox / tray. When
   * unset, notifications are dropped (with a console.warn).
   */
  readonly onNotification?: (draft: NotificationDraft, ctx: TriggerFiringContext) => void;
  /**
   * Callback for `action` targets. Hosts wire this to their
   * `ActionRegistry` dispatcher or domain command bus. When unset,
   * action targets are dropped (with a console.warn).
   */
  readonly onAction?: (action: string, payload: unknown, ctx: TriggerFiringContext) => void;
}

/**
 * Public handle to the trigger runner. Apps inject this to inspect
 * which triggers have fired, force a re-evaluation, or pause/resume
 * the tick.
 */
@Injectable({ providedIn: 'root' })
export class TriggerRunner {
  private readonly fireCountByTrigger = signal(new Map<string, number>());
  private readonly lastFiredAt = signal(new Map<string, string>());

  /** Number of times each trigger has fired since the runner started. */
  readonly fireCounts: Signal<ReadonlyMap<string, number>> = this.fireCountByTrigger.asReadonly();
  /** ISO timestamp of the last fire per trigger. */
  readonly lastFired: Signal<ReadonlyMap<string, string>> = this.lastFiredAt.asReadonly();

  /** Manually fire a registered trigger by id. Useful for tests + ops console. */
  fireById(id: string): void {
    fireByIdInternal(id);
  }

  /** Record a fire — used by the runner internals; not part of the public API contract. */
  recordFire(triggerId: string, at: string): void {
    this.fireCountByTrigger.update((m) => {
      const next = new Map(m);
      next.set(triggerId, (next.get(triggerId) ?? 0) + 1);
      return next;
    });
    this.lastFiredAt.update((m) => {
      const next = new Map(m);
      next.set(triggerId, at);
      return next;
    });
  }
}

/** Function captured by the runner singleton for `fireById`. */
let fireByIdInternal: (id: string) => void = () => undefined;

/**
 * Wire the browser-side trigger runner. Without this provider, registered
 * triggers stay visible in `TriggerRegistry` but never fire — useful for
 * apps that want catalog listing without the in-process scheduler.
 *
 * @see [ADR-045](../../../../docs/adr/0045-trigger-registry.md)
 *
 * @example
 * ```ts
 * provideTriggerRunner({
 *   kinds: ['cron'],
 *   tickIntervalMs: 30_000,
 *   paused: () => document.hidden,
 *   onNotification: (draft, ctx) => inboxStore.push({ draft, ctx }),
 *   onAction: (name, payload) => actionDispatcher.dispatch({ name, payload }),
 * });
 * ```
 */
export function provideTriggerRunner(options: TriggerRunnerOptions = {}): Provider[] {
  return [
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => initRunner(options, inject(Injector)),
    },
  ];
}

/** Default cron evaluator — handles the sugar subset (ADR-045 D3 + open Q1). */
export const defaultCronEvaluator: CronEvaluator = (expression, now) => {
  const expr = expression.trim().toLowerCase();
  if (!expr) return false;

  // Sugar shortcuts.
  if (expr === '@minutely' || expr === '* * * * *') {
    return now.getSeconds() === 0;
  }
  if (expr === '@hourly' || expr === '0 * * * *') {
    return now.getMinutes() === 0 && now.getSeconds() === 0;
  }
  if (expr === '@daily' || expr === '0 0 * * *' || expr === '@midnight') {
    return now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() === 0;
  }
  if (expr === '@weekly' || expr === '0 0 * * 0') {
    return (
      now.getDay() === 0 &&
      now.getHours() === 0 &&
      now.getMinutes() === 0 &&
      now.getSeconds() === 0
    );
  }

  // every N (minutes|hours|days) — case-insensitive
  const everyMatch = /^every\s+(\d+)\s+(minutes?|hours?|days?)$/i.exec(expr);
  if (everyMatch) {
    const n = parseInt(everyMatch[1] ?? '1', 10);
    if (n <= 0) return false;
    const unit = (everyMatch[2] ?? '').toLowerCase();
    if (unit.startsWith('minute')) {
      return now.getMinutes() % n === 0 && now.getSeconds() === 0;
    }
    if (unit.startsWith('hour')) {
      return now.getHours() % n === 0 && now.getMinutes() === 0 && now.getSeconds() === 0;
    }
    if (unit.startsWith('day')) {
      return now.getDate() % n === 0 && now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() === 0;
    }
  }

  // Anything else falls through — adopters can plug `cron-parser` via
  // the `evaluator` option to handle full POSIX expressions.
  return false;
};

function initRunner(options: TriggerRunnerOptions, injector: Injector): void {
  const triggers = injector.get(TriggerRegistry);
  const tools = injector.get(ToolRegistry);
  const telemetry = injector.get(AGENTIC_TELEMETRY_SINK);
  const runner = injector.get(TriggerRunner);
  const destroyRef = injector.get(DestroyRef);

  const kinds = new Set(options.kinds ?? ['cron']);
  const tickMs = options.tickIntervalMs ?? 30_000;
  const evaluator = options.evaluator ?? defaultCronEvaluator;
  const defaultRunAs = options.defaultRunAs ?? 'trigger:default';

  const isPaused = options.paused ?? (() => false);

  // Track which (triggerId, expression-time) tuples have already fired
  // this tick so we don't double-fire when the same minute boundary
  // appears in two consecutive ticks.
  const firedThisMinute = new Set<string>();
  let lastClearMinute = -1;

  const tick = (): void => {
    if (isPaused()) return;
    const now = new Date();
    const minute = now.getMinutes();
    if (minute !== lastClearMinute) {
      firedThisMinute.clear();
      lastClearMinute = minute;
    }
    for (const trigger of triggers.list()) {
      if (trigger.lifecycle === 'disabled') continue;
      if (!kinds.has(trigger.kind)) continue;
      if (trigger.kind !== 'cron' || trigger.spec.kind !== 'cron') continue;
      const fireKey = `${trigger.name}@${minute}`;
      if (firedThisMinute.has(fireKey)) continue;
      try {
        if (evaluator(trigger.spec.expression, now)) {
          firedThisMinute.add(fireKey);
          void fire(trigger, now);
        }
      } catch (err) {
        telemetry.emit('agentic.trigger.error', {
          'agentic.trigger.name': trigger.name,
          'agentic.trigger.reason': 'evaluator-throw',
          'agentic.error': err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const fire = async (trigger: TriggerDef, now: Date): Promise<void> => {
    const correlationId = `trg-${trigger.name}-${now.getTime()}`;
    const ctx: TriggerFiringContext = {
      triggerId: trigger.name,
      firedAt: now.toISOString(),
      firedBy: trigger.runAs ?? defaultRunAs,
      correlationId,
    };
    runner.recordFire(trigger.name, ctx.firedAt);
    telemetry.emit('agentic.trigger.fire', {
      'agentic.trigger.name': trigger.name,
      'agentic.trigger.firedBy': ctx.firedBy,
      'agentic.trigger.correlationId': correlationId,
      'agentic.tool.origin': 'trigger',
    });
    await dispatch(trigger.target, ctx, { tools, options });
  };

  // Expose the singleton fire-by-id for the public TriggerRunner.fireById.
  fireByIdInternal = (id: string): void => {
    const def = triggers.list().find((t) => t.name === id);
    if (!def) return;
    void fire(def, new Date());
  };

  const intervalHandle: ReturnType<typeof setInterval> | undefined =
    typeof setInterval === 'function' ? setInterval(tick, tickMs) : undefined;

  destroyRef.onDestroy(() => {
    if (intervalHandle) clearInterval(intervalHandle);
    fireByIdInternal = () => undefined;
  });
}

interface DispatchDeps {
  readonly tools: ToolRegistry;
  readonly options: TriggerRunnerOptions;
}

async function dispatch(
  target: TriggerTarget,
  ctx: TriggerFiringContext,
  deps: DispatchDeps,
): Promise<void> {
  switch (target.kind) {
    case 'tool': {
      const def = deps.tools.get(target.tool);
      if (!def) {
        // eslint-disable-next-line no-console
        console.warn(
          `[trigger] Skipped fire: tool "${target.tool}" not visible to persona "${ctx.firedBy}" ` +
            `(check setScopePolicy + runAs).`,
        );
        return;
      }
      try {
        const minimalCtx = buildMinimalToolContext(ctx);
        await def.handler(target.args ?? {}, minimalCtx);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[trigger] Tool "${target.tool}" failed:`, err);
      }
      return;
    }
    case 'action': {
      if (!deps.options.onAction) {
        // eslint-disable-next-line no-console
        console.warn(
          `[trigger] Action target "${target.action}" dropped — wire onAction in provideTriggerRunner.`,
        );
        return;
      }
      deps.options.onAction(target.action, target.payload, ctx);
      return;
    }
    case 'notification': {
      if (!deps.options.onNotification) {
        // eslint-disable-next-line no-console
        console.warn(
          `[trigger] Notification target dropped — wire onNotification in provideTriggerRunner.`,
        );
        return;
      }
      const draft = target.compose(ctx);
      deps.options.onNotification(draft, ctx);
      return;
    }
  }
}

/**
 * Synthetic minimal `ToolContext` for trigger-initiated tool calls.
 * Triggers don't have a chat thread; the contextual ids are derived
 * from the firing's `correlationId` so the audit chain can still link
 * the call back to its trigger.
 */
function buildMinimalToolContext(ctx: TriggerFiringContext): never {
  // Cast to `never` so callers don't accidentally rely on fields a
  // trigger-initiated context doesn't carry (e.g. abort signal tied
  // to a chat run). Tools that need the full context shape will
  // safe-access the fields they read; the orchestrator's chat path
  // is the source of truth for the rich shape.
  return {
    threadId: `trigger:${ctx.triggerId}`,
    runId: ctx.correlationId,
    toolCallId: ctx.correlationId,
    signal: new AbortController().signal,
    startOperation: () => ctx.correlationId,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  } as never;
}

/** Token to inject the runner singleton for tests + ops console drill-down. */
export const TRIGGER_RUNNER = new InjectionToken<TriggerRunner>('TRIGGER_RUNNER', {
  providedIn: 'root',
  factory: () => inject(TriggerRunner),
});
