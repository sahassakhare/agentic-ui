# ADR-027 · Catalog SSE stream — proper real-time, polling becomes fallback

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-015](./0015-catalog-server-design.md) · [ADR-019](./0019-ops-console-design.md) · [ADR-024](./0024-ops-console-realtime-polling.md)

---

## Context

[ADR-024](./0024-ops-console-realtime-polling.md) shipped 8s polling
as the pragmatic real-time stand-in, with SSE flagged as the proper
next slice. Operators complained — fairly — that 8s lag is fine for
a dashboard but feels stale during live demos when you want to show
"register a capability + watch it appear instantly."

ADR-015 §D-future already named SSE as the v0.2 catalog-server
addition. This ADR codifies what we built.

---

## Decision

### D1 — `GET /v1/catalogs/{tenant}/stream` Server-Sent Events

The catalog gains an SSE endpoint per tenant. Clients (the ops
console, in-house dashboards, the `mvk` CLI in a future slice)
open a long-lived `EventSource` connection and receive one
`event: mutation` frame per write the catalog observes.

Frame shape:

```
event: open
data: {"tenantId":"acme","at":"2026-05-09T12:00:00Z"}

event: mutation
data: {"tenantId":"acme","entityType":"capability","operation":"create","entityId":"cap-1","occurredAt":"...","summary":{"kind":"tool","name":"bookFlight"}}

event: ping
data: {"at":"..."}
```

`open` lands first so clients can confirm the stream is live.
`mutation` for every catalog write. `ping` every 25s as a heartbeat
so intermediaries (Render's load balancer, Cloudflare) don't time
out idle connections.

### D2 — In-process EventBus (single-replica scope)

`src/events/catalog-bus.ts` exposes a singleton `EventEmitter`. Every
mutation route calls `catalogBus.emit({tenantId, entityType,
operation, entityId, occurredAt, summary?})` after the data write
succeeds. The SSE route subscribes to the bus, filters by tenant,
forwards as SSE frames.

**Scope is single-replica.** When the catalog runs multiple replicas
(Helm chart `replicaCount: 2+`), a mutation on replica A is NOT
observed by SSE clients connected to replica B. Honest constraint —
documented loudly in the bus's source code, in the SSE route's
comments, and in this ADR.

The proper multi-replica fix is **Postgres `LISTEN/NOTIFY`** — every
replica opens a long-lived `LISTEN` connection; mutation handlers
emit `NOTIFY catalog_events, '<json>'`; every replica re-broadcasts
to its connected SSE clients. Deferred to a follow-up slice (D5).

For the Render demo (single replica), the in-process bus is correct
+ delivers <100ms latency.

### D3 — Per-tenant filtering at the SSE route, not the bus

The `CatalogEventBus` accepts and forwards every event regardless of
tenant. The SSE route handler subscribes once per connection and
filters incoming events to match the principal's tenant before
writing them to the SSE stream.

We deliberately do not filter at the bus layer for two reasons:
- Tests want to see cross-tenant streams.
- Future ops-console "platform-admin sees everything" mode would
  need cross-tenant subscriptions anyway.

Per-connection listeners are cheap (`EventEmitter` is a hashtable
of arrays); the bus's `setMaxListeners(0)` removes Node's default
warning when many SSE clients connect concurrently.

### D4 — Mutation payload is a hint, not a source of truth

The `summary` field is intentionally minimal — for capabilities we
ship `{kind, name}`; for usage we ship `{kind, quantity}`; for
tenants we ship nothing. We do **not** ship the full row.

Reasons:

- **RLS containment.** Even with bus filtering, a misconfigured
  downstream that stamps the SSE event in a log could leak
  cross-tenant data if the payload included full rows. Tiny
  hints minimise the blast radius.
- **Client semantics: re-fetch on event.** The ops console treats
  each event as a "something changed; re-call the list endpoint"
  signal. The full state still comes from the authoritative GET.
  This matches how big-tech invalidation streams work
  (Stripe webhook → call back; Discord gateway → fetch
  authoritative).
- **Bandwidth.** A noisy LLM-token-heavy tenant could push 100+
  events/sec. Tiny payloads keep the stream <100 KB/s.

### D5 — `pg LISTEN/NOTIFY` is the proper multi-replica path; deferred

Concrete plan for the follow-up slice:

```ts
// In catalog-bus.ts
const listenClient = await pool.connect();
await listenClient.query('LISTEN catalog_events');
listenClient.on('notification', (msg) => {
  if (msg.channel === 'catalog_events') {
    const event = JSON.parse(msg.payload!);
    this.emitter.emit('mutation', event);
  }
});

// In every mutation route
await client.query(
  "SELECT pg_notify('catalog_events', $1)",
  [JSON.stringify(event)],
);
catalogBus.emit(event);  // local replica still emits in-process for self
```

Deferred because:
- The Render demo runs one replica; multi-replica isn't exercised
  live.
- pg-mem doesn't support `LISTEN/NOTIFY`, so tests would need a
  testcontainers-backed Postgres harness — substantial new test
  infrastructure.
- The single-replica path is correct + small + ships value today.

The Helm chart's `replicaCount` defaults to 2, so this **is** a
real production gap for Helm-deployed adopters. The README's
production-hardening checklist will be updated to flag it; full
fix is its own slice.

### D6 — EventSource auth: token-as-query-param when OIDC; bare URL when disabled

Browser `EventSource` cannot carry an `Authorization` header — there's
no API for it. Two workarounds:

1. **`?token=<jwt>` query param.** The catalog accepts the token
   from the query string when OIDC is on. **Documented; not yet
   live** — the deployed Render demo runs `AUTH_MODE=disabled`, so
   the SSE endpoint admits unauthenticated connections (synthesises
   the platform-admin principal per ADR-022). The OIDC SSE path
   needs server-side wiring (extract token from `?token=`, validate,
   attach principal). Tracked.

2. **`fetch()` with `Accept: text/event-stream`** — gives header
   control but you give up native auto-reconnect. We chose
   `EventSource` for the reconnect; the query-param trade-off is
   acceptable.

The token-in-URL approach has a footnote: tokens land in server
access logs. Mitigations:
- Operators configure log-redaction filters (the catalog's pino
  logger already redacts `Authorization` headers; needs a similar
  rule for `?token=` query params).
- Rotate tokens frequently.
- Don't share log files.

This is a real footgun and one reason we keep OIDC SSE deferred —
the redaction wiring needs to land alongside.

### D7 — Ops console: SSE-first, polling fallback

`CatalogStreamService` opens an EventSource scoped to the
principal's tenant. When `readyState === OPEN`, it pauses the
`AutoRefreshService` (ADR-024). On error / close / network blip
(when `readyState !== OPEN`), it resumes polling. The native
`EventSource` auto-reconnect handles transient disconnects.

The shell's "live" indicator now distinguishes:
- **`live (SSE)`** — green pulse, sub-second updates.
- **`live (polling 8s)`** — green dot, 8s lag (fallback path).
- **`paused`** — tab hidden.

Pages call `autoStream(() => this.refresh(true))` alongside
`autoRefresh(...)` so they get fresh data via whichever channel
is active.

### D8 — Heartbeat as `event: ping` every 25s

Render's HTTP load balancer kills idle connections after ~30s; most
intermediaries (Cloudflare, AWS ALB) sit between 30s–60s. A 25s
ping keeps the connection alive. EventSource clients ignore unknown
event names by default, so the ping is invisible to the listener
unless they explicitly subscribe.

We chose 25s over a more aggressive 10s because:
- More frequent pings burn bandwidth without changing semantics.
- 25s leaves ~5s headroom under a 30s timeout — tight but reliable.

---

## Consequences

### Positive

- **Sub-second updates.** Register a capability via the ops console
  and the table in another browser tab updates within ~50ms.
  Demo flow becomes "click + watch it appear" instead of "click +
  count to 8."
- **Polling becomes proper fallback.** When SSE works, it works.
  When the network blips or the catalog goes down, polling takes
  over. No silent stale state.
- **Audit page in particular benefits.** Watching the chain head
  tick up live as mutations land elsewhere is a compelling demo.
- **9 + 6 = 15 new tests.** SSE endpoint integration tests
  (subscribe / mutation / tenant-filter / cleanup) + ops-console
  EventSource tests with a fake EventSource. Total platform
  suite: 630.

### Negative / risks

- **Single-replica only.** Helm-deployed adopters running
  `replicaCount: 2+` see partial event streams. Documented; pg
  LISTEN/NOTIFY is the next slice.
- **Token-in-URL footgun for OIDC SSE.** Token leaks into HTTP
  access logs. Mitigated by redaction rules + rotation; the OIDC
  SSE path is documented but not yet exercised live.
- **Bandwidth on chatty tenants.** A tenant emitting 100 usage
  events/sec produces a 5–10 KB/s SSE stream per connected
  client. For ~10 connected ops-console operators that's 100
  KB/s aggregate — fine. If the ops console moves to a
  retention-style "live tail" that connects more clients, we'll
  add server-side rate limiting.

### Out of scope (deferred)

- **Multi-replica via pg LISTEN/NOTIFY.** Concrete plan in §D5;
  needs testcontainers-backed Postgres tests (separate harness).
- **OIDC SSE auth path live.** Currently documented but not
  exercised. Needs token-from-query-param extraction + audit-log
  redaction.
- **Server-Sent Events with backpressure.** Currently every
  subscriber gets every event, write errors close the stream.
  For high-volume tenants we'd want a per-connection buffer
  cap with overflow → close + reconnect.
- **Ops console "what just changed" UI.** A toast / activity feed
  that shows the last N mutations as they stream in. Trivial
  with the SSE service; defer until adopter feedback shows
  demand.

---

## Implementation summary

### Catalog

- `src/events/catalog-bus.ts` — singleton `EventEmitter` wrapper
  with strongly-typed `CatalogMutationEvent`.
- `src/routes/stream.ts` — `GET /v1/catalogs/:tenant/stream`. Hono's
  `streamSSE` helper. `open` frame, mutation forwarding (with
  per-tenant filter), 25s heartbeat, `onAbort` cleanup.
- Mutation routes (capabilities, role-mappings, mfes, tenants,
  usage) call `catalogBus.emit` after each successful write. Five
  routes touched.

### Ops console

- `src/app/services/catalog-stream.service.ts` — `EventSource`
  client. Pauses `AutoRefreshService` when SSE is OPEN; resumes
  when it errors. Tracks state as a signal: `connecting | live |
  polling | closed`.
- `autoStream(refresh)` helper — pages subscribe alongside
  `autoRefresh(refresh)`. The shell's footer distinguishes SSE
  vs polling vs paused.

### Tests (630 total = 156 catalog + 408 lib + 44 ops-console + 22 mvk-cli)

- 5 catalog `CatalogEventBus` tests (delivery, unsubscribe,
  listener-count tracking, payload pass-through, no-subscriber
  no-throw).
- 4 catalog SSE-route integration tests (auth, frame shape,
  per-tenant filtering, cleanup on cancel).
- 6 ops-console `CatalogStreamService` tests (open URL, polling
  pause on live, mutation forward, polling fallback on close,
  no-fallback when readyState OPEN, malformed-payload drop).
