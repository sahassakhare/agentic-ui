import type {
  AgenticTelemetrySink,
  TelemetryEventName,
  TelemetrySpan,
} from '../internal';

class ConsoleSpan implements TelemetrySpan {
  constructor(
    private readonly name: string,
    private readonly startedAt: number,
    attributes?: Readonly<Record<string, unknown>>,
  ) {
    console.debug(`[telemetry] start ${name}`, attributes ?? {});
  }
  end(attributes?: Readonly<Record<string, unknown>>): void {
    const dur = performance.now() - this.startedAt;
    console.debug(`[telemetry] end   ${this.name} (${dur.toFixed(1)}ms)`, attributes ?? {});
  }
  recordError(error: unknown): void {
    console.warn(`[telemetry] error ${this.name}`, error);
  }
  setAttribute(key: string, value: unknown): void {
    console.debug(`[telemetry] attr  ${this.name} ${key}=`, value);
  }
}

/**
 * Tiny zero-dep telemetry sink that logs spans/events/metrics to the browser
 * console. Useful for development without pulling the full OTel SDK.
 *
 * For production telemetry use {@link OtelTelemetrySink} below (peer-dep
 * `@opentelemetry/api` + an SDK + an exporter).
 */
export class ConsoleTelemetrySink implements AgenticTelemetrySink {
  startSpan(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): TelemetrySpan {
    return new ConsoleSpan(name, performance.now(), attributes);
  }
  emit(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): void {
    console.debug(`[telemetry] event ${name}`, attributes ?? {});
  }
  counter(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void {
    console.debug(`[telemetry] counter ${name}=${value}`, attributes ?? {});
  }
  histogram(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void {
    console.debug(`[telemetry] hist    ${name}=${value}`, attributes ?? {});
  }
}
