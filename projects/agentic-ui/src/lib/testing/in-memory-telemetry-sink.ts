import type {
  AgenticTelemetrySink,
  TelemetryEventName,
  TelemetrySpan,
} from '../internal';

export interface RecordedEvent {
  readonly name: TelemetryEventName | string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface RecordedSpan {
  readonly name: TelemetryEventName | string;
  readonly startAttributes?: Readonly<Record<string, unknown>>;
  endAttributes?: Readonly<Record<string, unknown>>;
  recordedErrors?: unknown[];
  ended: boolean;
}

export interface RecordedMetric {
  readonly kind: 'counter' | 'histogram';
  readonly name: string;
  readonly value: number;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

class InMemorySpan implements TelemetrySpan {
  constructor(private readonly record: RecordedSpan) {}
  end(attributes?: Readonly<Record<string, unknown>>): void {
    this.record.endAttributes = attributes;
    this.record.ended = true;
  }
  recordError(error: unknown): void {
    (this.record.recordedErrors ??= []).push(error);
  }
  setAttribute(): void { /* no-op for tests */ }
}

/**
 * Test sink that records every span / event / metric for assertion.
 * Use {@link hasSpan}, {@link spansByName}, {@link eventsByName}, etc.
 */
export class InMemoryTelemetrySink implements AgenticTelemetrySink {
  readonly spans: RecordedSpan[] = [];
  readonly events: RecordedEvent[] = [];
  readonly metrics: RecordedMetric[] = [];

  startSpan(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): TelemetrySpan {
    const record: RecordedSpan = { name, startAttributes: attributes, ended: false };
    this.spans.push(record);
    return new InMemorySpan(record);
  }

  emit(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): void {
    this.events.push({ name, attributes });
  }

  counter(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void {
    this.metrics.push({ kind: 'counter', name, value, attributes });
  }

  histogram(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void {
    this.metrics.push({ kind: 'histogram', name, value, attributes });
  }

  reset(): void {
    this.spans.length = 0;
    this.events.length = 0;
    this.metrics.length = 0;
  }

  hasSpan(name: string, matcher?: (s: RecordedSpan) => boolean): boolean {
    return this.spans.some((s) => s.name === name && (!matcher || matcher(s)));
  }
  spansByName(name: string): RecordedSpan[] { return this.spans.filter((s) => s.name === name); }
  eventsByName(name: string): RecordedEvent[] { return this.events.filter((e) => e.name === name); }
}
