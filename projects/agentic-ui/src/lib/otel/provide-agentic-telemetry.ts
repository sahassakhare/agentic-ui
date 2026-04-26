import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { AGENTIC_TELEMETRY_SINK } from '../internal';
import { ConsoleTelemetrySink } from './console-telemetry-sink';
import { OtelTelemetrySink, type OtelProviders } from './otel-telemetry-sink';

export interface AgenticTelemetryConsoleConfig {
  readonly kind: 'console';
}

export interface AgenticTelemetryOtelConfig {
  readonly kind: 'otel';
  readonly providers: OtelProviders;
}

export type AgenticTelemetryConfig = AgenticTelemetryConsoleConfig | AgenticTelemetryOtelConfig;

/**
 * Wires an `AgenticTelemetrySink` for the app. Two flavors:
 *
 *   provideAgenticTelemetry({ kind: 'console' })             // dev-only, zero deps
 *   provideAgenticTelemetry({ kind: 'otel', providers })     // production, OTel SDK
 *
 * For OTel, pass `{ tracer, meter? }` from `@opentelemetry/api` (or an SDK).
 * The library intentionally does NOT pin OTel SDK versions — apps choose their
 * exporter (OTLP HTTP/gRPC, console, custom) and pass the resulting providers.
 */
export function provideAgenticTelemetry(config: AgenticTelemetryConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    config.kind === 'console'
      ? { provide: AGENTIC_TELEMETRY_SINK, useFactory: () => new ConsoleTelemetrySink() }
      : { provide: AGENTIC_TELEMETRY_SINK, useFactory: () => new OtelTelemetrySink(config.providers) },
  ]);
}

/** Dev-friendly shorthand that matches the plan's `provideAgenticTelemetryConsole()`. */
export function provideAgenticTelemetryConsole(): EnvironmentProviders {
  return provideAgenticTelemetry({ kind: 'console' });
}
