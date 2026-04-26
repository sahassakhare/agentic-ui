# Release notes — `@maverick/agentic-ui` v1.0.0

> First stable release of a reusable Angular 21 library and schematics collection
> for building agentic user interfaces against AG-UI, Hashbrown, or A2UI, with
> first-class microfrontend federation.

## Highlights

- **One backend abstraction, three adapters.** `AgenticBackend` is the only surface the chat shell sees. Implementations ship for AG-UI (`@ag-ui/client` SSE), Hashbrown (NDJSON streaming), and A2UI (with `ui-action` routed through `ActionRegistry`).
- **13 registries, one uniform shape.** Core (`Tool`, `Component`, `Capability`, `Backend`, `MfeRegistryClient`), extended (`Action`, `Intent`, `Form`, `DataSource`), and seams (`Validation`, `Persistence`, `Layout`, `SchemaTransformer`) — all extend `RegistryBase<TDef>`, so MFE-aware teardown, signal subscription, and conformance testing are identical across them.
- **First-class microfrontend federation.** `defineCapabilityModule(...)` lets a remote contribute tools, components, actions, and forms at load time; `loadRemoteCapabilities(...)` (Native Federation) and `loadRemoteCapabilitiesMF(...)` (webpack Module Federation) wire them into the host's signals so the next chat turn picks them up immediately. Tear-down on remote unload is one call: `removeBySource('remote:<name>')`.
- **Pluggable MFE registry.** `provideStaticJsonMfeRegistry({url})` and `provideSpringBootMfeRegistry({url})` ship out of the box; the `MfeRegistrySource` interface lets you add Consul, Etcd, or an internal REST source without forking.
- **Generative UI**, schema-driven. The `show-component` tool result convention extracts `{name, props}` and renders through `<mvk-widget-container>` via `*ngComponentOutlet`. Props are validated against the registered Zod schema before rendering.
- **Schema-driven forms.** `<mvk-form-renderer>` consumes a `FormDef`'s field schema and emits validated values; the agent can fill, validate, and submit.
- **Observability built in.** `AgenticTelemetrySink` is a no-op by default; `provideAgenticTelemetry({kind:'otel', providers})` gives you OpenTelemetry spans, metrics, and W3C `traceparent` propagation across the SSE boundary, so a single trace covers `chat shell → backend adapter → SSE route → agent → LLM → tool execution`.
- **MCP bridge.** `mcpToolBridge({client})` imports a Model Context Protocol server's tools straight into `ToolRegistry`.
- **Schematics for every artifact.** `ng add @maverick/agentic-ui` plus 9 generators (`tool`, `widget`, `chat-shell`, `backend`, `agent-server`, `mfe-capability`, `action`, `intent`, `form`).
- **Tested cross-backend.** A single `runConformance(backend)` suite exercises text streaming, tool calls, generative UI rendering, and abort semantics against any `AgenticBackend` implementation.

## Architecture decisions

- [ADR-001](docs/adr/0001-agentic-backend-abstraction.md) — Pluggable backend abstraction.
- [ADR-002](docs/adr/0002-layered-registry-system.md) — Layered registry system.
- [ADR-003](docs/adr/0003-pluggable-mfe-registry-source.md) — Pluggable MFE registry source.
- [ADR-005](docs/adr/0005-single-primary-entry.md) — Single primary entry. **Important compatibility note**: `@angular-architects/native-federation`'s `includeSecondaries: true` does not emit per-secondary-entry chunks at runtime, which prevented the planned `@maverick/agentic-ui/ag-ui`, `/hashbrown`, etc. layout from working in federated hosts. The library now ships a single primary entry; tree-shaking is preserved via `"sideEffects": false`.

## What's tested (76 specs / 12 files)

| Area | Specs |
|---|---|
| `RegistryBase<TDef>` CRUD, signal reactivity, MFE-aware teardown | 6 |
| Extended registries (`Action`, `Intent`, `Form`) | 5 |
| M5 registries (`DataSource`, `Persistence`, `Layout`, `SchemaTransformer`) | 9 |
| `defineCapabilityModule` + `apply()` | 3 |
| Cross-backend conformance against `FakeAgenticBackend` | 1 |
| Run orchestrator (lifecycle / tool execution / generative UI extraction) | 2 |
| AG-UI message converters | 8 |
| AG-UI event mapper | 12 |
| Observable → async iterable adapter | 5 |
| Static-JSON `MfeRegistrySource` | 5 |
| Spring Boot `MfeRegistrySource` | 8 |
| Schematics snapshot tests (10 generators) | 12 |

CI also builds the library, runs the test suite, builds three demo apps in production mode, compiles the demo agent server, enforces a 200 KB FESM size budget, and builds the TypeDoc API site.

## Compatibility

| | |
|---|---|
| Angular | 21+ |
| Node | 20.19+ |
| TypeScript | 5.9+ |
| Zod | 3.23+ (peer) |
| RxJS | 7.8.x (peer) |

Optional peer dependencies (used by specific entry points / providers): `@ag-ui/client`, `@module-federation/runtime`, `@opentelemetry/api`, `@angular/forms`.

## Breaking changes from 0.x pre-releases

If you were following the early pre-release plan with secondary entries:

```diff
- import { provideAgUiBackend } from '@maverick/agentic-ui/ag-ui';
- import { provideHashbrownBackend } from '@maverick/agentic-ui/hashbrown';
- import { provideA2uiBackend } from '@maverick/agentic-ui/a2ui';
- import { defineCapabilityModule } from '@maverick/agentic-ui/mfe';
- import { provideAgenticTelemetry } from '@maverick/agentic-ui/otel';
- import { FakeAgenticBackend } from '@maverick/agentic-ui/testing';
+ import {
+   provideAgUiBackend,
+   provideHashbrownBackend,
+   provideA2uiBackend,
+   defineCapabilityModule,
+   provideAgenticTelemetry,
+   FakeAgenticBackend,
+ } from '@maverick/agentic-ui';
```

Tree-shaking is unchanged — apps that only import `provideAgUiBackend` will not pull in Hashbrown, A2UI, MCP, or the OpenTelemetry adapter.

## Known limitations

- **Webpack Module Federation:** the runtime API (`loadRemoteCapabilitiesMF`) ships and is wire-compatible with the Native Federation API; working demo applications for the webpack path are scheduled for v1.1.
- **A2UI spec drift:** the adapter targets spec version `0.x`. Mismatches warn via the configured `AgenticLogger`. A `provideA2uiBackend2(...)` is reserved for the eventual breaking change.
- **Native Federation `includeSecondaries`** still does not emit per-secondary chunks. We will revisit the secondary-entry split when this is fixed upstream.

## Install

```bash
npm install @maverick/agentic-ui zod
# Optional peers, depending on the backend you wire:
npm install @ag-ui/client                  # AG-UI adapter
npm install @module-federation/runtime     # webpack Module Federation
npm install @opentelemetry/api             # /otel telemetry
```

Or scaffold a fresh app:

```bash
ng new my-agent-app --standalone
cd my-agent-app
ng add @maverick/agentic-ui --backend=ag-ui --mfe=host --federation=native --server=mastra
```

## Resources

- **API reference:** https://sahassakhare.github.io/agentic-ui/
- **User guide:** [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- **Cookbook:** [`docs/cookbook/`](docs/cookbook/)
- **ADRs:** [`docs/adr/`](docs/adr/)
- **Source / issues:** https://github.com/sahassakhare/agentic-ui

## Acknowledgements

Architecture informed by the [angularachitects.io AG-UI explainer](https://www.angularachitects.io/blog/understanding-ag-ui-the-standard-for-agentic-user-interfaces/) and the reference implementation at [`angular-architects/flights42`](https://github.com/angular-architects/flights42/tree/agentic). The patterns transferred — `agUiResource()`, `runUntilSettled`, the `show-component` Zod-discriminated-union approach, and the `widget-container` `*ngComponentOutlet` pattern — but the surfaces (`injectAgenticChat`, `RegistryBase`, `AgenticBackend`) are designed for reuse across applications and microfrontends.
