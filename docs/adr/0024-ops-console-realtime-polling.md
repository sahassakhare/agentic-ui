# ADR-024 · Ops Console real-time data — polling first, SSE later

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-015](./0015-catalog-server-design.md) · [ADR-019](./0019-ops-console-design.md) · [ADR-023](./0023-ops-console-editor-surfaces.md)

---

## Context

The ops console fetches each page's data once on construction and
never again. Operators using the demo deployment immediately asked
for "real-time" — they want to see new tenants / capabilities /
audit entries appear as they land, without manually refreshing.

Two ways to deliver this:

1. **Polling** — re-fetch on a timer, ~5–10s cadence.
2. **Server-Sent Events (SSE)** — server pushes events when state
   changes; client subscribes via `EventSource`.

[ADR-015](./0015-catalog-server-design.md) §D-future already calls
out SSE as a v0.2 catalog-server addition. So SSE is the right
long-term destination — but it's a real engineering project
(Postgres `LISTEN/NOTIFY` or in-process pub/sub, new
`/v1/.../stream` route, EventSource client with reconnect logic,
new tests). 1–2 days minimum.

Polling is the pragmatic shortcut: ~30 lines of service code +
one-line wiring per page. Ships in an hour. Trade-off: 0–10s lag
instead of <100ms, and it costs one round-trip per registered
page per tick even when nothing changed.

This ADR codifies polling **as a stepping stone**, with SSE as the
next slice once adoption justifies the work.

---

## Decision

### D1 — Polling now, SSE deferred

`AutoRefreshService` ticks every 8 seconds. Each page registers a
"refresh" callback at component construction; the service runs them
all on tick. Default cadence is a compromise: short enough that the
UI feels live (operators stop hitting Cmd+R), long enough that
Render's free-tier bandwidth isn't a concern.

SSE remains the proper next step. When demand justifies it, we'll
add a `/v1/catalogs/{tenant}/stream` SSE endpoint that emits an
event for every catalog mutation. The polling service becomes the
fallback when the EventSource fails.

### D2 — Tab-visibility-aware

`document.visibilityState` gates ticking. When the operator's tab is
hidden (background tab, screen locked, etc.), the service pauses.
Wake-up is on `visibilitychange`, so flipping back to the tab
resumes ticking immediately.

This matters for the Render demo deployment: users tend to leave
the ops console open in a background tab. A naive 8s polling
implementation would generate 10 800 requests/day per idle tab,
which quietly burns Render's free-tier bandwidth.

### D3 — Silent re-fetches; loading flag preserved on first fetch

Each page's `refresh(silent)` flag is `false` on the initial fetch
(shows the "Loading…" placeholder) and `true` on every subsequent
auto-tick. Reasons:

- **No "Loading…" flicker every 8s.** The table stays stable; data
  updates in place.
- **First fetch still shows feedback.** Operators see "Loading…"
  on cold cache, not a blank page.
- **Errors stay sticky.** A failed tick surfaces the error banner
  but doesn't reset the visible data — a transient network blip
  doesn't blank the table.

### D4 — Live indicator in the shell footer

A 8 px dot pulses green when polling is active, sits dim grey
when paused. Tooltip shows the cadence. Operators glance at the
sidebar and know whether they're seeing live data.

The indicator pairs with the existing `AUTH_MODE=disabled` warning
banner ([ADR-022](./0022-auth-disabled-mode.md) §D3) — both
surface trust + freshness state where the operator already looks.

### D5 — One service, many subscribers; no per-page timers

A single `AutoRefreshService` instance fires all registered
callbacks on each tick. Reasons:

- **One timer, predictable load.** Six pages × per-page timer would
  produce drift, jittered cadences, and harder reasoning about
  "is this stale or did I just navigate?". One central tick is
  the canonical pattern.
- **Memory cleanup is automatic.** The `autoRefresh()` helper hooks
  `inject(DestroyRef).onDestroy(unregister)`, so navigating away
  from a page de-registers without operator intervention.
- **Easy to disable globally.** `svc.setEnabled(false)` pauses
  every page at once — useful for manual-mode users + for
  pause-during-debugging workflows.

### D6 — No optimistic UI yet

After every editor mutation ([ADR-023](./0023-ops-console-editor-surfaces.md)),
the page calls `refresh()` directly. We do **not** rely on the
auto-refresh tick to surface the change.

Reasons:

- **Operator latency expectation.** When you click "Onboard
  tenant", you expect the table to show the new row in <500 ms,
  not within the next 8s window.
- **Audit trail is the truth.** The mutation endpoint returns the
  full row; the post-mutation refetch verifies the row landed +
  audit row appended.
- **Polling is best-effort, not authoritative.** A polling-only
  flow would coast on stale data when the endpoint silently
  fails; the explicit refresh-on-success keeps the post-mutation
  state honest.

---

## Consequences

### Positive

- **Demo feels live.** Open the console, leave it on the dashboard,
  fire `curl POST` from another terminal — you see the row appear
  within 8s without touching anything.
- **No bandwidth burn.** Tab-visibility pause + 8s cadence means
  an idle background tab makes 0 requests until brought to focus.
- **Clean upgrade path.** When SSE lands, `AutoRefreshService`
  becomes the fallback when `EventSource.readyState !== OPEN`.
  Pages don't change.
- **38/38 ops-console tests** including 7 new polling-service
  tests covering tick / multiple subscribers / unregister /
  enable-disable / per-ticker error isolation / setIntervalMs.

### Negative / risks

- **8s lag is ops-acceptable but not great.** SSE proper would
  feel <100 ms. Acknowledged; demo cadence is fine for now.
- **Six pages × 1 round-trip every 8s = 6 RPS aggregate.** Not a
  concern for the Render demo; operators with many open tabs
  *across many users* would fan this out, but those operators
  should already be on SSE.
- **Backoff on errors not implemented.** If the catalog goes
  down, every page keeps polling at 8s. Service-side rate
  limits would absorb this; but if it becomes a problem, we'll
  add per-ticker backoff in the service.

### Out of scope (deferred)

- **SSE push.** Plan-v3 v0.2 catalog-server addition. Tracked in
  [ADR-015 §D-future](./0015-catalog-server-design.md).
- **Per-page cadence override.** Operators might want the audit
  page at 30s and the usage page at 5s. Trivial extension when
  needed; not done today.
- **Manual "refresh now" button.** The shell could expose a
  trigger that fires every registered ticker immediately. Useful
  for operators who don't want to wait the residual seconds;
  defer until requested.
- **Backoff on sustained errors.** Add when needed — for now,
  a transient blip is recoverable on the next tick and a
  sustained outage shows the error banner persistently.

---

## Implementation summary

- `platform/agentic-ops-console/src/app/services/auto-refresh.service.ts`
  — `AutoRefreshService` (singleton, `providedIn: 'root'`) +
  `autoRefresh(refresh)` helper that wraps `register()` + lifecycle
  cleanup via `inject(DestroyRef)`.
- `platform/agentic-ops-console/src/app/components/shell.component.ts`
  — live/paused dot in the footer, bound to `autoRefresh.running`.
- 6 page components updated to call `autoRefresh(() => this.fetch(true))`
  after their initial fetch:
  capabilities, mfes, role-mappings, audit, usage, tenants.
- `auto-refresh.service.spec.ts` — 7 unit tests with
  `vi.useFakeTimers()` for deterministic clock control.
- ops-console total: **38/38** (was 31; +7).
- Catalog + lib unchanged.
