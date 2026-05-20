/**
 * @test-utility — backend-conformance harness.
 *
 * Walks an adapter through capability-gated checks (schema validity,
 * lifecycle correctness, state threading, multimodal acceptance) and
 * produces a structured `ConformanceReport`. Use in *.spec.ts; not
 * for production code paths.
 */
export * from './conformance-suite';

/**
 * @test-utility — deterministic `AgenticBackend` test double.
 *
 * Emits a scripted event sequence (`enqueueScript`) or delegates to
 * a responder callback (`useResponder`). Use in *.spec.ts; not for
 * production code paths.
 */
export * from './fake-agentic-backend';

/**
 * @test-utility — recording `AgenticTelemetrySink` for assertions.
 *
 * Records every span / event / metric to in-memory arrays so a
 * spec can assert that the lib emitted the expected lifecycle.
 * Use in *.spec.ts; not for production code paths.
 */
export * from './in-memory-telemetry-sink';
