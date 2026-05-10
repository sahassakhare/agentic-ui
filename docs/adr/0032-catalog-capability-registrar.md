# ADR-032 · provideCatalogCapabilityRegistrar — auto-register runtime capabilities to the catalog

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-011](./0011-registry-provider-hook.md) · [ADR-014](./0014-host-version-compatibility.md) · [ADR-025](./0025-ediscovery-demo-seed.md) · [ADR-031](./0031-provide-agentic-platform.md) · [Platform audit 2026-05-10](../audit/2026-05-10-platform-audit.md#gap-1--capability-registration)

---

## Context

The 2026-05-10 platform audit identified **Gap 1 — Capability registration**:

> Tools/widgets/forms register in code via `provideAgenticUi({ tools, widgets, forms })`. The catalog has zero knowledge of what the runtime exposes. The eDiscovery seed ([ADR-025](./0025-ediscovery-demo-seed.md)) papers this over with a hand-curated mirror — explicitly drift-prone.

Industry comparable: Backstage, Cortex, Port — all auto-register entities from running services on boot. AWS Service Catalog auto-discovers from Lambda / ECS metadata. **Code declares; platform observes.**

Without this seam, every consumer-app team that wants their capabilities visible in the ops console (or selectable by an authorizer in Gap 3, or metered in Gap 2) has to maintain a parallel hand-curated catalog seed. ADR-025's drift problem replicates per consumer app.

---

## Decision

### D1 — Boot-time POST per registry entry, with idempotent semantics

`provideCatalogCapabilityRegistrar({ catalogUrl, tenantId, getToken })` is an `EnvironmentProviders` that registers a `provideEnvironmentInitializer` callback. On Angular bootstrap, the callback walks `ToolRegistry.listRaw()` and `ComponentRegistry.listRaw()`, and for each entry POSTs to `POST /v1/catalogs/{tenant}/capabilities`.

Idempotency comes from the catalog's existing `(tenant_id, kind, name)` UNIQUE constraint. The registrar treats:

- **201** → newly created; record as `created`.
- **409** → already exists; record as `exists` (success).
- **anything else** → record as `failed`.

This keeps repeated boots cheap (catalog returns 409 fast), and once-only registration only happens on first boot (or first boot after a catalog re-deploy).

### D2 — Fire-and-forget; bootstrap never blocks

The initializer captures the `sync()` promise on `CatalogCapabilityRegistrarService.lastSync` but does **not** await it inside the initializer body. An unreachable catalog server must not prevent the consumer app from rendering — the runtime tier's contract has always been "platform integration is opt-in and degrades gracefully."

Tests + devtools that need to inspect sync results await `svc.lastSync` directly.

### D3 — Server-side: pre-check duplicate to surface 409 (not 500)

Before this slice, the catalog `POST capabilities` route did **not** pre-check for the unique constraint — it let the postgres `23505` error propagate as an unhandled 500. That's wrong for any idempotent client (registrar, replay scripts, infra-as-code).

We add a `findCapabilityByName(client, kind, name)` pre-check that throws `HTTPException(409, ...)` on existing rows. Mirrors the existing pattern in `tenants.ts:118-126`. The unique-violation path in `createCapability` remains as a safety net for racy concurrent inserts (rare in practice; the post-check is a SHOULD not a MUST).

### D4 — Source filtering: host-only by default

The runtime tier supports federated MFE remotes that contribute their own tools/widgets at load time (ADR-003 / ADR-006). Two reasonable mental models:

1. **Host owns the catalog identity** → register everything, including `source: 'remote:*'` entries.
2. **Remotes own their catalog identity** → only register `source: 'host'` entries; remotes self-register through their own startup path.

We default to (2) (`includeRemotes: false`) because:

- Remote tools may have a different ownership / lifecycle than host tools.
- A host that registers a remote's tools effectively claims them — surprising for federated teams.
- A remote that wants self-registration can call `provideCatalogCapabilityRegistrar` from its own bootstrap.

Apps with monolith-style federation (one team, one catalog identity) opt in via `includeRemotes: true`.

### D5 — Mapping runtime def → catalog body

`CapabilityCreateSchema` accepts an opaque `body: Record<string, unknown>` jsonb plus first-class `kind`, `name`, `lifecycle`, `tags`, `owner`, `requiredHostVersion`. The mapping (`toRegistrarPayload`) preserves the structured fields and packs the runtime-specific bits (`description`, `dataSources`, `executeIn`, `longRunning`, `scopes`, `source`) into `body`.

Rationale for not extending `CapabilityCreateSchema`: the runtime's def shape is more detailed than the catalog needs (Zod schemas don't round-trip; component class identities don't either — see ADR-011 §D5). The catalog stores enough metadata for ops-console search/filter and the future authorizer/usage Tiers; round-tripping the full handler is explicitly out-of-scope.

### D6 — Late-arriving registrations are NOT mirrored (yet)

If a remote MFE is loaded **after** bootstrap (the common case for lazy federation), its capabilities are registered *into the registry* but **not** posted to the catalog by this slice. ADR-011 §D5 explicitly disallows installing a `RegistryProviderHook` on tool/component registries (the tool handler / component constructor can't round-trip through external state, which the hook design assumed).

For this slice we accept the boot-snapshot limitation. Late-arrival sync is tracked as a follow-up; the design surface is either:

- Amend ADR-011 to allow write-only-mirror hooks on tool/component registries (the original "no replay-bound" reasoning doesn't apply to write-through mirrors).
- Have the remote call `CatalogCapabilityRegistrarService.sync(...)` from its own bootstrap.

The second option works today without amending ADR-011, and is the recommended path for federated apps that need catalog visibility for late-loaded remotes.

### D7 — Wired into provideAgenticPlatform as a per-feature switch

Following the ADR-031 pattern: `capabilityRegistrar?: CapabilityRegistrarFeatureOptions | false`. Apps that pass `{}` get sensible defaults; apps that pass `false` skip registration entirely; apps that omit the key skip by default (no surprise network calls when the consumer hasn't asked for them).

---

## Consequences

### Positive

- **Catalog stops drifting from runtime.** ADR-025's hand-curated seed becomes a starter; live apps replace it with their own truth on first boot.
- **Operators get real coverage.** The capabilities page in the ops console shows what apps actually expose, not what someone hand-typed.
- **Foundation for Gap 3.** The authorizer (next slice) reads from the catalog list; until the registrar populates it, the authorizer would reject everything.
- **Foundation for Gap 2.** Usage events reference capabilities by `(kind, name)` — only meaningful if those rows exist in the catalog.
- **First server-side conflict-aware POST.** Other write paths (tenants already does this) get a documented pattern to copy.

### Trade-offs

- **No live mirroring of late-registered remotes** (D6). Federated apps with lazy-loaded MFEs see drift between in-memory registry and catalog until the remote self-syncs. Documented as a known follow-up; the boot snapshot covers the host's own tools/widgets, which is the 80% case.
- **`body` jsonb is opaque to the catalog.** The catalog can't query "all tools with `executeIn: 'remote'`" without parsing the jsonb in SQL. Acceptable for now — the catalog API is search-by-tag/lifecycle, not by arbitrary nested fields.
- **No retry on transient failures.** A flaky network drops capabilities until the next boot. Mitigation: telemetry sink emits per-sync stats so operators can detect a rising failure rate. Retry with backoff is a follow-up.

### Out-of-scope

- **Removing capabilities** when an entry is unregistered at runtime. Runtime can call `DELETE /v1/catalogs/{tenant}/capabilities/{id}` directly if needed; we don't pretend the registrar is bidirectional.
- **PATCH on existing capabilities** when their description / scopes change between deploys. The current behaviour is "keep the first-registered version." Operators can manually PATCH from the ops console; auto-PATCH is a follow-up that needs a deliberate "what fields are app-authoritative vs operator-authoritative" decision.

---

## Verification

- **Server side**: `platform/agentic-catalog-server/src/routes/capabilities.spec.ts` — new `POST 409 on duplicate (kind, name)` test asserts the new pre-check returns 409 + Conflict problem+json.
- **Runtime side**: `projects/agentic-ui/src/lib/platform/provide-catalog-capability-registrar.spec.ts` — 9 tests covering payload mapping (3 `toRegistrarPayload` tests), boot-time POST happy path, 409 idempotency, server-failure handling, host-only filtering, AUTH_MODE-disabled (no Authorization header), empty registry safety.
- **Composite**: `projects/agentic-ui/src/lib/platform/provide-agentic-platform.spec.ts` — 2 new tests verifying the feature switch wires through the shared catalogUrl/tenantId/getToken and that `false` skips it.
- **End-to-end**: `mvk new app smoke --with-platform` (already shipping in ADR-031) generates a wired app; adding `capabilityRegistrar: {}` to the scaffold template happens in a follow-up commit (the scaffold currently provides MFE + persona by default; toggling the registrar on by default deserves its own decision).

## Status snapshot

- Catalog tests: 164 → 165 (+1)
- Lib tests: 414 → 425 (+11)
- mvk-cli tests: 53 (unchanged)
- ops-console tests: 59 (unchanged)
- **Total: 702/702 passing**
