# ADR-040 · OPA policy integration (catalog PDP + runtime authorizer plugin)

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-010](./0010-platform-principles-and-license.md) · [ADR-033](./0033-catalog-capability-authorizer.md) · [Plan §OPA](../plans/semantic-search-agent-registry-opa-plan.md#slice-opa--opa-policy-integration)

---

## Context

[ADR-033](./0033-catalog-capability-authorizer.md) shipped a binary capability gate — operators flip `lifecycle: 'disabled'` and the runtime hides the entry. That's enough for "stop offering this tool"; it's not enough for fine-grained governance:

- "Tool `releaseLegalHold` requires persona = `lead-counsel` AND business-hours AND tenant tier ≥ enterprise."
- "Component `flightCard` is hidden from personas with `vendor.untrusted=true` claim."
- "Tool `runTARClassifier` requires approval from a different persona than the requester."

These are policy decisions. The post-audit follow-ups plan §OPA called for OPA (Open Policy Agent) integration as the standard policy-decision-point answer.

ADR-010 §D4 explicitly says: *"no Temporal/NATS/OPA/OpenSearch in the runtime."* This ADR honors that — OPA support ships in two pieces, **both outside the core lib**:

- **OPA-A**: catalog server side. New `policy_bundles` table for rego storage; new `/policy/decide` endpoint that forwards to an OPA sidecar.
- **OPA-B**: optional runtime plugin package `@infra-tools/agentic-ui-opa-authorizer`. Adopters install only if they want OPA.

---

## Decision

### D1 — OPA runs as a sidecar; catalog forwards decision calls

We don't bundle the OPA Go binary into the catalog server. Adopters run OPA as a sidecar (Docker compose service / Kubernetes sidecar container) and configure `OPA_URL` (e.g. `http://opa:8181`).

The catalog forwards `POST /v1/data/{rule_path}` calls with the input envelope; OPA returns `{result: <rule output>}`; catalog interprets and returns to the runtime client.

Rationale:
- **OPA versioning is external.** We don't track OPA major versions in our `package.json`. Adopters pick the OPA version their Rego targets.
- **Cleaner separation.** Catalog stays a Node service; OPA stays a Go service. Each does one thing well.
- **Multi-language flexibility.** Operators who want Cedar / OpenFGA instead of OPA can swap the sidecar without changing the catalog code.

### D2 — `policy_bundles` table with `is_active` partial unique index

Schema:

```sql
CREATE TABLE policy_bundles (
  id            UUID PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  rego_source   TEXT NOT NULL,
  description   TEXT,
  rule_path     TEXT NOT NULL DEFAULT 'maverick/allow',
  is_active     BOOLEAN NOT NULL DEFAULT false,
  ...
);
CREATE UNIQUE INDEX policy_bundles_one_active_per_tenant
  ON policy_bundles (tenant_id) WHERE is_active = true;
```

The partial unique index enforces "at most one active bundle per tenant." Activating a different bundle demotes the old one in the same transaction (the repo handles this).

`rule_path` is stored per-bundle so each bundle can target its own OPA rule (e.g. `maverick/capabilities/allow` vs. `authz/strict/decision`).

### D3 — `/policy/decide` returns 422 when OPA isn't configured (graceful degrade)

Same pattern as semantic search (ADR-038). `OPA_URL` env unset → `noopOpaClient` → `/policy/decide` returns `422 problem+json` with an actionable message. Bundle CRUD endpoints work regardless — adopters can stage rego while waiting on the sidecar deploy.

### D4 — Decision response normalises OPA's three result shapes

OPA rules can return:
- bare boolean (`allow := true`)
- `{ allow: bool, reason?: string, obligations?: ... }`
- arbitrary other shapes

The `interpretOpaResult()` helper maps all three to a stable `PolicyDecisionResponse` shape `{ allow: boolean, reason?, obligations?, raw? }`. Hosts always get an `allow` flag; non-standard shapes land in `raw` for debugging.

### D5 — Audit + SSE + RLS reuse existing patterns

`policy_bundle` joins `capability`, `mfe`, `agent`, etc. as a `CatalogEntityType`. Bundle CRUD writes audit rows + publishes SSE events. RLS isolates per-tenant.

Decision calls (`/policy/decide`) deliberately **do not** audit — high-frequency, privacy-sensitive (subject claims) — same reasoning as agent heartbeats (ADR-039 §D3).

### D6 — Runtime plugin: separate npm package, NOT in core lib

`@infra-tools/agentic-ui-opa-authorizer` is a sibling package, peer-deps `@infra-tools/agentic-ui` >=1.2 + `@angular/core` >=21. Adopters who don't want OPA never install it; ADR-010 D4 stays clean.

The plugin's `provideOpaAuthorizer({...})` returns its own `EnvironmentProviders`. Adopters wire it alongside (or instead of) `provideAgenticPlatform({ capabilityAuthorizer: ... })`:

```ts
provideAgenticPlatform({
  catalogUrl: '...',
  tenantId: '...',
  getToken: () => ...,
  capabilityAuthorizer: false,   // disable lifecycle deny-list
}),
provideOpaAuthorizer({
  catalogUrl: '...',
  tenantId: '...',
  getToken: () => ...,
  subject: () => ({ persona: persona.active() }),
  cacheTtlMs: 5_000,
  onMiss: 'allow',
  prefetchOnBoot: true,
}),
```

### D7 — Synchronous scope-policy + async decision cache

`RegistryScopePolicy` is `(entry) => boolean` — synchronous. OPA decisions are async HTTP calls. Reconciling: the plugin maintains a per-`(kind, name)` decision cache; the scope policy reads from the cache; cache misses return the configured `onMiss` default and fire a background fetch.

Implications:
- **First read after boot** sees the `onMiss` default (allow by default — degrades gracefully, refines on cache fill).
- **Subsequent reads** see the cached decision (allow or deny per OPA).
- **Cache TTL** (default 5s) refreshes decisions periodically.
- **`prefetchOnBoot: true`** populates the cache up-front for every registered tool/widget — eliminates the first-read default-allow window. Recommended for closed-allowlist deployments.

### D8 — Compose-with-existing-policy pattern (same as ADR-033 §D5)

The plugin's initializer reads each registry's `currentScopePolicy()`, then installs a wrapping policy that AND's:
1. The OPA decision (cached).
2. The previous policy (persona, catalog disabled-list, host-installed).

Order in providers array determines which inner policy gets composed. Hosts wanting OPA-only behaviour set `capabilityAuthorizer: false` upstream.

### D9 — Pure helper extracted to `compose.ts` for vitest testability

`composeWithOpaAuthorizer` lives in its own file with no Angular imports so it's testable via plain vitest (no zone.js, no TestBed). The full Angular-DI integration (`OpaAuthorizerService`, `provideOpaAuthorizer`) is exercised by:
1. The plugin's TypeScript build (catches public-API drift).
2. The lib's dist resolves cleanly (catches peer-dep drift).
3. Adopter integration tests when they wire the plugin into their own app.

A first-party Angular-test harness for the service is a follow-up; not blocking for the plugin shipping.

### D10 — Decision call shape: `{ subject, action, resource: { kind, name } }`

Standard OPA input envelope. `subject` is a per-call function output (typically active persona + tenant + JWT claims); `action` defaults to `'invoke'`; `resource` is auto-populated with the registry kind + entry name. Adopters write Rego against this shape:

```rego
package maverick.allow

default allow := false
allow := true {
  input.subject.persona == "lead-counsel"
  input.action == "invoke"
  input.resource.kind == "tool"
  input.resource.name == "releaseLegalHold"
}
```

---

## Consequences

### Positive

- **Real fine-grained governance.** Operators write Rego rules; runtime asks before exposing tools/widgets.
- **OPA stays out of the core.** ADR-010 D4 alignment preserved — plugin package is opt-in.
- **Catalog-stored bundles** (vs. file-system) means rego changes deploy via the existing API, ops console can show diffs, audit log captures every change.
- **At-most-one-active-bundle-per-tenant** invariant is DB-enforced (partial unique index) — operators can't accidentally activate two conflicting bundles.
- **Decision response normalisation** means callers always get an `allow` flag regardless of how operators write their rules.
- **Cache + onMiss/onError defaults** gracefully degrade when OPA is slow or unreachable.

### Trade-offs

- **OPA sidecar is a new infrastructure dep** for adopters. Documented; unavoidable for a real PDP.
- **Synchronous scope policy + async decisions** means first-read sees `onMiss` default. `prefetchOnBoot: true` works around it for closed-allowlist deployments.
- **Decision calls don't audit** — consistent with agent heartbeats but means OPA-side audit (its own decision log) is the trail. Adopters who want catalog-side OPA audit add it themselves.
- **Cache TTL trade-off** — too short = OPA call storm; too long = stale decisions. 5s default is a reasonable middle.
- **Plugin's Angular-DI tests deferred.** Pure-function tests cover composition; the service-class wiring is exercised in adopter apps.

### Out-of-scope

- **WASM mode.** The plan called out an opt-in WASM path (~150 KB bundle, sub-ms decisions, no network). Useful for high-decision-rate apps. Not in this slice; remote-mode is enough for slice 1.
- **Cedar / OpenFGA alternatives.** Plugin's authorizer interface is policy-engine-neutral — ship as alternative plugin packages if/when adopters ask.
- **In-browser Rego editor** for the ops console. Operators upload via API or `mvk policy publish` (CLI command not yet shipped). In-browser editor with syntax highlight + preview-decision is a future S-class slice.
- **Decision-log page in ops console.** Useful for debugging "why was this denied"; currently relies on OPA's own decision-log.

---

## Verification

### OPA-A — catalog server (3 files, 24 new tests)

- [`008_policy_bundles.sql`](../../platform/agentic-catalog-server/src/db/migrations/008_policy_bundles.sql) — schema + partial unique index.
- [`policy.ts` domain](../../platform/agentic-catalog-server/src/domain/policy.ts) — Zod schemas for create/update/decision-request/bundle.
- [`policy-repo.ts`](../../platform/agentic-catalog-server/src/repository/policy-repo.ts) — list/find/create/update/delete/findActive (one-active-per-tenant invariant enforced).
- [`opa-client.ts`](../../platform/agentic-catalog-server/src/policy/opa-client.ts) — sidecar HTTP client + result interpreter; 8 unit tests.
- [`policy.ts` route](../../platform/agentic-catalog-server/src/routes/policy.ts) — bundles CRUD + `/decide`.
- [`policy.spec.ts`](../../platform/agentic-catalog-server/src/routes/policy.spec.ts) — 8 integration tests.

### OPA-B — runtime plugin (new package)

- [`@infra-tools/agentic-ui-opa-authorizer`](../../projects/agentic-ui-opa-authorizer) — new sibling package.
- `OpaAuthorizerService` + `provideOpaAuthorizer` — full Angular-DI integration.
- `composeWithOpaAuthorizer` — pure function, 4 vitest tests.
- TypeScript build clean against the workspace's lib dist.

## Status snapshot

- catalog tests: 188 → **204** (+16: 8 OPA-client + 8 policy-route)
- new plugin package: **4/4 tests** passing
- lib tests: 453 (unchanged)
- ops-console tests: 77 (unchanged — UI for policy-bundle management is a follow-up)
- **Total: 781/781 passing**
- All builds clean.
