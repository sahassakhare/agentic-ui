import type {
  AgenticTelemetrySink,
  TelemetryEventName,
  TelemetrySpan,
} from '../internal';

/**
 * Minimal OTel-style provider interface. Apps pass a real `Tracer` / `Meter`
 * (from `@opentelemetry/api`) or a compatible shim. The sink is intentionally
 * decoupled from the OTel SDK packages so consumers control the dep surface.
 */
export interface OtelProviders {
  readonly tracer: {
    startSpan(name: string, attributes?: Record<string, unknown>): {
      setAttribute(key: string, value: unknown): void;
      recordException(error: unknown): void;
      end(attributes?: Record<string, unknown>): void;
    };
  };
  readonly meter?: {
    createCounter(name: string): { add(value: number, attributes?: Record<string, unknown>): void };
    createHistogram(name: string): { record(value: number, attributes?: Record<string, unknown>): void };
  };
}

class OtelSpan implements TelemetrySpan {
  constructor(private readonly inner: ReturnType<OtelProviders['tracer']['startSpan']>) {}
  end(attributes?: Readonly<Record<string, unknown>>): void {
    this.inner.end(attributes as Record<string, unknown> | undefined);
  }
  recordError(error: unknown): void {
    this.inner.recordException(error);
  }
  setAttribute(key: string, value: unknown): void {
    this.inner.setAttribute(key, value);
  }
}

/**
 * AgenticTelemetrySink implementation that delegates to OpenTelemetry-style
 * tracer + meter. Wire via `provideAgenticTelemetry({tracer, meter})`.
 *
 * Bundle impact: this sink itself is ~2 KB; the OTel SDK + an exporter add
 * 30–80 KB gzipped (see PLAN.md §11 R5 for handling).
 */
export class OtelTelemetrySink implements AgenticTelemetrySink {
  private readonly counters = new Map<string, ReturnType<NonNullable<OtelProviders['meter']>['createCounter']>>();
  private readonly histograms = new Map<string, ReturnType<NonNullable<OtelProviders['meter']>['createHistogram']>>();

  constructor(private readonly providers: OtelProviders) {}

  startSpan(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): TelemetrySpan {
    return new OtelSpan(this.providers.tracer.startSpan(name, attributes as Record<string, unknown> | undefined));
  }

  emit(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): void {
    // Span-as-event: zero-duration span carrying only attributes.
    const span = this.providers.tracer.startSpan(name, attributes as Record<string, unknown> | undefined);
    span.end();
  }

  counter(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void {
    if (!this.providers.meter) return;
    let inst = this.counters.get(name);
    if (!inst) { inst = this.providers.meter.createCounter(name); this.counters.set(name, inst); }
    inst.add(value, attributes as Record<string, unknown> | undefined);
  }

  histogram(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void {
    if (!this.providers.meter) return;
    let inst = this.histograms.get(name);
    if (!inst) { inst = this.providers.meter.createHistogram(name); this.histograms.set(name, inst); }
    inst.record(value, attributes as Record<string, unknown> | undefined);
  }
}
