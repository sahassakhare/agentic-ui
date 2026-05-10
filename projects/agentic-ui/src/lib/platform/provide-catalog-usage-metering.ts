import {
  DestroyRef,
  Injectable,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  type EnvironmentProviders,
  type Signal,
} from '@angular/core';
import {
  AGENTIC_TELEMETRY_SINK,
  NoopTelemetrySink,
  type AgenticTelemetrySink,
  type TelemetryEventName,
  type TelemetrySpan,
} from '../telemetry/telemetry-sink';

/**
 * Configuration for {@link provideCatalogUsageMetering}. Closes Gap 2
 * from the [2026-05-10 platform audit](../../../../../docs/audit/2026-05-10-platform-audit.md):
 * when a consumer-app tool fires, **nothing** reaches the catalog —
 * so the Usage page in the ops console is always empty for real
 * workloads and per-tenant quotas have no signal to act on.
 *
 * The metering hook wraps the runtime's `AGENTIC_TELEMETRY_SINK` so
 * every `agentic.tool_call.*`, `agentic.widget.render`, and
 * `agentic.federation.load.*` event becomes a usage event posted
 * asynchronously to `POST /v1/catalogs/{tenant}/usage`. Idempotency
 * via the catalog's `idempotencyKey` field — repeated batches don't
 * double-count.
 *
 * Bootstrap never blocks: events queue and a background task
 * periodically flushes (default every 5s, or when the queue
 * reaches `maxBatchSize`).
 */
export interface CatalogUsageMeteringOptions {
  readonly catalogUrl: string;
  readonly tenantId: string;
  readonly getToken: () => Promise<string | null | undefined> | string | null | undefined;

  /**
   * Existing telemetry sink to wrap. Hosts that have their own sink
   * pass it here so their telemetry continues to flow alongside the
   * catalog metering. Defaults to `NoopTelemetrySink` — no behaviour
   * change for hosts without a sink.
   */
  readonly delegate?: AgenticTelemetrySink;

  /**
   * Time-based flush interval in ms. Default `5000`. Set `0` to
   * disable interval flushing — events still flush on
   * `maxBatchSize` and can be flushed manually via
   * `service.flush()`.
   */
  readonly flushIntervalMs?: number;

  /**
   * Flush as soon as the queue reaches this many events. Default
   * `100`. Avoids unbounded memory if a chatty agent fires events
   * faster than the interval.
   */
  readonly maxBatchSize?: number;

  /** Override of `globalThis.fetch`. Test seam. */
  readonly fetchFn?: typeof fetch;
}

/** A queued usage event, before it's posted to the catalog. */
interface QueuedUsageEvent {
  readonly kind: string;
  readonly quantity: number;
  readonly tags: Record<string, string | number | boolean | null>;
  readonly idempotencyKey?: string;
  readonly occurredAt: string;
}

/**
 * Service that owns the queue + flush loop. Hosts can `inject` it to
 * inspect the queue depth, force a flush after a critical event, or
 * surface a "metering N events buffered" badge.
 */
@Injectable({ providedIn: 'root' })
export class CatalogUsageMeteringService {
  private readonly queue: QueuedUsageEvent[] = [];
  private readonly inflightCount = signal<number>(0);
  private readonly flushedTotal = signal<number>(0);
  private readonly failedTotal = signal<number>(0);
  private readonly destroyRef = inject(DestroyRef, { optional: true });

  private timer: ReturnType<typeof setInterval> | null = null;
  private options: CatalogUsageMeteringOptions | null = null;

  /** Number of events currently being POSTed (in-flight). */
  readonly inflight: Signal<number> = this.inflightCount.asReadonly();
  /** Cumulative events successfully flushed since boot. */
  readonly flushed: Signal<number> = this.flushedTotal.asReadonly();
  /** Cumulative events that failed to flush since boot. */
  readonly failed: Signal<number> = this.failedTotal.asReadonly();

  /**
   * Promise of the most recent `flush()` call (whether completed or
   * in-flight). Useful in tests that need to await the
   * fire-and-forget batch flush. `null` until the first flush
   * starts.
   */
  lastFlush: Promise<void> | null = null;

  configure(options: CatalogUsageMeteringOptions): void {
    this.options = options;
    this.destroyRef?.onDestroy(() => {
      this.stopFlushTimer();
      // Best-effort final flush on teardown; we don't await — Angular
      // teardown isn't an async-aware lifecycle.
      void this.flush();
    });
  }

  enqueue(event: QueuedUsageEvent): void {
    this.queue.push(event);
    const opts = this.options;
    const max = opts?.maxBatchSize ?? 100;
    if (this.queue.length >= max) {
      this.lastFlush = this.flush();
    }
  }

  startFlushTimer(intervalMs: number): void {
    this.stopFlushTimer();
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => { this.lastFlush = this.flush(); }, intervalMs);
  }

  stopFlushTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Drain the queue. Each event is POSTed independently for idempotency. */
  async flush(): Promise<void> {
    const opts = this.options;
    if (!opts) return;
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    this.inflightCount.update((n) => n + batch.length);

    const fetcher = opts.fetchFn ?? fetch;
    const url = `${stripTrailingSlash(opts.catalogUrl)}/v1/catalogs/${encodeURIComponent(opts.tenantId)}/usage`;
    const token = await opts.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let success = 0;
    let failure = 0;
    for (const event of batch) {
      try {
        const res = await fetcher(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(event),
        });
        if (res.ok) {
          success++;
        } else {
          failure++;
        }
      } catch {
        failure++;
      }
    }

    this.inflightCount.update((n) => n - batch.length);
    if (success > 0) this.flushedTotal.update((n) => n + success);
    if (failure > 0) this.failedTotal.update((n) => n + failure);
  }
}

/**
 * Telemetry sink that wraps a delegate AND additionally queues
 * usage events for relevant runtime telemetry. The delegate sees
 * EVERY event the runtime emits; the metering side filters down
 * to events that meaningfully count as "usage."
 */
class CatalogUsageMeteringSink implements AgenticTelemetrySink {
  constructor(
    private readonly delegate: AgenticTelemetrySink,
    private readonly queue: (event: QueuedUsageEvent) => void,
  ) {}

  startSpan(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): TelemetrySpan {
    const inner = this.delegate.startSpan(name, attributes);
    if (name === 'agentic.tool_call.start') {
      // Wrap the span so we can queue the usage event on
      // `end(...)` — the natural "this call finished" signal.
      const startAttrs = attributes;
      return {
        end: (endAttrs?: Readonly<Record<string, unknown>>) => {
          inner.end(endAttrs);
          this.queueToolCall(startAttrs, endAttrs);
        },
        recordError: (e) => inner.recordError(e),
        setAttribute: (k, v) => inner.setAttribute(k, v),
      };
    }
    return inner;
  }

  emit(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): void {
    this.delegate.emit(name, attributes);
    if (name === 'agentic.widget.render') {
      this.queueWidgetRender(attributes);
    } else if (name === 'agentic.federation.load.end') {
      this.queueFederationLoad(attributes);
    }
  }

  counter(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void {
    this.delegate.counter(name, value, attributes);
  }

  histogram(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void {
    this.delegate.histogram(name, value, attributes);
  }

  private queueToolCall(
    startAttrs: Readonly<Record<string, unknown>> | undefined,
    endAttrs: Readonly<Record<string, unknown>> | undefined,
  ): void {
    const merged = { ...(startAttrs ?? {}), ...(endAttrs ?? {}) };
    const toolName = pickStr(merged, 'agentic.tool.name');
    const toolSource = pickStr(merged, 'agentic.tool.source') ?? 'host';
    const success = merged['agentic.tool.success'];
    const queued = merged['agentic.tool.queued_for_approval'];
    if (!toolName) return;
    // Don't count approval-queued tools — they didn't actually run.
    if (queued === true) return;
    this.queue({
      kind: 'tool.call',
      quantity: 1,
      tags: {
        'tool.name': toolName,
        'tool.source': toolSource,
        success: success === true ? true : success === false ? false : null,
      },
      occurredAt: new Date().toISOString(),
    });
  }

  private queueWidgetRender(attrs: Readonly<Record<string, unknown>> | undefined): void {
    const widgetName = pickStr(attrs, 'agentic.widget.name');
    if (!widgetName) return;
    this.queue({
      kind: 'widget.render',
      quantity: 1,
      tags: { 'widget.name': widgetName },
      occurredAt: new Date().toISOString(),
    });
  }

  private queueFederationLoad(attrs: Readonly<Record<string, unknown>> | undefined): void {
    const remote = pickStr(attrs, 'agentic.federation.remote.name');
    if (!remote) return;
    this.queue({
      kind: 'federation.load',
      quantity: 1,
      tags: { 'remote.name': remote },
      occurredAt: new Date().toISOString(),
    });
  }
}

function pickStr(
  attrs: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  if (!attrs) return undefined;
  const v = attrs[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Wire the catalog usage metering pipeline. Replaces
 * `AGENTIC_TELEMETRY_SINK` with a wrapping sink that fans out
 * usage-relevant events to a background flush loop.
 *
 * Closes Gap 2 from the 2026-05-10 platform audit (ADR-034).
 *
 * @example
 * ```ts
 * provideCatalogUsageMetering({
 *   catalogUrl: 'https://catalog.example.com',
 *   tenantId: 'acme',
 *   getToken: () => oidc.getAccessToken(),
 *   flushIntervalMs: 5_000,
 * })
 * ```
 */
export function provideCatalogUsageMetering(
  options: CatalogUsageMeteringOptions,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: AGENTIC_TELEMETRY_SINK,
      useFactory: () => {
        const svc = inject(CatalogUsageMeteringService);
        const delegate = options.delegate ?? new NoopTelemetrySink();
        return new CatalogUsageMeteringSink(delegate, (event) => svc.enqueue(event));
      },
    },
    provideEnvironmentInitializer(() => {
      const svc = inject(CatalogUsageMeteringService);
      svc.configure(options);
      const intervalMs = options.flushIntervalMs ?? 5_000;
      svc.startFlushTimer(intervalMs);
    }),
  ]);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
