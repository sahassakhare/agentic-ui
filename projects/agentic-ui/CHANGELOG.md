# Changelog

All notable changes to `@maverick/agentic-ui` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — first stable release

### Added
- Single primary entry exposing all public API. Tree-shaking is preserved via `"sideEffects": false`.
- **13 registries**, one uniform `Registry<TDef>` shape:
  - **Core**: `ToolRegistry`, `ComponentRegistry`, `CapabilityRegistry`, `BackendRegistry`, `MfeRegistryClient`.
  - **Extended**: `ActionRegistry`, `IntentRegistry`, `FormRegistry`, `DataSourceRegistry`.
  - **Seams**: `ValidationRegistry` (Zod default), `PersistenceRegistry` (memory + localStorage + sessionStorage), `LayoutRegistry`, `SchemaTransformerRegistry`.
- `AgenticBackend` abstraction with three concrete adapters: AG-UI (over `@ag-ui/client`'s SSE HttpAgent), Hashbrown (NDJSON), A2UI (with `ui-action` event class routed through `ActionRegistry`).
- `<mvk-chat-shell>` component with `injectAgenticChat()` controller built on Angular 21's `resource()` + signals; `<mvk-widget-container>` rendering by name via `*ngComponentOutlet`; `<mvk-form-renderer>` for schema-driven forms.
- MFE federation: `defineCapabilityModule({...})`, `loadRemoteCapabilities(...)` (Native Federation), `loadRemoteCapabilitiesMF(...)` (webpack Module Federation), `provideStaticJsonMfeRegistry`, `provideSpringBootMfeRegistry`.
- `mcpToolBridge({client})` to import MCP server tools into `ToolRegistry`.
- OpenTelemetry-backed `AgenticTelemetrySink` (`/otel` content via `provideAgenticTelemetry({kind: 'otel', providers})`) plus a zero-dep console fallback (`provideAgenticTelemetryConsole()`).
- 10 schematics: `ng-add`, `tool`, `widget`, `chat-shell`, `backend`, `agent-server`, `mfe-capability`, `action`, `intent`, `form`.
- Cross-backend conformance suite (`runConformance(backend)`) and `FakeAgenticBackend` for unit tests.
- **76 unit tests** across 12 spec files covering: registries CRUD + signal reactivity + MFE-aware teardown, run orchestrator (lifecycle / tool execution / generative-UI extraction), AG-UI converters + event mapper + observable-to-async-iterable adapter, static-JSON + Spring Boot MFE registry sources, defineCapabilityModule + apply, the cross-backend conformance suite against `FakeAgenticBackend`, and **schematic snapshot tests for all 10 generators** (ng-add, tool, widget, chat-shell, backend, agent-server, mfe-capability, action, intent, form).

### Architecture decisions
- [ADR-001](../../docs/adr/0001-agentic-backend-abstraction.md) — Pluggable backend abstraction.
- [ADR-002](../../docs/adr/0002-layered-registry-system.md) — Layered registry system.
- [ADR-003](../../docs/adr/0003-pluggable-mfe-registry-source.md) — Pluggable MFE registry source.
- [ADR-005](../../docs/adr/0005-single-primary-entry.md) — Single primary entry (no ng-packagr secondary entries).

### Compatibility
- Angular 21+
- Node 20.19+
- TypeScript 5.9+
- Zod 3.23+ (peer)
- RxJS 7.8.x (peer)

### Breaking changes from 0.x
- Secondary entry imports (`@maverick/agentic-ui/ag-ui`, `/hashbrown`, `/a2ui`, `/mfe`, `/mfe-module-federation`, `/otel`, `/testing`, `/components`) have been collapsed into the primary entry. Migration: `import { X } from '@maverick/agentic-ui/<sub>'` → `import { X } from '@maverick/agentic-ui'`.

### Known limitations
- `@angular-architects/native-federation` `includeSecondaries: true` does not emit per-secondary-entry chunks — this is *why* the lib is single-entry. Re-evaluate if/when fixed upstream.
- Webpack Module Federation runtime API is shipped (`loadRemoteCapabilitiesMF`) but the working-demo apps for that path are not in this release; the runtime API matches the Native Federation surface.
- A2UI adapter targets spec version `0.x`. Track the upstream spec for breaking changes.

## [Unreleased]

_Nothing yet._

## [1.1.0] — 2026-05-01

This minor release lands the **MCP server-side adapter**, **federation scaling primitives**, and **three registry-governance hooks** (`conflictPolicy`, `onDispose`, and the new `setScopePolicy`). All additions are opt-in and backward-compatible — existing 1.0.0 consumers see zero behaviour change without explicit provider changes.

The release is anchored by the **eDiscovery flagship reference application** (`examples/demo-ediscovery-*`) which exercises every feature listed below at enterprise load — 18 tools across 4 specialists, 3 federated MFE remotes plus an MCP server, all 13 registries, tamper-evident audit chain, persona-scoped tool surface.

### Added

#### MCP server-side adapter (companion package)

- **`ToolResultRenderHints` interface** — new type in `@maverick/agentic-ui` exposing the canonical render-hint shape: `components` (existing), `markdown`, `image_url`, **`html`** (active — MCP UI hosts iframe-render it), plus reserved `iframe_url` for a future patch. Purely additive — no breakage to any existing tool. See [ADR-006](../../docs/adr/0006-mcp-server-side-adapter.md).
- Companion package **`@maverick/agentic-ui-mcp`** ships separately, exposes any `ToolDef[]` as a Model Context Protocol server (Claude Desktop / Cursor / Zed / Continue / Windsurf). See its [CHANGELOG](../agentic-ui-mcp/CHANGELOG.md) and the [cookbook entry](../../docs/cookbook/mcp-server.md).

#### Federation scaling
- **`prefetchCapabilities({ remote, injector })`** — fetch a remote's `capabilities.json` over HTTP and register a metadata-only `CapabilityDef` with `CapabilityRegistry`, **without loading the federation bundle**. Lets the host build system prompts and run tool filters against tool/component names from 50+ remotes without paying multi-MB boot cost. URL is derived from `remoteEntry.json` by convention or set explicitly via `RemoteSpec.capabilityManifestUrl`.
- **`provideToolFilter(filter)` + `keywordToolFilter(config)` + `ToolFilter` type + `TOOL_FILTER` injection token** — narrow the tool list per turn before sending to the agent. Default is identity (no break). The reference `keywordToolFilter` scores tools by `name + description` overlap against the user's last message and returns the top-N. See [Federation at scale](../../docs/cookbook/federation-at-scale.md).

#### Registry governance
- **`ConflictPolicy` type + `RegistryBase.conflictPolicy` field** — strategy on duplicate-name registration. `'replace'` (default — backward-compatible), `'throw'` (fail-loud), `'first-wins'` (keep existing), `'namespace'` (auto-prefix new entry with its remote source). Set per-registry via `inject(ToolRegistry).conflictPolicy = 'throw'`.
- **`RegistryEntry.onDispose?`** — optional cleanup hook fired when an entry is removed (explicit disposer, `removeBySource()`, or replacement under `'replace'` policy). Errors caught and routed to telemetry — one bad hook can't poison a teardown sweep.
- **`RegistryEntry.scopes?: readonly string[]` + `RegistryBase.setScopePolicy(policy)`** — opaque governance tags per entry plus a hook that filters every `list()` / `get()` / `signal()` read. `permissiveScopePolicy` (default — every entry visible) and `activeScopePolicy(getActive)` (closes over a getter, checks `getActive()` against `entry.scopes`) ship as convenience exports. `getRaw` / `listRaw` bypass for tooling and `register()`'s collision detection. Filter on **read**, not register, so federated remotes contributing scope-tagged entries stay portable across users with different active scopes. See [ADR-008](../../docs/adr/0008-registry-scope-policy.md).
- New telemetry event names: `agentic.registry.dropped`, `agentic.registry.namespaced`, `agentic.registry.dispose_failed`, `agentic.registry.scope_policy_set`.

### Tests

- **76 → 93 tests** (+17). New tests cover all four conflict policies, the `onDispose` lifecycle (explicit disposer, `removeBySource` sweep, replacement-fires-displaced-disposer, throwing-onDispose-doesn't-poison-sweep), plus eight new tests for the scope-policy primitive (default-permissive, hides on policy reject, `get()` honours policy, `getRaw`/`listRaw` bypass, `register()` collides against hidden entries, signal recompute on policy change, `activeScopePolicy` over a getter — both with and without scope-less entries).

### Documentation

- New cookbook entries:
  - [Production deployment](../../docs/cookbook/production-deployment.md) — `ThreadStateStore` adapter sketches (Redis / Postgres), rate-limiting, K8s liveness, going-to-prod checklist.
  - [Federation at scale](../../docs/cookbook/federation-at-scale.md) — capability prefetch + tool filter pattern with sequence diagram and per-50-remotes performance budget.
  - [Sample prompts](../../docs/cookbook/sample-prompts.md) — canonical prompts for every demo and every registry, plus adversarial / boundary prompts.
  - [Extended registries — feature tour](../../docs/cookbook/extended-registries-feature-tour.md) — Action / Form / DataSource / Intent registries demonstrated by `demo-feature-tour`.
  - [Integrate into an existing Angular app](../../docs/cookbook/integrate-into-existing-angular-app.md) — 4-phase guide with sequence + flow diagrams.
  - [Domain MFEs as standalone apps + capability providers](../../docs/cookbook/domain-mfe-standalone-and-federated.md).
  - [Schematics reference](../../docs/cookbook/schematics.md).
- New architecture doc: [Registries vs. industry](../../docs/architecture/registries-vs-industry.md) — comparison against agent SDKs (CopilotKit, LangChain, Vercel AI) and plugin platforms (VS Code, Backstage); governance integration map onto `RegistryBase`. **Permission scopes row moved from "gap" to ✅ shipped.**
- ADR-002 updated to reference `conflictPolicy` and `onDispose`.
- [ADR-008 — Registry scope policy](../../docs/adr/0008-registry-scope-policy.md): design rationale for `setScopePolicy`, the filter-on-read decision, before/after migration of the eDiscovery shell, trade-offs, and risks. Status: Accepted (shipped).
- Every code-generating schematic template now ships with JSDoc explaining the contract.

### Examples

- New `examples/demo-feature-tour` (port 4206) — single-host showcase for the four extended registries (Action / Form / DataSource / Intent).
- All demos relocated `projects/demo-*` → `examples/demo-*`. `projects/` now holds only the publishable libraries. (No consumer-facing impact; affects `git clone` users only.)
- The three MFE remotes (`demo-remote-bookings`, `demo-remote-loyalty`, `demo-remote-support`) gained functional standalone UIs at their own ports (`:4201` / `:4203` / `:4205`) that reuse the same handlers and widget components the host's chat consumes — proving each remote is a complete domain artefact, not a chat-only shim.
- **🏛 eDiscovery flagship reference application** (Phases 0–8 of the [eDiscovery plan](../../docs/plans/ediscovery-app-plan.md)) under `examples/demo-ediscovery-{shared,server,shell,review,production,search,mcp}/`:
  - 18 tools across 4 specialists (`collection`, `review`, `production`, `search`) under one `OrchestratorAgent` with sticky-by-thread routing.
  - 3 federated MFE remotes (review, production, search) plus an MCP server (`@maverick/demo-ediscovery-mcp`) for analyst workstations.
  - All 13 registries exercised: tools, components, capabilities, backends, MFE registry, actions (click-to-navigate), forms (`productionConfigForm`), data sources (`documentIndex`), validation (Bates pattern), persistence (sessionStorage persona), schema transformer (Zod schemas everywhere).
  - Tamper-evident audit chain (`appendAudit` auto-stamps `chainHash` + `prevHash`); `generateChainOfCustodyReport` tool + widget render the chain with hash recompute on hover.
  - Persona-scoped tool surface — 5 personas with allow-listed tools, wired through the new `RegistryBase.setScopePolicy()` API.
  - Production-build ~44 KB initial transfer (gzip 15 KB); each route lazy-loaded as its own chunk.

### Companion library

`@maverick/agentic-ui-server` (separate npm package — server-side):
- **`ThreadStateStore<TState>` interface + `InMemoryThreadStateStore` default** — externalisable per-thread state. Drop in a Redis or Postgres adapter for multi-pod deployments. Documented in the production-deployment cookbook.
- **`createSpecialist({ id, factory, description, examples })` + `registerSpecialists(map, specs)`** — bundle "construct agent + write `SubAgentSpec`" into one call. Cuts ~30 lines of orchestrator boilerplate per specialist.

### Notes

- All additions are **opt-in and backward-compatible**. Existing 1.0.0 consumers see zero behaviour change without explicit provider changes.
- Minor release per SemVer — no breaking API changes vs 1.0.0.
