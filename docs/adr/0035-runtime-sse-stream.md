# ADR-035 · Runtime-tier `CatalogSseService` + SSE-driven authorizer

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-027](./0027-catalog-sse-stream.md) · [ADR-029](./0029-multi-replica-sse-pg-listen.md) · [ADR-033](./0033-catalog-capability-authorizer.md) · [Post-audit follow-ups plan](../plans/post-audit-followups-plan.md#slice-a1--sse-driven-capability-authorizer)

---

## Context

[ADR-033](./0033-catalog-capability-authorizer.md) shipped the catalog capability authorizer with **30-second polling** as the v1 transport. Operator toggles in the ops console took ≤30 s to propagate to running consumer apps. ADR-033 §Out-of-scope explicitly listed SSE-based live updates as a follow-up.

The catalog server has shipped per-tenant SSE since [ADR-027](./0027-catalog-sse-stream.md) (single-replica) + [ADR-029](./0029-multi-replica-sse-pg-listen.md) (multi-replica via `pg LISTEN/NOTIFY`). The ops console has consumed it since [ADR-030](./0030-ops-console-activity-feed.md). The runtime tier had no SSE consumer until this slice.

**Why now**: the post-audit follow-ups plan called for two pieces that both need a real-time event stream — (1) the authorizer should act on operator toggles in <1 s, and (2) the future capability-graph view in the ops console (slice S1) needs a live event source for graph updates. Both want the same primitive; build it once.

---

## Decision

### D1 — Generic `CatalogSseService` in `@infra-tools/agentic-ui/platform`

Extract a runtime-tier SSE consumer modeled on the ops-console's `CatalogStreamService` (which has been live in production since ADR-027). The lib-side version is decoupled from the ops-console's `AuthService` / `AutoRefreshService` / `environment` — generic enough to be consumed by any runtime app via DI.

Public surface:

```ts
@Injectable({ providedIn: 'root' })
export class CatalogSseService {
  configure(cfg: CatalogSseConfig): void;
  connect(): Promise<void>;
  disconnect(): void;
  onMutation(handler: (event: CatalogMutationEvent) => void): () => void;
  readonly state: Signal<'idle' | 'connecting' | 'live' | 'fallback' | 'closed'>;
  readonly isLive: Signal<boolean>;
}
```

The service is `providedIn: 'root'` so a single connection serves every consumer (authorizer, capability-graph, future usage-stream). Consumers register listeners via `onMutation()`; events fan-out synchronously in registration order.

### D2 — Auto-wired by the authorizer; no separate provider switch

`provideCatalogCapabilityAuthorizer` injects `CatalogSseService` and calls `configure()` + `connect()` itself. The host doesn't have to opt in to SSE separately — turning the authorizer on auto-enables SSE.

Rationale: SSE is a transport detail, not a separate feature. The authorizer's *behavior* (gate registry reads on the catalog's disabled list) is what the host opts in to; whether that's driven by polling or SSE is implementation-internal.

Future consumers (capability-graph, usage-stream) follow the same pattern: they inject `CatalogSseService`, register their listener, and let the service handle the connection lifecycle.

### D3 — Polling stays as a fallback + keep-alive; cadence flips on SSE state

The authorizer's polling tick from ADR-033 is **not removed**. It serves two purposes now:

1. **Fallback** when SSE is unreachable (proxy stripping `text/event-stream`, `EventSource` undefined in SSR / non-browser, catalog-server errors). Polling cadence stays at the configured `refreshIntervalMs` (default 30 s).
2. **Keep-alive recovery** when SSE is live. Cadence stretches 10× (300 s default) — covers any missed events without doubling the round-trip count.

Cadence flips reactively: an Angular `effect()` watches `sse.state()` and restarts the polling timer with the new interval when state changes. Both branches (fallback and keep-alive) are exercised in tests.

### D4 — Capability mutations trigger a full `refresh()`, not a delta apply

The catalog's SSE event payload is intentionally minimal (`tenantId + entityType + operation + entityId + occurredAt + summary`). It does **not** carry the full capability shape — operators may patch lifecycle, owner, scopes, tags etc. and the runtime needs the full row to recompute the deny-list correctly.

Cheapest correct response: on every `event.entityType === 'capability'`, call `svc.refresh()` (re-GET `?lifecycle=disabled`). One round trip per mutation; the latency from operator-toggle to runtime-effect is 1 round-trip instead of up-to-30 s polling.

Non-capability events (`audit`, `usage`, `mfe`, `tenant`, `role_mapping`) are ignored by the authorizer — they're for other consumers.

### D5 — `EventSource` auth: token-via-URL query param

`EventSource` cannot carry an `Authorization` header. ADR-027 §D6 already documented the `?token=<jwt>` workaround for the ops-console; we reuse the catalog server's existing token-via-URL acceptance.

For demo deploys (`AUTH_MODE=disabled`), `getToken()` returns `null` and the param is omitted entirely.

For OIDC production hosts, the long-term fix is short-lived per-stream tokens via a `/v1/sse-token` endpoint (so the JWT doesn't end up in proxy / browser-history logs). That's a separate slice; this ADR ships the demo-suitable shape today.

### D6 — Reconnect = browser-default `EventSource` behaviour + state signal

Native `EventSource` auto-reconnects with implementation-defined backoff (Chrome: 3 s ramping; Firefox: similar). The service watches `readyState` on `error` events:

- `readyState === CONNECTING (1)` — the browser is reconnecting; stay in `'live'` or transition to `'connecting'` if we never opened.
- `readyState === CLOSED (2)` — terminal failure; flip to `'fallback'`. Polling cadence reverts to base interval.

On `open`, flip to `'live'`. On `disconnect()` (manual close), flip to `'closed'`.

We deliberately **don't** ship our own backoff loop. The browser's behaviour is good enough; rolling our own would mostly add code without measurable benefit.

### D7 — Test seam: `eventSourceFactory`

The service accepts an optional `eventSourceFactory: (url: string) => EventSource` in `CatalogSseConfig`. Tests pass a stub class that lets them deterministically fire `open` / `mutation` / `error`. The authorizer's options also expose `eventSourceFactory` for the same reason.

Production hosts never set this. Documented as a test seam.

### D8 — Telemetry events

Four new sink events for operators tracking SSE health:

| Event | When | Tags |
|---|---|---|
| `agentic.platform.sse.opened` | EventSource `open` frame | tenant |
| `agentic.platform.sse.fallback` | flip to fallback state | reason ('EventSource undefined' \| 'EventSource error') |
| `agentic.platform.sse.event_received` | per `mutation` event | entity_type, operation |
| `agentic.platform.sse.parse_error` | malformed payload (drop silently) | error.message |

OpenTelemetry / console / OTel sinks all see these the same way they see existing `agentic.platform.*` events.

---

## Consequences

### Positive

- **Operator toggle latency: ≤30 s → ~1 s.** When SSE is live, capability-disable propagates as fast as the catalog can publish.
- **Lower poll churn.** Keep-alive at 5 min instead of 30 s reduces request volume by 90 % per consumer when SSE is healthy.
- **Reusable primitive.** Future capability-graph view (slice S1) gets live updates for free — same service, new listener.
- **Graceful degradation.** SSE unavailable → polling reverts to base cadence. No host action required.
- **Federation-safe singleton.** `providedIn: 'root'` + lib's single-primary-entry (ADR-005) means host and remotes share one `EventSource`, not one per remote.

### Trade-offs

- **One round trip per capability mutation.** SSE fires the event; the authorizer fetches `?lifecycle=disabled`. Could be optimized to a delta-apply if the SSE payload included the full row, but ADR-027 deliberately kept the payload minimal — re-fetching is correct + simple.
- **Token-in-URL** for OIDC hosts is a known limitation. Demo deploy uses `AUTH_MODE=disabled` so no token leaks. Production hosts need the short-lived-token slice.
- **Bundle size**: +8 KB FESM. Within the 340 KB cap (now 322 KB; 18 KB headroom). One more capability slice will likely require a budget review.

### Out-of-scope

- **Short-lived per-stream tokens** for OIDC SSE. Separate ADR; production-only concern.
- **Replaying missed events** on reconnect. The catalog doesn't carry a per-tenant event log; reconnection re-fetches the disabled list, which is sufficient for the authorizer's contract. A general "missed events" replay would need a server-side change (event-id sequence + Last-Event-ID header).
- **Per-listener event filtering on the server.** Today every listener sees every mutation; consumers filter client-side. At <100 mutations/sec/tenant, the cost is negligible.

---

## Verification

- [`projects/agentic-ui/src/lib/platform/catalog-sse-service.spec.ts`](../../projects/agentic-ui/src/lib/platform/catalog-sse-service.spec.ts) — 8 tests covering URL building (with + without token), open/mutation/listener-removal, fallback on error, malformed-payload safety, disconnect cleanup, idempotent connect, and `EventSource`-undefined fallback.
- [`provide-catalog-capability-authorizer.spec.ts`](../../projects/agentic-ui/src/lib/platform/provide-catalog-capability-authorizer.spec.ts) — 2 new tests: SSE-driven refresh on `entityType: 'capability'` (live updates flow through), non-capability events ignored (no spurious fetches).
- All previous authorizer tests still pass — SSE failures gracefully fall back to polling.

## Status snapshot

- Lib tests: 443 → 453 (+10 tests across SSE service + authorizer SSE flow)
- Catalog tests: 165 (unchanged — server-side already shipped)
- mvk-cli tests: 53 (unchanged)
- ops-console tests: 59 (unchanged — ops-console keeps its own `CatalogStreamService` for now; future consolidation is possible but not required)
- **Total: 730/730 passing**
- FESM size: 322 KB / 340 KB cap (18 KB headroom)
