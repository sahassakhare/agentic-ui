import { Injectable, InjectionToken } from '@angular/core';

export interface TelemetrySpan {
  end(attributes?: Readonly<Record<string, unknown>>): void;
  recordError(error: unknown): void;
  setAttribute(key: string, value: unknown): void;
}

export type TelemetryEventName =
  | 'agentic.run.start'
  | 'agentic.run.end'
  | 'agentic.tool_call.start'
  | 'agentic.tool_call.end'
  | 'agentic.widget.render'
  | 'agentic.federation.load.start'
  | 'agentic.federation.load.end'
  | 'agentic.registry.register'
  | 'agentic.registry.remove'
  | 'agentic.registry.dropped'
  | 'agentic.registry.namespaced'
  | 'agentic.registry.dispose_failed';

export interface AgenticTelemetrySink {
  startSpan(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): TelemetrySpan;
  emit(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): void;
  counter(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void;
  histogram(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void;
}

class NoopSpan implements TelemetrySpan {
  end(): void {}
  recordError(): void {}
  setAttribute(): void {}
}

const NOOP_SPAN = new NoopSpan();

@Injectable({ providedIn: 'root' })
export class NoopTelemetrySink implements AgenticTelemetrySink {
  startSpan(): TelemetrySpan {
    return NOOP_SPAN;
  }
  emit(): void {}
  counter(): void {}
  histogram(): void {}
}

export const AGENTIC_TELEMETRY_SINK = new InjectionToken<AgenticTelemetrySink>(
  'AGENTIC_TELEMETRY_SINK',
  { providedIn: 'root', factory: () => new NoopTelemetrySink() },
);
