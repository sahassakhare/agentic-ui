# Catalog backend consolidation — plan

Status: **proposal, awaiting a decision** (which backend is canonical). Authored
2026-09-13 from the platform review (`docs/plans/` + the artifact assessment).

## What this plan covers

The repo ships **two** catalog control-plane implementations of the same
contract, and that duplication is the platform's single biggest source of latent
drift — the recent `kind`-on-SSE-events change had to be written **twice**
(commits `83f7053` Node, `a9ff828` Java). This plan states the current split,
frames the canonical-backend decision with a recommendation, and sequences the
migration + test strategy. It does **not** delete anything yet — the choice of
which backend survives is the user's.

## Current state

| | **Node** `platform/agentic-catalog-server` | **Java** `platform/agentic-catalog-service` |
|---|---|---|
| Package | `@infra-tools/agentic-catalog-server` — **published to npm** (`0.1.1`), `main: dist/server.js` | not published; a deployable Spring Boot app |
| Runtime | Hono + `pg` + RLS; SSE via a bus | Spring Boot + JPA/H2·Postgres; SSE via `SseEmitter` |
| Routes/controllers | capabilities, experiences (+publish), policy, embed, stream, health, **agents, audit, mfes, role-mappings, tenants, usage, openapi** | capability, experience, policy, embed, stream, health |
| Tests | **32 specs** | **0 tests** |
| Used by the running Studio + Hub? | **No** | **Yes** — both point `catalogBaseUrl` at `:8081` |

The paradox: the implementation the apps actually run (Java) is the **less
complete, untested** one; the more complete, tested, and distributed one (Node)
is not what runs. The Java README itself notes "there are two catalog backends"
and that Java is the one Studio/Hub use.

## The decision

**Recommendation: make the Node `agentic-catalog-server` canonical; retire the
Java service to an optional/archived JVM deployment.**

Rationale:
- Node is a **superset** of the routes Studio/Hub need, plus the ones they'll
  grow into (agents, audit, mfes, role-mappings, tenants, usage).
- It already has **32 tests** vs 0 — consolidating onto it *also* closes the
  "running backend is untested" risk in one move.
- It's the **published artifact** self-hosters get, and it's the **same
  language** as the rest of the repo (TS/Angular) — one toolchain, one CI path,
  shared types.
- The recent divergence proves the cost of keeping both; every future
  control-plane change otherwise pays the double-write tax.

Keep Java only if there's a hard external constraint (a JVM-only deployment
target, or a Spring/JPA integration the Node stack can't meet). If so, invert
the plan: make Java canonical, port the 6 missing route groups from Node, and
add its test suite — a strictly larger effort.

## Migration slices (if Node is canonical)

**C1 — Parity audit + gap close.** Diff the two on the endpoints Studio/Hub use
(capabilities, experiences, policy, embed, stream, health): request/response
shapes, the SSE event payload (now incl. `kind`), governance semantics
(approval transitions, `If-Match`/412), RLS/tenant scoping. Fill any Node gap so
it is a behavioral superset. *Acceptance:* a contract test suite both would pass.

**C2 — Repoint the apps.** Start the Node server on `:8081` (or repoint
`catalogBaseUrl`), run the full Studio + Hub E2E against it (login, author,
publish→Hub render, the app-lens, federated components). *Acceptance:* the
existing headless E2Es pass unchanged.

**C3 — Data + seed parity.** Ensure the Node server seeds/holds the same tenant
data (ediscovery-matters, acme-workspace, the demo capabilities) via its
migrations/seed so the demos are identical. Fold the Java `db-setup`/seed intent
into the Node `migrate`/seed path.

**C4 — Retire Java.** Move `agentic-catalog-service` behind an
`optional/` or `deploy/jvm/` marker (or delete), drop it from local-dev docs and
the `two-catalog-backends` guidance, and update ADR-015/0051 + the memory. Keep
the Dockerfile/Helm only if a JVM target is still supported.

**C5 — One publish + guard path.** `agentic-catalog-server` is already in
`publish.yml` + the version guard; confirm it's the only catalog in the release
matrix and RELEASING.md.

## Test strategy (the risk this also fixes)

Consolidation is the moment to add the contract suite the running backend has
always lacked: governance transitions, optimistic-concurrency conflicts, the SSE
`kind` contract, RLS tenant isolation, and a publish→stream→re-hydrate round
trip. Node's existing 32 specs are the seed; target the gaps C1 surfaces.

## Verification & rollback

- Each slice gated on the Studio + Hub E2E suite (13 Playwright specs) green
  against the Node backend.
- Rollback is a one-line env flip back to the Java `:8081` until C4 removes it —
  keep both runnable until C2+C3 pass in CI.

## Open questions for the decision

1. Is there a hard requirement for a **JVM/Spring** catalog deployment? If yes,
   Java stays canonical and this plan inverts (larger).
2. Does the Java service hold any **capability/governance behavior the Node one
   lacks** (embeddings, a specific RLS policy, an approval rule)? C1 confirms;
   flag any now.
3. Retire Java **entirely**, or keep it as an unmaintained/optional JVM target
   (Docker/Helm only, out of the default dev + release path)?

## Effort

C1–C3 are the bulk (parity audit + repoint + seed): ~1–2 focused iterations.
C4–C5 are cleanup. The payoff is permanent: one backend, one test surface, one
SSE contract, no double-write.
