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

The repository ships **thirteen reference applications** under `examples/`. They cover four patterns: single-process showcases, federated MFEs, agent backends, and a flagship enterprise reference.

### 🏛 Flagship — enterprise eDiscovery reference (Phases 0–7 shipped)

A multi-pane regulated-domain reference app built across the eight phases in [docs/plans/ediscovery-app-plan.md](./docs/plans/ediscovery-app-plan.md). Exercises every load-bearing library feature simultaneously: 17 tools across 4 specialists, 3 federated MFE remotes, all 13 registries, tamper-evident chain-of-custody audit, MCP for analyst workstations, persona-scoped permission filtering. **Drop the eight phases in here for the headline architectural story.**

| App | Purpose | Port |
|-----|---------|------|
| `demo-ediscovery-shell` | Host shell with three-pane layout (left nav, routed pages, collapsible chat rail). 6 routes (Dashboard, Documents, Custodians, Holds, Audit, Productions) + persona menu. Wires `provideToolFilter` chaining `personaToolFilter` → `keywordToolFilter`. | 4300 |
| `demo-ediscovery-server` | Hono server with `OrchestratorAgent` routing to four specialists: `collection`, `review`, `production`, `search`. Per-thread sticky routing via `ThreadStateStore`. | 4311 |
| `demo-ediscovery-review` | Review MFE remote. 4 tools (search, tag, mark privileged, privilege log) + 3 widgets (documentPreview, tagPanel, reviewProgress). | 4302 |
| `demo-ediscovery-production` | Production MFE remote. 5 tools (create → bates → redact → export → chain-of-custody) + 4 widgets including HTML5-canvas redactionEditor. `productionConfigForm` via FormRegistry; Bates-pattern Validation seam. | 4303 |
| `demo-ediscovery-search` | Search MFE remote. 4 tools (semanticSearch, filterByDateRange, filterByCustodians, runTARClassifier) routing through a `documentIndex` `DataSourceDef`. 3 widgets including a TAR-score table. | 4304 |
| `demo-ediscovery-mcp` | MCP server exposing the review + search tools to Claude Desktop / Cursor / Zed. 5 tools with HTML render-hints (`text/html;profile=mcp-app`). Per-user audit attribution via env vars. | stdio |
| `demo-ediscovery-shared` | Framework-agnostic domain types + mock data + Bates utilities + tamper-evident chain-hash + chain-of-custody report builder. Imported by every app above. | (lib) |

What ships through Phase 7 — quick reference:
- **Phase 0** — foundation (mock data, server skeleton, three-pane shell)
- **Phase 1** — collection specialist + 5 tools + 2 widgets + custodianIntakeForm
- **Phase 2** — review remote (Native Federation) + click-to-navigate via ActionRegistry
- **Phase 3** — production remote + Bates chain + productionConfigForm + canvas redaction widget
- **Phase 4** — search remote + DataSource + TAR classifier + `keywordToolFilter` activation
- **Phase 5** — tamper-evident audit chain + `chain-of-custody` report widget + integrity badge
- **Phase 6** — MCP server (`@maverick/demo-ediscovery-mcp`) for analyst workstations
- **Phase 7** — persona permission shim (5 personas, allow-listed tools, live tool-count badge)

### Single-process examples

| App | Purpose | Port |
|-----|---------|------|
| `demo-monolith` | Single-app, single-agent demo. Tools and widgets registered locally; no federation moving parts. | 4202 |
| `demo-multi-agent` | One host, multiple agents. Registers tools + widgets for three domains inline; the orchestrator on the server classifies each turn and forwards events from the chosen specialist. | 4204 |
| `demo-feature-tour` | Extended-registry showcase. Demonstrates the four library capabilities not covered by the other demos: `ActionRegistry` (agent-triggered navigation + toasts), `FormRegistry` (`<mvk-form-renderer>`), `DataSourceRegistry` (typed REST adapter), and an `IntentRegistry` entry for pre-LLM short-circuit. | 4206 |

### Federated example — one app per domain, one agent per app

| App | Purpose | Port |
|-----|---------|------|
| `demo-shell` | Native Federation host. Discovers remotes via `MfeRegistryClient`, blocks bootstrap until each `Capability` registers via `provideAppInitializer`. Talks to `/agents/orchestrator/run`. | 4200 |
| `demo-remote-bookings` | Bookings MFE remote. Exposes `./Capability` with `bookFlightTool` + `flightCardWidget`. **Also has its own form-driven UI** at `:4201` that calls the same handler and renders the same widget. | 4201 |
| `demo-remote-loyalty` | Loyalty MFE remote. Exposes `./Capability` with `checkPointsTool`, `redeemPointsTool`, and `pointsCardWidget`. **Also has its own UI** at `:4203` (check balance + redeem) that reuses the same handlers and widget. | 4203 |
| `demo-remote-support` | Support MFE remote. Exposes `./Capability` with `openTicketTool`, `checkTicketTool`, and `ticketCardWidget`. **Also has its own UI** at `:4205` (open + check ticket) reusing the same handlers and widget. | 4205 |

### Backend

| App | Purpose | Port |
|-----|---------|------|
| `demo-server` | Hono SSE agent server. Hosts six `ServerAgent` implementations under one process: `EchoAgent`, the single-domain `GeminiAgent`, three specialists (`bookings`, `loyalty`, `support`), and an `OrchestratorAgent` that classifies each turn and forwards events from the chosen specialist. | 4111 |

### Quick start — single-process multi-agent (`demo-multi-agent`)

```bash
npm install
cd examples/demo-server && npm install && cd ../..
cp examples/demo-server/.env.example examples/demo-server/.env
# Add your GOOGLE_GENERATIVE_AI_API_KEY to examples/demo-server/.env
npm run build:lib
npm install ./dist/agentic-ui --no-save

# Two terminals:
cd examples/demo-server && npm run dev     # :4111
npx ng serve demo-multi-agent              # :4204
```

Open <http://localhost:4204> and try `Book a flight from LAX to JFK on 2026-05-05`, `How many points do I have?`, or `Open a support ticket`. The orchestrator routes each turn to the matching specialist and renders the appropriate card.

### Quick start — federated, one app per domain (`demo-shell` + remotes)

Topology — each domain owns one app; the orchestrator on the server routes per turn:

```
┌─────────────────────────────────────────────────────────────────┐
│  demo-shell  (host, :4200)                                      │
│   • orchestrator agent URL: /agents/orchestrator/run            │
│   • discovers remotes from /mfes.json at boot                   │
│   • blocks bootstrap until every Capability is registered       │
└────────┬─────────────┬──────────────┬───────────────────────────┘
         │             │              │
   ┌─────▼────┐  ┌─────▼─────┐  ┌─────▼─────┐
   │ bookings │  │  loyalty  │  │  support  │
   │  :4201   │  │   :4203   │  │   :4205   │
   │          │  │           │  │           │
   │ tools +  │  │ tools +   │  │ tools +   │
   │ widget   │  │ widget    │  │ widget    │
   └──────────┘  └───────────┘  └───────────┘
                       │
              ┌────────▼────────────────────────┐
              │ demo-server (:4111)             │
              │ orchestrator + specialists      │
              │ (bookings · loyalty · support)  │
              └─────────────────────────────────┘
```

| Process | Port | Role |
|---|---|---|
| `demo-server` | 4111 | Six agents — `echo`, `gemini`, `bookings`, `loyalty`, `support`, `orchestrator` |
| `demo-shell` | 4200 | Federation host. Talks to `/agents/orchestrator/run`. Loads remotes via `MfeRegistryClient.discover()`. |
| `demo-remote-bookings` | 4201 | Owns `bookFlight`, `flightCard` |
| `demo-remote-loyalty` | 4203 | Owns `checkPoints`, `redeemPoints`, `pointsCard` |
| `demo-remote-support` | 4205 | Owns `openTicket`, `checkTicket`, `ticketCard` |

```bash
npm install
cd examples/demo-server && npm install && cd ../..
cp examples/demo-server/.env.example examples/demo-server/.env
# Add your GOOGLE_GENERATIVE_AI_API_KEY to examples/demo-server/.env
npm run build:lib
npm install ./dist/agentic-ui --no-save

# Five terminals:
cd examples/demo-server && npm run dev     # :4111
npx ng serve demo-remote-bookings          # :4201
npx ng serve demo-remote-loyalty           # :4203
npx ng serve demo-remote-support           # :4205
npx ng serve demo-shell                    # :4200
```

Open <http://localhost:4200>. The browser console should log `[demo-shell] Loaded demo-remote-bookings (1 tool(s), 1 widget(s))` and the same for loyalty + support. Try one prompt per domain:

| Prompt | Routes to | Owned by |
|---|---|---|
| *"Book a flight from LAX to JFK on 2026-05-05"* | bookings specialist | `demo-remote-bookings` |
| *"How many loyalty points do I have?"* | loyalty specialist | `demo-remote-loyalty` |
| *"Open a support ticket — my refund hasn't arrived"* | support specialist | `demo-remote-support` |

Adding a fourth domain is the same recipe: clone one of the remote folders, point it at a new port, register it in `mfes.json`, add a corresponding sub-agent in `demo-server/src/server.ts`, and the orchestrator picks it up automatically.

#### Each remote is also a standalone app

Open <http://localhost:4201>, <http://localhost:4203>, and <http://localhost:4205> directly to see each domain MFE running on its own with a real form-driven UI. The standalone UIs call the **same tool handlers** and render the **same widget components** the agent uses — proving each MFE is a complete domain artefact, not a chat-only shim. The capability surface (`./Capability` exposed via federation) is unchanged; the host shell at `:4200` keeps consuming each remote exactly as before.

## Documentation

| Document | Contents |
|----------|----------|
| [API reference](https://sahassakhare.github.io/agentic-ui/) | Full TypeDoc-generated reference; rebuilt on every push to `main` and on every `v*` tag. Locally: `npm run docs:api`. |
| Compodoc site | Angular-aware docs site (components, services, modules, routes) with the cookbook embedded as an additional-pages section. Build: `npm run docs:compodoc`. Live-reload: `npm run docs:compodoc:serve`. Output: `docs/compodoc/`. |
| [User Guide](./docs/USER_GUIDE.md) | 7-step walkthrough from clean clone to a working federated demo, plus a troubleshooting matrix keyed to specific error messages. |
| [Quickstart](./docs/cookbook/quickstart.md) | Provider wiring in five minutes. |
| [Sample prompts](./docs/cookbook/sample-prompts.md) | Canonical prompts for every demo and every library feature — paste into the chat, or use as a manual regression suite. |
| [Production deployment](./docs/cookbook/production-deployment.md) | The `ThreadStateStore` abstraction (Redis / Postgres adapters), rate-limiting, secrets, K8s liveness probes — what changes between localhost and a multi-pod deploy. |
| [Federation at scale](./docs/cookbook/federation-at-scale.md) | Capability prefetch (manifest-only registration without bundle load) + per-turn tool filtering — what's needed at 50+ remotes / 200+ tools. |
| [Registries vs. industry](./docs/architecture/registries-vs-industry.md) | Comparison of our 13 registries against agent SDKs (CopilotKit, LangChain, Vercel AI) and plugin platforms (VS Code, Backstage). Governance gaps + integration map onto the existing `RegistryBase`. |
| [Roadmap](./ROADMAP.md) | Researched extension recommendations + phased plan. Tier 1 (MCP server, user-in-the-loop confirmations, streaming citations, memory registry, cost gates), Tier 2 (streaming structured output, eval adapters, code-interpreter, voice), Tier 3 (deferred). Each item has industry context, API sketch, effort estimate, acceptance criteria, risks. |
| [ADR-006 — MCP server-side adapter](./docs/adr/0006-mcp-server-side-adapter.md) | Design rationale for `@maverick/agentic-ui-mcp`. **Status: Accepted (implementing).** |
| [Plan — Enterprise eDiscovery example app](./docs/plans/ediscovery-app-plan.md) | Eight-phase plan for a complex enterprise reference application that exercises every load-bearing library feature simultaneously (federation, multi-agent, MCP, all 13 registries, audit trails, permission scopes). **Status: All 8 phases shipped — see `examples/demo-ediscovery-{shared,server,shell,review,production,search,mcp}/`.** |
| [Expose your tools as an MCP server](./docs/cookbook/mcp-server.md) | Wrap any `ToolDef[]` with `createMcpServer({...})` so Claude Desktop / Cursor / Zed can call your tools. Includes Claude Desktop config snippet, transport choices (stdio / HTTP / embeddable), `beforeCall`/`afterCall` patterns, production checklist. |
| [Paralegal privilege review in Claude Desktop](./docs/cookbook/paralegal-mcp-review.md) | End-to-end walkthrough of the eDiscovery flagship's MCP server: build, wire into `claude_desktop_config.json`, run a typical privilege-review session, per-user audit attribution, debugging, production hardening. Phase 6 of the [eDiscovery plan](./docs/plans/ediscovery-app-plan.md). |
| [eDiscovery end-to-end test suite](./e2e/README.md) | 16 Playwright tests across 6 specs covering every phase of the flagship — `npm run test:e2e`. Auto-skips LLM-driven specs when no Gemini key is configured; `00-smoke` + `05-persona-scope` are LLM-free and run anywhere. |
| [ADR-008 — Registry scope policy](./docs/adr/0008-registry-scope-policy.md) | Design rationale for `RegistryBase.setScopePolicy` + `RegistryEntry.scopes` field. Filter-on-read decision, before/after migration of the eDiscovery shell, trade-offs. **Status: Accepted (shipped).** |
| [Integrate into an existing Angular app](./docs/cookbook/integrate-into-existing-angular-app.md) | Step-by-step guide with sequence + flow diagrams: install → tools/widgets → MFE federation → multi-agent orchestration. Each phase is independently shippable. |
| [Schematics reference](./docs/cookbook/schematics.md) | The 10 generators (`ng add`, `tool`, `widget`, `chat-shell`, `backend`, `agent-server`, `mfe-capability`, `action`, `intent`, `form`) — all options + common pipelines. |
| [Federate an MFE](./docs/cookbook/federate-an-mfe.md) | Host + remote setup with Native Federation. |
| [Domain MFEs as standalone apps + capability providers](./docs/cookbook/domain-mfe-standalone-and-federated.md) | Why each remote is simultaneously a real Angular app and an agentic capability — one codebase, two surfaces, same widgets. |
| [Multi-agent orchestration](./docs/cookbook/multi-agent-orchestration.md) | Shell orchestrator routes to per-domain specialists; AG-UI events forwarded verbatim so widgets and tool calls keep working. |
| [Extended registries — feature tour](./docs/cookbook/extended-registries-feature-tour.md) | Worked walkthrough of `ActionRegistry`, `FormRegistry`, `DataSourceRegistry`, `IntentRegistry` with the running `demo-feature-tour` app. |
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
