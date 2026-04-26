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
- **66 unit tests** across 11 spec files covering: registries CRUD + signal reactivity + MFE-aware teardown, run orchestrator (lifecycle / tool execution / generative-UI extraction), AG-UI converters + event mapper + observable-to-async-iterable adapter, static-JSON + Spring Boot MFE registry sources, defineCapabilityModule + apply, and the cross-backend conformance suite against `FakeAgenticBackend`.

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

(empty)
