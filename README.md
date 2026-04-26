# @maverick/agentic-ui

[![ci](https://github.com/sahassakhare/agentic-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/sahassakhare/agentic-ui/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@maverick/agentic-ui.svg)](https://www.npmjs.com/package/@maverick/agentic-ui)
[![Angular](https://img.shields.io/badge/angular-21-DD0031?logo=angular&logoColor=white)](https://angular.dev)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A reusable Angular 21 library and schematics collection for building agentic UIs — chat shells with streaming LLM responses, tool calling, generative UI components, and microfrontend federation — behind one consistent registry-based API.

The library treats agent transports as pluggable adapters: the same chat shell, the same registry surface, and the same orchestration loop work over **AG-UI**, **Hashbrown**, or **A2UI** without rewriting application code. Microfrontend remotes can contribute tools and widgets at runtime through Native Federation or webpack Module Federation, and the host renders remote-defined components without compile-time knowledge of them.

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Demo applications](#demo-applications)
- [Documentation](#documentation)
- [Development](#development)
- [Testing](#testing)
- [Versioning and release](#versioning-and-release)
- [Compatibility](#compatibility)
- [License](#license)

## Features

- **Pluggable agent backends.** A single `AgenticBackend` interface; ship adapters for AG-UI (`@ag-ui/client` HttpAgent + SSE), Hashbrown (NDJSON), and A2UI (`ui-action` event class routed through `ActionRegistry`).
- **Layered registry system.** Thirteen registries grouped into Core, Extended, and Seam tiers, all sharing one `Registry<TDef>` shape — uniform `register / list / signal / removeBySource` semantics across tools, components, capabilities, backends, MFE remotes, actions, intents, forms, data sources, validation, persistence, layout, and schema transformation.
- **Generative UI.** Tool results carrying a `components: [{ name, props }]` field cause the chat shell to render registered Angular components by name through `*ngComponentOutlet`, with Zod-validated props.
- **MFE federation.** `defineCapabilityModule` packages a remote's tools and widgets; `loadRemoteCapabilities` (Native Federation) and `loadRemoteCapabilitiesMF` (webpack Module Federation) push them into the host's runtime registries. Remote discovery happens through a pluggable `MfeRegistrySource` (static JSON or Spring Boot reference adapters; bring-your-own for Consul, Etcd, etc.).
- **Schematics.** Ten generators: `ng-add`, `tool`, `widget`, `chat-shell`, `backend`, `agent-server`, `mfe-capability`, `action`, `intent`, `form`. Snapshot-tested.
- **Observability.** `AgenticTelemetrySink` emit points are baked into the orchestrator and registries from M1; the optional OpenTelemetry-backed sink ships with W3C trace context propagation across SSE.
- **Federation-safe single primary entry.** All public API exports through one entry point so Native Federation can share the runtime as a singleton across host and remote (see [ADR-005](./docs/adr/0005-single-primary-entry.md)). Tree-shaking is preserved by `"sideEffects": false`.

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                       ANGULAR HOST APPLICATION  (browser)                  │
│                                                                            │
│  UI layer                                                                  │
│   <mvk-chat-shell>     <mvk-widget-container>     <mvk-form-renderer>      │
│           │                       ▲                      ▲                 │
│           │ injectAgenticChat()   │ resolves from        │                 │
│           ▼                       │ ComponentRegistry    │                 │
│   Agentic core (Angular 21 resource() + signals)                           │
│   runUntilSettled · message stream · abort · turn orchestration            │
│           │                                                                │
│           │ reads/writes via uniform Registry<TDef>                        │
│           ▼                                                                │
│   Registry layer  (13 root injectables, signal-backed)                     │
│     CORE:    Tool · Component · Capability · Backend · MFE                 │
│     EXT:     Action · Intent · Form · DataSource                           │
│     SEAMS:   Validation · Persistence · Layout · SchemaTransformer         │
│           │                                                                │
│           │ AgenticBackend.run(input) → AsyncIterable<AgenticEvent>        │
│           ▼                                                                │
│   Backend adapter layer                                                    │
│     AgUiBackend (@ag-ui/client) │ HashbrownBackend │ A2uiBackend           │
│           │           │                 │                                  │
│  ╔════════╪═══════════╪═════════════════╪═══════════════════════════════╗ │
│  ║                       FEDERATION RUNTIME                              ║ │
│  ║   Native Federation (esbuild)   OR   Module Federation (webpack)      ║ │
│  ║   loadRemoteCapabilities() pushes into Tool / Component registries    ║ │
│  ╚════════════════╤══════════════════════╤═══════════════════════════════╝ │
│                   │                      │                                  │
│      Remote MFE A (bookings)    Remote MFE B (loyalty)                     │
│      bookFlight tool            loyaltyAward tool                          │
│      flightCard widget          pointsCard widget                          │
└──────────────┬─────────────────────────────────────┬───────────────────────┘
               │ HTTP / SSE                          │ HTTP discovery
               ▼                                     ▼
       Agent server  (Node)                MFE registry  (external)
       @maverick/agentic-ui-server          Spring Boot OR static JSON
       /api/agents/:id/run  ── SSE          via MfeRegistrySource
       ServerAgent implementations          GET /mfes?env=...
       (GeminiAgent, EchoAgent, ...)        SSE /mfes/watch
```

The chat shell talks to the registry layer; the registry layer dispatches the active `AgenticBackend`; the backend streams events from the agent server. Federation loads MFE remotes into the same browser realm so their `CapabilityModule.apply()` writes directly into the host's registries — and because the library ships as a single primary entry shared via federation, the registry singletons resolve to the same class identity in host and remote.

## Installation

```bash
npm install @maverick/agentic-ui
ng add @maverick/agentic-ui --backend=ag-ui
```

`ng add` patches `app.config.ts` with `provideAgenticUi()` plus the chosen backend provider, scaffolds `src/app/agentic/{tools,widgets}.ts`, and adds the required peer dependencies. Optional peers are flagged in `package.json` so consumers only install what they use.

| Peer | Required? | Used when |
|------|-----------|-----------|
| `@angular/common` `^21.2.0` | yes | always |
| `@angular/core` `^21.2.0` | yes | always |
| `rxjs` `~7.8.0` | yes | always |
| `zod` `^3.23.0` | yes | always |
| `@angular/forms` | optional | importing `<mvk-form-renderer>` |
| `@ag-ui/client` | optional | importing `provideAgUiBackend` |
| `@module-federation/runtime` | optional | webpack MF (`loadRemoteCapabilitiesMF`) |
| `@opentelemetry/api` | optional | OpenTelemetry telemetry sink |

## Quick start

The shortest end-to-end example: a single Angular app that streams LLM responses through the AG-UI adapter.

```ts
// src/app/app.config.ts
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideAgenticUi, provideAgUiBackend } from '@maverick/agentic-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideAgenticUi(),
    provideAgUiBackend({ url: 'http://localhost:4111/agents/gemini/run' }),
  ],
};
```

```html
<!-- src/app/app.html -->
<mvk-chat-shell />
```

```ts
// src/app/app.ts
import { Component } from '@angular/core';
import { ChatShellComponent } from '@maverick/agentic-ui';

@Component({
  selector: 'app-root',
  imports: [ChatShellComponent],
  template: '<mvk-chat-shell />',
})
export class App {}
```

For tools, widgets, MFE federation, and the full step-by-step walkthrough that builds the federated demo, see the [User Guide](./docs/USER_GUIDE.md).

## Demo applications

The repository ships six reference applications under `projects/`. They cover three different patterns:

**Single-process examples**

| App | Purpose | Port |
|-----|---------|------|
| `demo-monolith` | Single-app, single-agent demo. Tools and widgets registered locally; no federation moving parts. | 4202 |
| `demo-multi-agent` | One host, multiple agents. Registers tools + widgets for three domains inline; the orchestrator on the server classifies each turn and forwards events from the chosen specialist. | 4204 |

**Federated example — one app per domain, one agent per app**

| App | Purpose | Port |
|-----|---------|------|
| `demo-shell` | Native Federation host. Discovers remotes via `MfeRegistryClient`, blocks bootstrap until each `Capability` registers via `provideAppInitializer`. Talks to `/agents/orchestrator/run`. | 4200 |
| `demo-remote-bookings` | Bookings MFE remote. Exposes `./Capability` with `bookFlightTool` + `flightCardWidget`. | 4201 |
| `demo-remote-loyalty` | Loyalty MFE remote. Exposes `./Capability` with `checkPointsTool`, `redeemPointsTool`, and `pointsCardWidget`. | 4203 |
| `demo-remote-support` | Support MFE remote. Exposes `./Capability` with `openTicketTool`, `checkTicketTool`, and `ticketCardWidget`. | 4205 |

**Backend**

| App | Purpose | Port |
|-----|---------|------|
| `demo-server` | Hono SSE agent server. Hosts six `ServerAgent` implementations under one process: `EchoAgent`, the single-domain `GeminiAgent`, three specialists (`bookings`, `loyalty`, `support`), and an `OrchestratorAgent` that classifies each turn and forwards events from the chosen specialist. | 4111 |

### Quick start — single-process multi-agent (`demo-multi-agent`)

```bash
npm install
cd projects/demo-server && npm install && cd ../..
cp projects/demo-server/.env.example projects/demo-server/.env
# Add your GOOGLE_GENERATIVE_AI_API_KEY to projects/demo-server/.env
npm run build:lib
npm install ./dist/agentic-ui --no-save

# Two terminals:
cd projects/demo-server && npm run dev     # :4111
npx ng serve demo-multi-agent              # :4204
```

Open <http://localhost:4204> and try `Book a flight from LAX to JFK on 2026-05-05`, `How many points do I have?`, or `Open a support ticket`. The orchestrator routes each turn to the matching specialist and renders the appropriate card.

### Quick start — federated, one app per domain (`demo-shell` + remotes)

```bash
npm install
cd projects/demo-server && npm install && cd ../..
cp projects/demo-server/.env.example projects/demo-server/.env
# Add your GOOGLE_GENERATIVE_AI_API_KEY to projects/demo-server/.env
npm run build:lib
npm install ./dist/agentic-ui --no-save

# Five terminals:
cd projects/demo-server && npm run dev     # :4111
npx ng serve demo-remote-bookings          # :4201
npx ng serve demo-remote-loyalty           # :4203
npx ng serve demo-remote-support           # :4205
npx ng serve demo-shell                    # :4200
```

Open <http://localhost:4200>. The browser console should log `[demo-shell] Loaded demo-remote-bookings (1 tool(s), 1 widget(s))` and the same for loyalty + support. Each domain now lives in its own deployable; the orchestrator on the server routes per turn to the specialist whose tools the loaded remote contributed.

## Documentation

| Document | Contents |
|----------|----------|
| [API reference](https://sahassakhare.github.io/agentic-ui/) | Full TypeDoc-generated reference; rebuilt on every push to `main` and on every `v*` tag. Locally: `npm run docs:api`. |
| [User Guide](./docs/USER_GUIDE.md) | 7-step walkthrough from clean clone to a working federated demo, plus a troubleshooting matrix keyed to specific error messages. |
| [Quickstart](./docs/cookbook/quickstart.md) | Provider wiring in five minutes. |
| [Federate an MFE](./docs/cookbook/federate-an-mfe.md) | Host + remote setup with Native Federation. |
| [Multi-agent orchestration](./docs/cookbook/multi-agent-orchestration.md) | Shell orchestrator routes to per-domain specialists; AG-UI events forwarded verbatim so widgets and tool calls keep working. |
| [Swap the backend](./docs/cookbook/swap-backend.md) | AG-UI ↔ Hashbrown ↔ A2UI; runtime backend selection via `BackendRegistry`. |
| [Observability](./docs/cookbook/observability.md) | `provideAgenticTelemetry` wiring; OpenTelemetry SDK integration. |
| [ADR-001](./docs/adr/0001-agentic-backend-abstraction.md) | Pluggable backend abstraction. |
| [ADR-002](./docs/adr/0002-layered-registry-system.md) | Layered registry system. |
| [ADR-003](./docs/adr/0003-pluggable-mfe-registry-source.md) | Pluggable MFE registry source. |
| [ADR-005](./docs/adr/0005-single-primary-entry.md) | Single primary entry (no ng-packagr secondary entries). |
| [CHANGELOG](./projects/agentic-ui/CHANGELOG.md) | Release notes. |

## Development

```bash
# install workspace dependencies
npm install

# build the library + schematics
npm run build:lib

# run the unit-test suite (Vitest via @angular/build:unit-test)
npx ng test agentic-ui --no-watch

# build a demo app
npx ng build demo-monolith            # development
npx ng build demo-monolith --configuration=production
```

The repository uses a Git pre-commit hook (`.githooks/pre-commit`, activated via `git config --local core.hooksPath .githooks`) that blocks commits containing `.env`-named files or strings matching common API-key signatures (Google, OpenAI/Anthropic, GitHub PATs, Slack tokens, PEM private keys).

## Testing

Twelve specification files cover **76 unit tests**, executed in approximately three seconds via Vitest:

| Subject | File | Tests |
|---------|------|-------|
| Registry base + concrete registries | `registries/registry-base.spec.ts` | 6 |
| Run orchestrator (lifecycle, tool execution, generative UI extraction) | `chat/run-orchestrator.spec.ts` | 2 |
| `defineCapabilityModule.apply()` + dispose semantics | `registries/capability-module.spec.ts` | 3 |
| Cross-backend conformance suite (`runConformance`) | `registries/conformance.spec.ts` | 1 |
| Action / Intent / Form registries + factories | `registries/extended-registries.spec.ts` | 5 |
| DataSource / Persistence / Layout / SchemaTransformer | `registries/m5-registries.spec.ts` | 9 |
| AG-UI converters (Zod → JSON Schema, message round-trip) | `backends/ag-ui/converters.spec.ts` | 8 |
| AG-UI event mapper + showComponents extraction | `backends/ag-ui/event-mapper.spec.ts` | 12 |
| RxJS Observable → AsyncIterable bridge | `backends/ag-ui/observable-to-async-iterable.spec.ts` | 5 |
| Static-JSON MFE registry source | `mfe/mfe-registry-source.spec.ts` | 5 |
| Spring Boot MFE registry source | `mfe/spring-boot-mfe-registry.spec.ts` | 8 |
| Schematics snapshot tests (all 10 generators) | `schematics.spec.ts` | 12 |

GitHub Actions runs the full pipeline (build → test → three production demo builds → 200 KB FESM size guard) on every push and pull request. See `.github/workflows/ci.yml`.

## Versioning and release

`@maverick/agentic-ui` follows [Semantic Versioning](https://semver.org/). The current release is `1.0.0` — see [CHANGELOG.md](./projects/agentic-ui/CHANGELOG.md) for full notes.

Tagging convention: annotated tags `vMAJOR.MINOR.PATCH` against the commit that bumps the lib's `package.json#version`.

## Compatibility

| Tool | Version |
|------|---------|
| Angular | 21+ |
| Node.js | ≥ 20.19 |
| TypeScript | 5.9+ |
| RxJS | 7.8.x (peer) |
| Zod | 3.23+ (peer) |

## License

[MIT](./LICENSE)
