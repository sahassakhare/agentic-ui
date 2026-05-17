# Observability

The library bakes a `AgenticTelemetrySink` interface in from M1 — every registry mutation, run lifecycle, tool call, widget render, and federation load pushes a structured event through it. The default sink is a no-op (zero overhead). Wire a real sink to start collecting telemetry.

## Dev — console sink (zero deps)

```ts
import { provideAgenticTelemetryConsole } from '@infra-tools/agentic-ui/otel';

providers: [
  provideAgenticUi(),
  provideAgUiBackend({ url: '...' }),
  provideAgenticTelemetryConsole(),  // pretty-prints spans, events, metrics to console
],
```

Adds ~2 KB; useful for development. Spans look like:

```
[telemetry] start agentic.run.start { thread_id: 'abc', backend: 'ag-ui' }
[telemetry] event agentic.tool_call.start { tool: 'bookFlight' }
[telemetry] end   agentic.run.start (1234.5ms)
```

## Production — OpenTelemetry sink

The library does not pin OTel SDK versions — apps choose their exporter and pass the resulting `tracer` / `meter` in:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-trace-web @opentelemetry/exporter-trace-otlp-http @opentelemetry/sdk-metrics
```

```ts
import { trace, metrics } from '@opentelemetry/api';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { provideAgenticTelemetry } from '@infra-tools/agentic-ui/otel';

const provider = new WebTracerProvider({
  spanProcessors: [
    new BatchSpanProcessor(new OTLPTraceExporter({ url: 'https://otel-collector.example.com/v1/traces' })),
  ],
});
provider.register();

providers: [
  provideAgenticTelemetry({
    kind: 'otel',
    providers: {
      tracer: trace.getTracer('agentic-ui'),
      meter: metrics.getMeter('agentic-ui'),
    },
  }),
],
```

Bundle delta: 30–80 KB gzipped (the SDK + exporter; the lib's adapter itself is ~2 KB).

## What's instrumented

| Event / Span | Attributes |
|--------------|-----------|
| `agentic.run.start` (span) | `agentic.thread_id`, `agentic.run_id`, `agentic.backend.id`, `agentic.tools.count`, `agentic.widgets.count` |
| `agentic.tool_call.start` (span) | `agentic.tool.name`, `agentic.tool.source` (`host`/`remote:bookings`/`mcp:filesystem`) |
| `agentic.federation.load.start` (span) | `mfe.remote_name`, `mfe.version`, `mfe.federation` (`native`/`module`), `mfe.capability_count` |
| `agentic.registry.register` (event) | `registry.name`, `registry.entry.name`, `registry.entry.source`, `registry.entry_count_after` |
| `agentic.registry.size` (counter) | tagged by `registry.name` |

## Cross-process tracing

The AG-UI HTTP request from `AgUiBackend` to your agent server can carry W3C `traceparent` headers when the OTel SDK is wired (the OTel browser SDK auto-instruments `fetch` if you register the `FetchInstrumentation`). The server-side route handler in `@infra-tools/agentic-ui-server` can extract the trace context and continue the trace via `@opentelemetry/sdk-node` or your runtime's equivalent — the lib doesn't hard-code this so you can choose Tempo / Jaeger / Honeycomb / Grafana.

## Custom sink

You can write a sink that forwards to Datadog, StatsD, or a custom HTTP endpoint by implementing `AgenticTelemetrySink` directly:

```ts
import type { AgenticTelemetrySink, TelemetrySpan } from '@infra-tools/agentic-ui';

class DatadogSink implements AgenticTelemetrySink {
  startSpan(name: string, attrs?: Record<string, unknown>): TelemetrySpan {
    // … forward to dd-trace
  }
  emit(name: string, attrs?: Record<string, unknown>) { /* … */ }
  counter(name: string, value: number) { /* … */ }
  histogram(name: string, value: number) { /* … */ }
}

providers: [
  { provide: AGENTIC_TELEMETRY_SINK, useClass: DatadogSink },
],
```

## Privacy

By default the library never captures tool args or message bodies as span attributes — only their byte size. Apps that want richer tracing for debugging can explicitly opt-in via `redaction.argsAllowList` (planned for the production sink — see PLAN.md §6.5).
