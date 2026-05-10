# ADR-025 · eDiscovery demo seed — populate the catalog with the runtime tier's actual surface

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-015](./0015-catalog-server-design.md) · [ADR-021](./0021-self-managed-packaging.md) · [ADR-022](./0022-auth-disabled-mode.md)

---

## Context

A fresh catalog deployment has empty tables. The Render demo
([ADR-022](./0022-auth-disabled-mode.md)) lands operators on an ops
console with nothing to view — every page renders "no data". They
have to either curl their own seed in or click through every editor
to onboard a tenant + register capabilities one at a time.

Meanwhile, the runtime tier's eDiscovery example
(`examples/demo-ediscovery-{shell,review,production,search}`) **already**
defines a rich capability surface in code: ~17 tools, 14 components,
2 forms, 1 datasource, plus 4 personas across 3 federated MFE
remotes. None of that data flows into the catalog today — runtime
registrations stay in code; the catalog is a separate, empty system
of record.

This ADR adds an idempotent seeder that mirrors the eDiscovery
runtime surface into the catalog automatically on every deploy.

---

## Decision

### D1 — Seed mirrors what the runtime registers in code

`platform/agentic-catalog-server/src/scripts/seed-ediscovery.ts`
holds a static list of:

- **46 capabilities** — every tool, component, form, datasource the
  eDiscovery example registers across the shell + 3 remotes.
- **3 MFE remotes** pointing at the deployed Render hostnames
  (`ediscovery-{review,production,search}.onrender.com`).
- **4 role mappings** — `claim:role` → persona for the four eDiscovery
  personas (lead-counsel, associate, lit-support, paralegal).

The seed file is the source of truth for "what the eDiscovery example
offers per the catalog's view." The runtime code is the source of
truth for "what the eDiscovery example actually executes." These two
can drift; ADR-025 §D5 documents the trade-off.

### D2 — Idempotency keyed on natural identity, not on a "seeded" flag

Each seed function checks for the row by its natural unique key
before inserting:

- Tenant: `id`
- Capability: `(tenant_id, kind, name)` excluding soft-deleted
- MFE: `(tenant_id, name)`
- Role mapping: `(tenant_id, claim_path, claim_value)`

Re-running the seed is safe — already-present rows are skipped
silently. Operators who manually edit a row (e.g. change
`monthlyTokens` quota on the eDiscovery tenant) keep their edits;
the seed never overwrites.

This is the same shape as `node-pg-migrate up` — declarative, idempotent,
re-run-safe. No "did I already seed?" gate; just check what's there.

### D3 — Wired into Render's `preDeployCommand` after migrations

`platform/render.yaml` chains two commands in `preDeployCommand`:

```yaml
preDeployCommand: >-
  node node_modules/node-pg-migrate/bin/node-pg-migrate.js
  --migrations-dir src/db/migrations -j sql up &&
  node --enable-source-maps dist/scripts/seed-ediscovery.js
```

Migrations bring the schema up to date; seed populates the demo
data. Either step failing aborts the deploy. The `&&` short-circuit
means seed only runs after migrations succeed, which keeps schema-
mismatch errors clear (you'll see the migration failure, not a
seed-script crash on a missing column).

### D4 — Production deployments opt out by overriding the preDeployCommand

The Helm chart ([ADR-021](./0021-self-managed-packaging.md)) already
runs migrations as a Helm pre-install/pre-upgrade hook and **does
not** invoke the seed script. Production tenants come from the
operator's onboarding flow, not from a baked-in demo seed.

To run the seed manually against any catalog (production-shape
included), the operator runs:

```bash
DATABASE_URL=postgres://... npm run seed:ediscovery
```

This is documented in `platform/agentic-catalog-server/README.md`.
Idempotency means it's safe to run on a tenant that already has
overlapping rows — the seed only adds what's missing.

### D5 — Drift trade-off: hand-curated, kept in sync manually

The seed is a **hand-curated** list, not a programmatic extraction
from the eDiscovery example's TypeScript. Reasons:

- **Build-time extraction is significant work.** Tools register via
  `registry.register({...})` calls scattered across multiple files;
  walking AST + emitting JSON is a nontrivial build-step
  (~1–2 days).
- **Demo data, not production data.** When the eDiscovery example
  adds a tool, the seed file *should* be updated too — but if
  someone forgets, the catalog just shows the older surface
  until the next maintainer notices. That's an acceptable
  failure mode for demo-tier code.
- **Catalog isn't authoritative for the runtime today.** The
  eDiscovery shell registers tools in code regardless of what the
  catalog says. So drift between seed and code is cosmetic, not
  functional. (Closing that loop — making the runtime *consume*
  the catalog as the source of truth — is a separate, larger
  slice. See §Out of scope.)

If drift becomes a maintenance pain in practice, the next slice is
"emit a `capabilities.json` from each eDiscovery package's build" and
have the seed read those files. The seed structure is intentionally
simple enough that this swap is a localized change.

---

## Consequences

### Positive

- **Demo deployment shows real data.** Operators landing on the ops
  console pick `ediscovery` as the tenant id and immediately see
  46 capabilities, 3 federated MFEs, 4 role mappings, with a
  9+ row audit chain that grows on every interaction.
- **Render auto-deploy refreshes the seed.** Every push to `main`
  triggers `migrate up && seed:ediscovery`. Drift detection
  arrives at deploy time — if a capability is missing from the
  seed, anyone debugging the demo notices on the next deploy.
- **Idempotent + safe in production.** Operators can run
  `npm run seed:ediscovery` against their own catalog without
  fear of overwriting tenant data; rows are inserted only when
  absent.

### Negative / risks

- **Drift between seed and runtime.** Adding a tool to
  `examples/demo-ediscovery-shell/src/app/agentic/agentic.ts`
  doesn't automatically update the seed. The convention is to
  edit the seed in the same PR; reviewers should flag if missing.
- **Seed size grows with the example.** Each new capability =
  ~3 lines in the seed file. Acceptable for v0.1 (~50 capabilities
  total); if it grows to hundreds we'll move to file-emitted
  manifests.
- **`onboardedBy` shows `seed-ediscovery@auto-seed`.** Compliance
  reviewers will see this in the audit chain and know the rows
  came from a seed, not a real operator action. That's
  intentional + auditable.

### Out of scope (deferred)

- **Runtime → catalog handshake.** Today the eDiscovery shell
  registers tools in code; the catalog mirrors them via this seed.
  The proper architecture has the runtime *read* its capability
  list *from* the catalog at boot — that's substantial work
  ([ADR-002](./0002-layered-registry-system.md)
  registry-driven runtime) and out of this slice.
- **Auto-extraction from TS source.** Walking the TypeScript AST
  to emit `capabilities.json` from each runtime package's build.
  Useful when the seed list grows past ~100 entries; not yet.
- **Per-tenant template seeds.** "Seed me a generic SaaS tenant"
  / "seed me a healthcare tenant" templates. Probably never;
  one demo seed is enough for the platform demo.
- **Seed hash in `/healthz`.** Echo the seed file's git hash on
  the healthz endpoint so monitoring can spot version skew across
  multi-replica deployments. Defer until needed.

---

## Implementation summary

- `platform/agentic-catalog-server/src/scripts/seed-ediscovery.ts` —
  the seed script. Reads `DATABASE_URL` from `loadConfig`; opens a
  pg.Pool; for each entity, checks existence then inserts.
- `platform/agentic-catalog-server/package.json` — adds
  `npm run seed:ediscovery` script (runs the compiled JS).
- `platform/render.yaml` — `preDeployCommand` now chains migrations
  + seed via `&&` so seed runs after migrations succeed.
- `tsconfig.json` already includes `src/**/*.ts`, so the script
  compiles to `dist/scripts/seed-ediscovery.js` automatically as
  part of `npm run build`.
- Idempotency tested end-to-end against the deployed Render catalog
  by running the seed twice — second run reports "X already
  present" for every entity.

---

## Update — 2026-05-10 (post-audit migration)

The [2026-05-10 platform audit](../audit/2026-05-10-platform-audit.md)
flagged the seed script's drift surface as **Gap 1**: every new tool
or widget added to the eDiscovery shell required a parallel edit to
`seed-ediscovery.ts` and a redeploy, or the catalog's view of the
tenant fell out of date. [ADR-032](./0032-catalog-capability-registrar.md)
shipped the runtime-side `provideCatalogCapabilityRegistrar` that
auto-POSTs registered tools/widgets at boot, eliminating the drift
surface for hosts that wire it.

The eDiscovery shell now wires `provideAgenticPlatform` conditionally
(see [`examples/demo-ediscovery-shell/src/app/app.config.ts`](../../examples/demo-ediscovery-shell/src/app/app.config.ts)):

- **Local dev** (`environment.catalogUrl: undefined`) — fully
  embedded; no catalog round trips. Every existing flow keeps
  working unchanged.
- **Render prod** (`environment.catalogUrl: https://agentic-catalog-server.onrender.com`) —
  on boot, every tool / widget the shell registers POSTs to the
  catalog (idempotent via `(tenant_id, kind, name)`). The
  capability authorizer polls `?lifecycle=disabled` every 30s; an
  operator who toggles `releaseLegalHold` to `disabled` in the ops
  console sees the running shell stop offering the tool within
  one tick.

Two ordering changes were required to make the boot-time registrar
work:

1. `bootAgenticCapabilities()` — the host's tool/form/data-source
   registration — moved from `provideAppInitializer` (runs during
   the `APP_INITIALIZER` phase) to `provideEnvironmentInitializer`
   (runs at injector creation, synchronously). The registrar is
   itself an environment initializer; both run in provider-array
   order, so tools must register first.
2. `installPersonaScopePolicy()` — same conversion. Runs **before**
   `provideAgenticPlatform({...})` in the array so the catalog
   authorizer composes onto the persona policy via
   `RegistryBase.currentScopePolicy()` (ADR-033 §D5), instead of
   overwriting it.

`loadDemoRemotes()` stays in `provideAppInitializer` because it's
async (Native Federation `loadRemoteModule` returns a Promise).
**Late-arriving registrations from MFE remotes therefore don't
flow through the registrar** — they land in the registry but the
registrar's snapshot already fired. ADR-032 §D6 documents this
limitation; the seed script continues to cover federated-remote
capabilities.

Three switches on `provideAgenticPlatform` are deliberately **NOT**
enabled for the eDiscovery shell yet:

- **`personaResolver`** — the shell's `PersonaService` is a UI
  dropdown driving demo persona switching, not a JWT-derived
  identity. Production hosts will swap to `personaResolver`; demos
  keep the dropdown.
- **`mfeRegistry`** — the shell continues to read MFE manifests
  from the static JSON file (`/mfes.json`). Migrating to the
  catalog-driven `RestMfeRegistrySource` is a separate slice
  because it touches the federation runtime's discovery contract,
  not just the host's config surface.
- **`usageMetering`** — would replace `AGENTIC_TELEMETRY_SINK`
  with the wrapping sink, displacing the shell's existing
  console / OTel sink. Opt-in once a host is ready to fold it in
  via the `delegate` field.

### Future of `seed-ediscovery.ts`

The seed script remains the **bootstrap** path for first-deploy
state (so a fresh ops console doesn't render empty for the
~30 seconds before a shell instance boots and self-registers).
Once the Render `ediscovery-shell` deploy reliably self-registers,
the script can be reduced to **only** seed entities the runtime
shell can't auto-register: federated-remote tools (covered by the
remote's own bootstrap, not the host's), the tenant + role
mappings (catalog admin work, not runtime work).

For now both mechanisms run; they're idempotent and the registrar's
409-as-success contract means double-population is a no-op.
