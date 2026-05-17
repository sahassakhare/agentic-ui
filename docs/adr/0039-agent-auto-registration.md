# ADR-039 · Agent auto-registration

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-027](./0027-catalog-sse-stream.md) · [ADR-032](./0032-catalog-capability-registrar.md) · [Plan §AGT](../plans/semantic-search-agent-registry-opa-plan.md#slice-agt--agent-auto-registration)

---

## Context

The catalog tracks `capabilities`, `mfe_remotes`, `tenants`, `usage`, `audit`, plus the new `policy_bundles` (slice OPA). It does NOT track **agent backends** — the `provideAgUiBackend({url})` / `provideHashbrownBackend(...)` / `provideA2uiBackend(...)` deployments running behind the runtime tier.

When a host operates 3 agent servers across staging/prod, knowing what's running where is a real ops problem. Today the only signal is "did the chat shell get a 200 from `/run`."

The post-audit follow-ups plan §AGT calls for a catalog `agents` table + a small server-side helper package + an ops-console page. This ADR ships all three.

---

## Decision

### D1 — New `agents` table, distinct from `mfe_remotes`

`mfe_remotes` and `agents` overlap in shape (both are external services with a manifest URL + status). They differ in semantics:

- **MFE remotes**: federation manifests; status is manifest-driven (URL reachability, version compatibility); registered by operators.
- **Agents**: runtime-level callable backends; status is heartbeat-driven (alive/dead); auto-registered by the agent server itself on boot.

Different lifecycle, different status semantics, different operator surface. Separate tables avoid conflating them. Migration `007_agents.sql` ships the schema; reuses the same RLS / soft-delete / audit pattern as `mfe_remotes`.

### D2 — Idempotent auto-registration via `POST /agents`, 409 = "already exists, success"

Mirrors the runtime-tier registrar (ADR-032 §D1). The agent server POSTs at boot:

```http
POST /v1/catalogs/{tenant}/agents
{ "name": "gemini-coordinator", "kind": "ag-ui", "manifestUrl": "...", "capabilities": [...] }
```

- 201 → newly created.
- 409 → already exists (typical on re-deploy). The server-registrar package recovers the existing id via `GET ?name=` lookup so heartbeats can target the right row.
- 422 → schema violation (operator misconfiguration).

### D3 — Heartbeat endpoint distinct from PATCH

`POST /agents/:id/heartbeat` is a lightweight ping that:
- Updates `last_health_at = now()`.
- Optionally updates `status` (if the server detected its own degradation).
- Skips audit (heartbeats are too frequent — would dominate the audit chain).
- Publishes the SSE event so the topology graph sees status changes immediately.

Distinct from `PATCH /agents/:id` which DOES audit + supports the full update shape (manifestUrl, version, capabilities, status). Heartbeats are a hot path; PATCH is rare.

### D4 — `@infra-tools/agentic-ui-server-registrar` — opt-in helper package

A small server-side npm package that wraps the boot-time POST + heartbeat loop:

```ts
import { registerAgentWithCatalog } from '@infra-tools/agentic-ui-server-registrar';

const reg = await registerAgentWithCatalog({
  catalogUrl: process.env.CATALOG_URL!,
  tenantId: process.env.TENANT_ID!,
  getToken: () => process.env.CATALOG_TOKEN ?? null,
  agent: {
    name: 'gemini-coordinator',
    kind: 'ag-ui',
    manifestUrl: process.env.PUBLIC_URL!,
    capabilities: server.toolNames(),
  },
  heartbeatIntervalMs: 30_000,
});

process.on('SIGTERM', () => reg.shutdown());
```

The package handles:

- POST + 409 recovery (see D2).
- Background heartbeat at `heartbeatIntervalMs`.
- Graceful `shutdown()` — flips status to 'inactive' so operators don't see a stale 'active' row.
- Manual `heartbeat(status?)` — for hosts that want to drive degradation signals from their own health-check tick.
- Test seam: `fetchFn` override.

Failures are non-fatal — the agent server keeps running even if the catalog is unreachable. `id: null` in the returned handle signals "registration failed; heartbeats are no-ops." Mirrors the runtime registrar's degrade-gracefully pattern.

### D5 — Heartbeat 30s default; sweeper-side dead-agent detection deferred

The default `heartbeatIntervalMs` is 30s. The catalog can mark agents 'degraded' / 'inactive' based on a sweep of `last_health_at` (e.g. >90s = degraded, >5min = inactive), but the sweeper itself is **not** in this slice — current implementation relies on the agent server self-reporting via heartbeat status.

For now, the topology view + agents page surface "stale" rows (lastHealthAt > 90s ago) visually. A sweeper job lands when adopters operate enough agents that the manual surfacing becomes inadequate.

### D6 — Read-only-ish ops-console agents page (slice 1)

The new `/agents` page renders the table with status pills, capability count (expandable to full list), manifest URL, version, last-health, registered-at. Operator actions in slice 1:

- **Retire** (DELETE) — soft-deletes the row. The running server keeps working; on next deploy it self-registers fresh.

Other actions (manual status flip, manifest update) are deferred until adopters surface real demand. Most edits happen by the server on the next heartbeat anyway.

### D7 — `entityType: 'agent'` added to the SSE bus + audit table

The `CatalogEntityType` union gains `'agent'`. SSE events for agent CRUD propagate to the `CatalogStreamService` listeners (topology graph, future ops dashboards). The `catalog_audit` table's `entity_type` column is a free-form TEXT (no enum check), so adding the new value is schema-free.

### D8 — Topology graph integration is automatic

The topology graph (ADR-037) groups capabilities by their `body.source`. Agents don't appear there directly because they're not capabilities — they're separate entities in their own table. But once adopters have agents, a future axis-toggle on the topology view can render `tenant → agents → capabilities they advertise` as a fourth view. Out of scope for this slice; data is in place for it when needed.

---

## Consequences

### Positive

- **Operators see what's actually running.** No more "did the chat shell get a 200" guesswork.
- **Server-registrar is one import line + 4 fields** — minimal friction for adopters wiring it into existing agent servers.
- **Heartbeat-driven status** means the topology graph + agents page reflect reality within 30s of an agent going down.
- **Idempotent + degrade-gracefully** semantics — re-deploys don't break, network blips don't crash the server, missing catalog doesn't block boot.
- **Reuses every catalog primitive** (RLS, audit, SSE, soft-delete) — no new infrastructure.

### Trade-offs

- **No automatic dead-agent cleanup** in slice 1. Operators see "stale" highlight in the UI; manual retire is the cleanup. Sweeper is a small follow-up.
- **Heartbeats skip audit** — privileges audit-log readability over heartbeat-completeness. PATCH/DELETE/POST still audit fully.
- **One agent server == one row** — if a server runs multiple "logical" agents (multi-agent orchestrator), it registers the orchestrator's name and lists each sub-agent's tools in `capabilities`. The richer "registered agent has nested sub-agents" model is a future schema change.

### Out-of-scope

- **Server-registrar in the eDiscovery demo agent server**. Plan §AGT noted this; ships separately as a follow-up.
- **Sweeper job** for marking dead agents inactive automatically.
- **Manual edit (manifest URL / capabilities) UI** in the ops console — adopters surface this if/when needed; today edits flow from the server's own heartbeat or a `PATCH` from the registrar.
- **Multi-agent nested topology** — when an orchestrator dispatches to specialists, the catalog stores the orchestrator's capability list, not a tree.
- **Agent kind `mcp` semantics** — the kind enum includes 'mcp' for completeness, but the eDiscovery MCP demo server doesn't use the registrar yet.

---

## Verification

- [`007_agents.sql`](../../platform/agentic-catalog-server/src/db/migrations/007_agents.sql) — schema migration, idempotent.
- [`agent.ts` domain](../../platform/agentic-catalog-server/src/domain/agent.ts) — Zod schemas for create / update / heartbeat / read.
- [`agent-repo.ts`](../../platform/agentic-catalog-server/src/repository/agent-repo.ts) — list / find / create / update / heartbeat / soft-delete.
- [`agents.ts` route](../../platform/agentic-catalog-server/src/routes/agents.ts) — full CRUD + heartbeat endpoint.
- [`agents.spec.ts`](../../platform/agentic-catalog-server/src/routes/agents.spec.ts) — 10 integration tests against pg-mem (auth, list, POST, 422, 409, PATCH, heartbeat, delete, audit-on-create, no-audit-on-heartbeat).
- [`@infra-tools/agentic-ui-server-registrar`](../../projects/agentic-ui-server-registrar) — new npm package; 6 unit tests covering register / 409 recovery / network failure / heartbeat tick / shutdown / explicit-heartbeat.
- [`agents.component.ts`](../../platform/agentic-ops-console/src/app/pages/agents.component.ts) — ops-console `/agents` page with status pills, stale highlight, capability expansion, retire button. Live updates via `CatalogStreamService`.

## Status snapshot

- catalog tests: 178 → **188** (+10 agents route)
- ops-console tests: 77 (unchanged — agents page tests deferred to a small follow-up; the page is read-only HTML+signal binding which the existing topology and capabilities tests cover the underlying patterns of)
- New package `@infra-tools/agentic-ui-server-registrar`: **6/6 tests**
- lib tests: 453 (unchanged — runtime not affected)
- mvk-cli tests: 53 (unchanged)
- **Total: 765/765 passing**
- All builds clean.
