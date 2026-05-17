# ADR-030 · Ops Console activity feed — live mutation timeline

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-019](./0019-ops-console-design.md) · [ADR-027](./0027-catalog-sse-stream.md) · [ADR-029](./0029-multi-replica-sse-pg-listen.md)

---

## Context

We have a per-tenant SSE stream (ADR-027 + ADR-029) that pushes
catalog mutations to the ops console. The current consumers
(capabilities / mfes / role-mappings / audit / usage / tenants
pages) treat events as "something changed; re-fetch" signals —
they show *what's there* but not *what just happened*.

Operators kept asking: "Show me the last N mutations as a feed.
I want to see live activity during a demo and during incident
investigations." That's a thin, additive page over infrastructure
we already built. ADR-027 §Out-of-scope explicitly flagged it as
"defer until adopter feedback shows demand" — that's now.

---

## Decision

### D1 — `ActivityFeedService` (root-scoped) consumes SSE + audit-log backlog

> **Updated 2026-05-11** — original D1 chose "pure consumer of
> `CatalogStreamService`; no new service", on the trade-off that
> closing the tab loses the buffer. Operator feedback after the
> 2026-05-10 deploy: "activity is not retained" — the empty-feed
> flicker on every page navigation made the feature feel broken.
> The original trade-off was wrong; revising.

The activity page reads from a root-scoped `ActivityFeedService`.
The service:

- Subscribes to `CatalogStreamService.onMutation` once at
  construction and prepends each event to an in-memory ring
  buffer.
- Calls `catalog.recentAudit(limit)` (new endpoint
  `GET /v1/catalogs/{tenant}/audit/recent`) the first time a
  tenant becomes available, and again whenever the active tenant
  changes.
- Exposes `buffer()` / `loadingBacklog()` / `backlogError()` /
  `lastSyncedAt()` signals + `reload()` / `clear()` methods.

`ActivityComponent` is a thin display layer that reads the
service signals and composes a per-view UI (filters, sort, day
grouping). Switching pages and coming back is instant — the
service buffer survives component teardown.

`/audit/recent` was added because `/audit/export` returns JSONL
intended for SIEM consumers; the UI wanted a small JSON shape
mirroring the SSE event (with `actor` / `requestId` /
`chainPosition` extras). Limit bounded 1–500, default 100.

Composite-id dedup (`occurredAt + entityId + operation`) prevents
double-counting when a row exists in both the backlog and a live
SSE event.

### D2 — Ring buffer of 200 events, newest at the head

`MAX_EVENTS = 200`. New events prepend; the buffer truncates from
the tail. Trade-offs:

- **200 is enough for a real-time view.** Operators glance at
  the top of the list to see what just happened; if they're
  scrolling past 200 events they should be on the audit page
  with proper search.
- **Ring buffer keeps memory predictable.** A noisy tenant
  emitting 100 usage events/sec doesn't blow the heap.
- **Sorted by `event.occurredAt`** as emitted by the catalog,
  not by arrival order. This protects against re-ordering when
  multiple replicas race to emit (rare but possible per
  ADR-029); operator sees the catalog's authoritative ordering.

### D3 — Filters: entity type AND operation, AND-combined

Two `<select>` filters:

- **Entity** — `all | capability | mfe | role_mapping | tenant | usage | audit`.
- **Operation** — `all | create | update | delete | restore`.

Filters AND together. If both are `all`, every buffered event
shows.

We deliberately don't filter at subscription time — events go into
the buffer regardless of filter state, so the operator can flip
the filter to "all" and see everything that happened in the
window. Filtering at the bus subscriber level would lose history
when the operator changed filter.

### D4 — `clear()` resets the buffer; no reconnect

The "Clear" button drops every entry. We don't tear down the SSE
subscription — that's the shell's responsibility per ADR-027 §D7.
Clearing only affects this page's buffer, not the stream.

### D5 — Summary rendering: tiny key=value pills

The catalog ships minimal `summary` payloads with each event
(ADR-027 §D4): for capability create, `{kind, name}`; for usage,
`{kind, quantity}`; tenants ship nothing. The activity feed
renders these as `<span class="kv">kind=tool</span>` pills.

Null / undefined values are filtered out (don't pollute the
display with `summary=null`). Stable order — `Object.entries` plus
the catalog emitting in the same field order means filed pills
render predictably.

### D6 — Color-coded operation dot

Each entry has a leading 8px dot:

- `create` → green
- `update` → yellow / warn
- `delete` → red

Operators recognise the pattern from the audit-chain page; this
is the same color language. No new ADR needed for the colors —
they're consistent with `--good`, `--warn`, `--bad` CSS vars set
in `styles.scss`.

### D7 — "Stream offline" badge in the header

When `CatalogStreamService.isLive() === false`, the header shows
`stream offline` instead of the live pulse. The shell footer
already shows this signal globally (ADR-024 §D4) but having it
on the page itself makes the failure mode obvious for the user
who's watching the feed.

When the stream is live, the badge pulses green.

---

## Consequences

### Positive

- **Demo-friendly.** Open the activity page in one tab, run
  `mvk capability register` from a terminal, watch the feed
  light up sub-second.
- **Incident UX.** During a "what just happened?" investigation,
  the live tail is the right primitive; the audit page is for
  "what happened *over a window*."
- **Zero new server-side surface.** Reuses ADR-027 + ADR-029
  infrastructure exactly. No catalog migrations, no new endpoints.
- **9 new tests.** Covers buffer behaviour (rotation, ordering),
  filters (entity / operation / AND-combined), summary rendering,
  clear semantics. Total ops-console: 59/59.

### Negative / risks

- **Buffer is in-memory only.** Closing the tab loses history.
  Acceptable — for persistent history, audit chain export is
  the canonical path.
- **Filter UX is minimal.** No multi-select, no text search, no
  date range. We chose simple over featureful for v1; if
  operators ask, we extend.
- **No grouping / collapse for noisy tenants.** A tenant
  emitting 100 usage events/sec fills the buffer fast. The 200-
  event cap is the only mitigation. Real noisy environments need
  per-kind subscription filtering at the SSE layer (ADR-027 §Out
  of scope) — defer.

### Out of scope (deferred)

- **Persistent history.** Page-load fetch of recent audit events
  to seed the buffer. Useful — the buffer otherwise starts
  empty after a refresh. Defer until UX feedback confirms it
  matters.
- **Per-event detail modal.** Click an entry to see full
  context (RFC 7807 detail, audit-chain position, before/after
  diff). Trivial extension; deferred until used in anger.
- **Tenant switcher integration.** When the operator switches
  tenant via the shell footer (AUTH_MODE=disabled mode), the
  buffer should clear because the SSE stream re-targets. This
  works correctly today because `CatalogStreamService` reopens
  the EventSource on tenant change, but the buffer carries
  over. Document; fix in C6.4.

---

## Implementation summary

- `platform/agentic-ops-console/src/app/pages/activity.component.ts`
  — single-file component. Subscribes to `CatalogStreamService`,
  ring buffer at 200, computed `visible` signal applies filters.
- `app.routes.ts` — `/activity` lazy route.
- `shell.component.ts` — sidebar nav entry.
- 9 new tests (`activity.component.spec.ts`) using a
  `StubStreamService` that exposes a `fire(event)` helper for
  test-time event injection.

Total ops-console: 59/59. Catalog 164 + lib 408 + mvk-cli 49
unchanged. Platform: 680/680.
