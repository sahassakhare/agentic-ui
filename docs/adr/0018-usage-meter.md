# ADR-018 · Usage meter — per-tenant consumption stream

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-010](./0010-platform-principles-and-license.md) · [ADR-015](./0015-catalog-server-design.md) · [ADR-017](./0017-audit-chain.md)

---

## Context

The v3 plan §7.1 places "basic cost meter" in M3 alongside the audit
chain extension. Real adopters care about three measurements:

1. **LLM token consumption** per tenant — they pay an LLM vendor for
   it; they want to bill the right BU.
2. **Tool / capability invocation rate** — anti-abuse and capacity
   planning.
3. **MFE manifest fetches** — federation-traffic visibility for the
   ops team.

The runtime tier emits this kind of telemetry today via OpenTelemetry,
but OTel goes to *whatever the operator's collector is* and is
intentionally not durable. For chargeback / showback / quota
enforcement, operators want a **catalog-side meter** they can query
without scraping Prometheus or paying for Datadog Custom Metrics.

This ADR codifies the M3 C5 usage meter.

---

## Decision

### D1 — One generic table; events not roll-ups

Single table `usage_events` with `(tenant_id, occurred_at, kind,
quantity, tags, idempotency_key)`. Hosts choose the `kind`
vocabulary (`'llm.tokens.input'`, `'tool.invoke'`, `'mfe.fetch'`, …);
the catalog stores them as-is.

We deliberately do *not* ship a fixed enum. Hosts will think of
domain-specific kinds we cannot predict (`'ediscovery.tar.run'`,
`'redaction.pages.processed'`); a fixed enum would either be too
narrow or accumulate a long-tail "other" category that defeats the
point.

We also deliberately do *not* ship pre-aggregated roll-ups
(`usage_hourly`, `usage_daily`). Roll-ups are easy to derive from
the event stream when needed (`SELECT date_trunc(...), kind,
SUM(quantity) FROM usage_events GROUP BY ...`); shipping them now
would commit us to a bucket cadence we'd outgrow. M5+ may add a
materialised view if profile data shows query latency mattering.

### D2 — Units, not currency

The catalog stores integer `quantity` per event. It does *not* store
or compute money. Reasons:

- **Pricing is per-deployment.** One operator pays $0.0025 per 1000
  GPT-4o input tokens; another pays $0.0015 because they have a
  Microsoft enterprise discount. Hard-coding rates in the catalog
  would force every operator to override.
- **Currency policy is host-domain.** Are we billing the BU at the
  same rate our vendor charges us, or at a marked-up internal rate?
  Do we round? Do we bill for failed invocations? These are
  decisions the host owns, not the platform.
- **Auditability.** Storing units only means the audit trail is
  unambiguous: "this user consumed 12 345 tokens." Cost figures
  that re-compute on every read can shift behind the operator's
  back when rates change; units do not.

The Ops Console (M2 C6) will have a per-host pricing config that
multiplies units by rates at query time for display. The
*persistent* fact is the unit count.

### D3 — Idempotent POSTs via `idempotencyKey`

Hosts retry POSTs after network blips; double-counted events are a
billing nightmare. The `idempotency_key` column is unique per tenant
(partial unique index, NULL allowed). Repeated POSTs with the same
key resolve to the original row. This matches Stripe's well-known
semantics — operators already understand it.

The implementation uses a SELECT-then-INSERT pair (rather than `ON
CONFLICT`) because pg-mem doesn't support partial-index conflict
targets in test. Real Postgres would handle either form correctly;
our implementation falls back to a re-read on race-induced
unique-violation, so the semantics are identical regardless of
which Postgres variant runs the code.

### D4 — Three endpoints

- **`POST /v1/catalogs/{tenant}/usage`** — append. Hosts call this
  hot-path; the response is the canonical row.
- **`GET /v1/catalogs/{tenant}/usage`** — aggregate over `?from`,
  `?to`, optional `?kind`. Returns
  `{from, to, byKind, totalEvents, totalQuantity}`.
- **`GET /v1/catalogs/{tenant}/usage/recent`** — recent N events
  for ops-console debugging (`?limit` 1–1000, default 100).

Multi-axis aggregation (e.g. by tag dimension) is deferred — hosts
that need it today should query the export-style row stream and
aggregate on their side. Common patterns will be added as new query
endpoints in M5+ once we see what hosts actually request.

### D5 — Per-tenant RLS + audit-style retention

Same RLS isolation as the rest of the catalog. The table is
*append-only by convention* — there is no DELETE primitive in the
domain layer. Hosts that need to redact specific events for GDPR
reasons should DELETE directly via SQL with platform-admin
privileges and document the redaction in the audit chain (ADR-017).

Retention is operator policy. The catalog does not auto-prune.
`pg_partman` or a nightly DELETE WHERE `occurred_at < ...` is the
expected pattern.

### D6 — Cost is **not** part of the chained audit log

Tempting to include usage events in the hash chain (ADR-017), but
they are emitted at much higher volume (100s/sec at peak vs. 1/sec
for catalog mutations), and chaining requires per-tenant `FOR
UPDATE` serialisation. Pricing chargeback is a *book-keeping*
concern, not a *governance* concern — adopters who need it
auditable run `SELECT SUM(quantity) FROM usage_events WHERE …`
periodically and snapshot the result into the audit chain
themselves. We don't pay the per-event chaining cost for every
tenant by default.

---

## Consequences

### Positive

- **Out-of-the-box chargeback.** Hosts gain a per-tenant consumption
  stream without standing up a separate metering service.
- **Domain-agnostic.** Generic `kind` field accepts every host's
  vocabulary; no schema changes when a new metric appears.
- **Idempotent.** Stripe-style idempotency keeps retry paths safe.
- **No pricing lock-in.** Operators decide currency policy.

### Negative / risks

- **Storage growth.** Even at modest event rates, tables grow
  quickly. Operators must either prune or partition. The README
  documents both patterns.
- **Tag explosion.** Hosts that put high-cardinality data in tags
  (e.g. user IDs) will fragment the aggregation. We cap at 32 tag
  keys but do not cap value cardinality. If this bites in
  production we'll add a per-tenant cardinality alarm.
- **No real-time roll-ups.** Aggregation queries scan the events
  table — fine up to ~tens of millions of rows per tenant, slow at
  hundreds of millions. Materialised views are deferred to M5+.

### Out of scope (deferred)

- **Quota enforcement.** "Tenant X has used 1.2M tokens; halt at
  1.5M." Trivial to bolt on top of the aggregate endpoint, but
  rate-limit semantics + operator escalation rules are too
  policy-heavy to bake in. Self-hosters wire it themselves; the
  hosted offering will add it as a soft-cap UI in M5+.
- **Multi-axis aggregation.** Roll up by tag dimension as well as
  kind. Deferred until concrete demand.
- **Streaming SSE for live consumption views.** Same SSE work that
  ADR-015 deferred to v0.2 of the catalog server applies here.

---

## Implementation summary

- Migration: `platform/agentic-catalog-server/src/db/migrations/004_usage_meter.sql`
- Domain: `platform/agentic-catalog-server/src/domain/usage.ts`
- Repository: `platform/agentic-catalog-server/src/repository/usage-repo.ts`
  — `appendUsage` (idempotent), `aggregateUsage`, `listRecentUsage`
- Routes: `platform/agentic-catalog-server/src/routes/usage.ts`
  — `POST /usage`, `GET /usage`, `GET /usage/recent`
- Tests:
  - 7 repository unit tests
  - 10 routes integration tests
- 12-factor configuration: no new env vars (the meter is always on
  when the catalog is running; hosts that don't post events get an
  empty table).
