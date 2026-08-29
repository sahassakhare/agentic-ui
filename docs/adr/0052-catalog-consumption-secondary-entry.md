# ADR-0052: Catalog consumption as a secondary entry point

**Status:** Accepted · **Amends:** [ADR-0005 (single primary entry)](0005-single-primary-entry.md)

## Context

Experience Studio authors governed capabilities (forms, tools, experiences,
pages, applications, …) that the catalog service persists per tenant. Consuming
them at runtime — GET each `?kind=X`, compile the `body` into a `*Def`, register
it, and re-hydrate live over SSE — was implemented only inside the Experience Hub
app (`platform/agentic-experience-runtime/src/app/catalog/`), coupled to that
app's `environment.*` and `AuthService`. Any other app wanting Studio-driven
content had to copy those files.

We want any app (new or existing) to enable Studio consumption via one library
provider, `provideCatalogRuntime(config, { mode })`, upgradable over npm.

The blocker is size. The library's **primary** FESM is capped at **896 KB** in CI
with ~30 KB headroom. The consumption code is ~57 KB (registries mode) and grows
with the shell-mode render hosts — it would blow the primary cap even though it is
tree-shakeable (CI measures total FESM bytes, not per-app tree-shaken size).

## Decision

Ship all catalog-consumption code in a **new secondary entry point
`@infra-tools/agentic-ui/catalog`** (`projects/agentic-ui/catalog/`), measured
under its own CI budget (128 KB). The primary FESM stays byte-for-byte unchanged.

## Why this does not violate ADR-0005

ADR-0005 collapsed secondary entries for one reason: Native Federation must share
the registry/component **classes** as a singleton across host + remotes, and
per-entry chunks broke that sharing. That reasoning does not apply here:

- Catalog consumption is **host-app level** — imported by a host's
  `app.config.ts`, **never by a federated remote**. It is not a shared singleton.
- It *writes into* the registries, but reaches them through the **primary**
  specifier `@infra-tools/agentic-ui`, which remains the single shared chunk. In a
  federated host the secondary is bundled into the host's own build; its
  `import { ToolRegistry } from '@infra-tools/agentic-ui'` still resolves to the
  shared primary. The ADR-0005 failure mode cannot recur.

**Constraint:** federated **remotes** must not import
`@infra-tools/agentic-ui/catalog` (see `docs/federate-an-mfe.md`). Only hosts do.

**Native Federation hosts** must map the subpath into their import map so it
resolves at runtime — add it to `shared` in `federation.config.js` as
**non-singleton** (it is host-local, not a cross-remote shared class), e.g.:
```js
'@infra-tools/agentic-ui/catalog': { singleton: false, strictVersion: false, requiredVersion: 'auto' }
```
(`skip` does not work here — Native Federation still externalizes the bare
specifier but then leaves it out of the import map, so it fails to resolve.) Its
internal imports of the primary `@infra-tools/agentic-ui` still resolve to the
shared singleton. Non-federated apps consume it as an ordinary ng-packagr entry.

## Consequences

- `provideCatalogRuntime` + the 13 sources + pure compilers live in
  `projects/agentic-ui/catalog/`; consumers `import … from '@infra-tools/agentic-ui/catalog'`.
- New CI guard on `dist/agentic-ui/fesm2022/infra-tools-agentic-ui-catalog.mjs`
  (128 KB); the primary 896 KB guard is untouched.
- The `connect-studio` schematic becomes a thin wrapper that wires the provider
  (no more app-local bridge templates).

## Rejected alternatives

- **Raise the primary cap** — adds ~60–80 KB to the primary and erodes a
  guardrail everyone else pays attention to.
- **Split compilers into primary, hosts into secondary** — two budgets and an
  awkward seam (sources import the compilers) for no real benefit.
