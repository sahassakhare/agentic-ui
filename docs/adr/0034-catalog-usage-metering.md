# ADR-034 · provideCatalogUsageMetering — telemetry-driven usage events

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-018](./0018-usage-meter.md) · [ADR-031](./0031-provide-agentic-platform.md) · [ADR-032](./0032-catalog-capability-registrar.md) · [ADR-033](./0033-catalog-capability-authorizer.md) · [Platform audit 2026-05-10](../audit/2026-05-10-platform-audit.md#gap-2--usage-metering)

---

## Context

The 2026-05-10 platform audit identified **Gap 2 — Usage metering**:

> When a consumer-app tool fires, **nothing reaches the catalog**. The Usage page in the ops console is always empty for real workloads; per-tenant quotas have no signal to act on.

Industry comparable: OpenTelemetry traces wrap every external call. Stripe-style metering on every billable operation. CloudTrail records every API call.

The catalog already exposes `POST /v1/catalogs/{tenant}/usage` ([ADR-018](./0018-usage-meter.md)) accepting `{kind, quantity, tags, idempotencyKey?, occurredAt?}`. The Usage page in the ops console aggregates this data. Without runtime instrumentation, the only way usage events reach the catalog is `curl` from a script — which means the demo deploys ARE empty even when there's real activity, and quota policy decisions have no input data.

---

## Decision

### D1 — Wrap `AGENTIC_TELEMETRY_SINK`, don't add a parallel emit pipeline

The runtime tier already emits `agentic.tool_call.start`, `agentic.tool_call.end`, `agentic.widget.render`, `agentic.federation.load.*` to `AGENTIC_TELEMETRY_SINK`. These are exactly the events that constitute "usage" from a billing / quota perspective.

Rather than add a *second* emit pipeline at every call site (every tool, every widget, every federation load), the metering provider **replaces** `AGENTIC_TELEMETRY_SINK` with a wrapping implementation that:

1. Forwards every method to a host-provided `delegate` (default `NoopTelemetrySink`).
2. Additionally, on usage-relevant events, queues a `UsageEventCreate` payload for the catalog flush loop.

This is invisible to the orchestrator / federation / widget code — they keep emitting through one sink, the host wires a different sink, and usage metering happens automatically.

### D2 — Span-end is the "tool call completed" signal, not span-start

`agentic.tool_call.start` fires when the orchestrator begins a tool call; `span.end({...})` fires after the handler returns (with success/failure attributes). For usage metering we want the **completion** event, not the start (so we don't double-count, and so we capture success/failure in the `tags`).

The wrapping sink overrides `startSpan('agentic.tool_call.start', ...)` to return a custom span whose `end()` queues the usage event. The `start` attributes (`agentic.tool.name`, `agentic.tool.source`) are merged with the `end` attributes (`agentic.tool.success`, `agentic.tool.queued_for_approval`) before the usage payload is built.

### D3 — Skip approval-queued tool calls

The orchestrator marks tools that were intercepted by HITL approval (Capability F4) with `agentic.tool.queued_for_approval: true` on span end. Those tools didn't actually run — counting them as usage would inflate the metric and confuse quota enforcement.

We filter them out in the wrapping sink. When the approval is granted later and the tool *does* run, that becomes a separate span emit and IS counted normally.

### D4 — Background batch flush, not per-event POST

Three options for the catalog POST:

- **(a) Per-event POST** — simple but chatty. A 10-tool agent run becomes 10 round trips.
- **(b) Per-event POST with concurrency** — same chatty, more parallel. Catalog gets a thundering herd.
- **(c) Time-based batch flush** — events queue, a background loop flushes every N seconds OR when the queue reaches `maxBatchSize`. Bounded memory, bounded round-trip count, low end-to-end latency.

We pick **(c)**. Defaults: `flushIntervalMs: 5_000`, `maxBatchSize: 100`. Each event is still POSTed independently inside the batch (rather than a bulk endpoint) because:

- The catalog's existing `POST /usage` is per-event with idempotency.
- A bulk endpoint would require a separate ADR (RFC 7807 problem mapping per-row failure, partial-success semantics) for marginal benefit.

### D5 — Idempotency is the catalog's responsibility, not ours

The audit asked for "idempotent via `idempotencyKey`." The catalog accepts an optional `idempotencyKey` on each usage POST. For tool calls, a natural key is `${runId}:${toolCallId}` — but the orchestrator doesn't currently surface that to telemetry attrs.

For this slice we **don't generate `idempotencyKey`s.** Rationale:

- The wrap point doesn't have access to a stable per-call ID without adding new emit attributes.
- Each event has a unique `occurredAt` and is a distinct row even on accidental double-POST — the over-counting risk is low (transient network blip during one batch flush).
- Adding `idempotencyKey` is a follow-up that's clean to layer on once we instrument call-id propagation through telemetry.

The catalog accepts the events without a key just fine; we trade off a tiny double-count risk on retries against not threading a new field through every emit-site.

### D6 — Wired into `provideAgenticPlatform` as a per-feature switch

Following the ADR-031 pattern: `usageMetering?: UsageMeteringFeatureOptions | false`. Hosts that already have their own telemetry sink pass it as `delegate` so their telemetry continues unaffected; the metering side is purely additive.

`false` skips the wrap entirely — `AGENTIC_TELEMETRY_SINK` resolves to the default Noop and no usage events flow. This is the right behaviour for non-platform adopters.

### D7 — Failures don't block emit, don't crash the runtime

POST failures land on `failed: Signal<number>` (cumulative) and the queue moves on. The runtime never sees a metering failure — the telemetry path is fire-and-forget all the way through.

Operators who want stricter semantics ("if metering is broken for >N seconds, block tool calls") implement that in their own initializer using the `failed` and `flushed` signals; we don't bake it in.

---

## Consequences

### Positive

- **The Usage page populates.** Real workload signals reach the catalog without per-call-site instrumentation.
- **Composes with host telemetry.** Hosts that wire their own OTel / Sentry sink keep it via the `delegate` knob.
- **Bounded memory.** `maxBatchSize` caps the queue; chatty agents flush when full instead of growing without bound.
- **Single seam, multiple event kinds.** Tool calls, widget renders, federation loads all flow through the same wrap — adding a new "usage-relevant" event kind is one new branch in `emit()`.
- **Closes the audit's Gaps 1-4 mini-program.** Together with ADR-031/032/033, the runtime↔platform integration story moves from "two of six adapters wired, the rest is curl" to "add one provider line, get the whole platform."

### Trade-offs

- **No per-call idempotency key (D5).** A retry within a single batch could double-count; we accept the risk for this slice. Follow-up: thread `${runId}:${toolCallId}` through telemetry attrs, then use it as the key.
- **Fire-and-forget batches don't retry.** A failed batch is lost (the events were already spliced from the queue). For low-volume usage data this is fine; for high-fidelity billing data, hosts should run their own retry-on-failure wrapper. Documented as out-of-scope.
- **No bulk endpoint.** N events = N round trips per flush. Acceptable today; a future bulk endpoint reduces this if catalogs grow >100s of events per second per tenant.
- **Replaces `AGENTIC_TELEMETRY_SINK` token.** Hosts that already replaced it get overridden — but the `delegate` field exists exactly to preserve their sink. Migration is "move your sink into `delegate`."

### Out-of-scope

- **OpenTelemetry trace propagation.** The catalog `usage` endpoint stores units, not spans. OTel-grade tracing is a separate ADR (audit's "Observability" gap) — `/metrics` and trace export to a collector belong with that work.
- **Per-tenant quota enforcement.** This slice supplies the data; deciding "tenant X exceeded N tool calls/day, block further calls" is policy work for a later ADR.
- **LLM token metering.** The audit mentions "every LLM call" — but the runtime tier doesn't currently emit a structured "LLM call ended with N tokens" event; that's a host-backend concern. When a backend adapter emits it, the wrapping sink needs an additional branch — straightforward.
- **`idempotencyKey` generation** (D5).

---

## Verification

- `projects/agentic-ui/src/lib/platform/provide-catalog-usage-metering.spec.ts` — 7 TestBed tests covering:
  - Tool-call span end → catalog POST with `kind: 'tool.call'`, `quantity: 1`, success tag.
  - Approval-queued tool calls are skipped (no usage event).
  - `widget.render` and `federation.load.end` events queue + flush.
  - `delegate` sink receives every event (forwarding works).
  - Time-based flush at `flushIntervalMs`.
  - Size-based flush at `maxBatchSize`.
  - Failed POSTs increment the `failed` counter.
- `projects/agentic-ui/src/lib/platform/provide-agentic-platform.spec.ts` — 1 new test verifying the `usageMetering` switch wires through shared catalogUrl/tenantId/getToken and that emit→POST flows end-to-end.

## Status snapshot

- Lib tests: 433 → 441 (+8)
- Catalog tests: 165 (unchanged)
- mvk-cli tests: 53 (unchanged)
- ops-console tests: 59 (unchanged)
- **Total: 718/718 passing**

This completes the audit's Gaps 4 → 1 → 3 → 2 mini-program: 4 ADRs, 4 new providers, ~38 new tests across runtime + catalog tiers. The `provideAgenticPlatform` composite now wires single-config-point + capability registrar + capability authorizer + usage metering — the consumer-app integration story is "one provider, four feature switches, all opt-in."
