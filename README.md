# `@maverick/agentic-ui`

Reusable Angular library + schematics that turn any Angular 21 app into an *agentic UI host* in one command — with first-class support for **microfrontends** and pluggable backends for **AG-UI**, **Hashbrown**, and **A2UI**.

See [PLAN.md](./PLAN.md) for the full architecture, milestones, and risk handling.

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                       ANGULAR HOST APPLICATION  (browser)                  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │              UI LAYER  (standalone Angular components)                │  │
│  │   <mvk-chat-shell>     <mvk-widget-container>     <mvk-form-renderer> │  │
│  │           │                       ▲                      ▲            │  │
│  │           │ injectAgenticChat()   │ resolves from        │            │  │
│  │           ▼                       │ ComponentRegistry    │            │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │              AGENTIC CORE  (Angular 21 resource() + signals)     │ │  │
│  │  │  runUntilSettled · message stream · abort · turn orchestration   │ │  │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  └────────────┬──────────────────────────────────────────────────────────┘  │
│               │ reads/writes via uniform Registry<TDef>                     │
│  ┌────────────┴──────────────────────────────────────────────────────────┐  │
│  │                  REGISTRY LAYER  (13 root injectables, signal-backed) │  │
│  │  CORE:    Tool · Component · Capability · Backend · MFE               │  │
│  │  EXT:     Action · Intent · Form · DataSource                         │  │
│  │  SEAMS:   Validation · Persistence · Layout · SchemaTransformer       │  │
│  └────────────┬──────────────────────────────────────────────────────────┘  │
│               │ AgenticBackend.run(input) → AsyncIterable<AgenticEvent>     │
│               ▼                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     BACKEND ADAPTER LAYER                            │  │
│  │   AgUiBackend       │   HashbrownBackend   │   A2uiBackend           │  │
│  │   (@ag-ui/client)   │   (NDJSON stream)    │   (ui-action dispatch)  │  │
│  └──────────────┬─────────────┬────────────────────┬────────────────────┘  │
│                 │             │                    │                        │
│  ╔══════════════╪═════════════╪════════════════════╪══════════════════╗   │
│  ║                       FEDERATION RUNTIME                            ║   │
│  ║   Native Federation (esbuild)  OR  Module Federation (webpack)      ║   │
│  ║   loadRemoteCapabilities() — pushes into Tool/Component registries  ║   │
│  ╚════════════════╤══════════════════════╤════════════════════════════╝   │
│                   │                      │                                  │
│      ┌────────────▼─────────┐  ┌─────────▼─────────────┐                   │
│      │  Remote MFE A        │  │  Remote MFE B          │                  │
│      │   bookFlight tool    │  │   loyaltyAward tool    │                  │
│      │   flightCard widget  │  │   pointsCard widget    │                  │
│      └──────────────────────┘  └────────────────────────┘                  │
└──────────────┬─────────────────────────────────────┬───────────────────────┘
               │ HTTP / SSE                          │ HTTP discovery
               ▼                                     ▼
┌──────────────────────────────┐       ┌──────────────────────────────┐
│    AGENT SERVER  (Node)      │       │   MFE REGISTRY  (external)   │
│    @maverick/agentic-ui-     │       │   Spring Boot OR static JSON │
│    server                    │       │   via MfeRegistrySource      │
│                              │       │                              │
│   /api/agents/:id/run  ──SSE │       │   GET /mfes?env=...          │
│       │                      │       │   SSE /mfes/watch (M5)       │
│       ▼                      │       └──────────────────────────────┘
│   ServerAgent impl:          │
│   · GeminiAgent              │
│   · MastraAgent (M5)         │
│   · LangGraphAgent (M5)      │
│   · EchoAgent (test)         │
│       │                      │
│       ▼                      │
│   LLM Provider               │
│   (Google · OpenAI · Anthr.) │
└──────────────────────────────┘
```

**Read top-to-bottom**: the chat shell talks to the registry layer; the registry layer dispatches the active `AgenticBackend`; the backend streams events from the agent server. Federation loads MFE remotes into the same browser realm so their `CapabilityModule` writes directly into the host's registries — and since v1.0 the lib ships as a single primary entry shared via federation, the registry singletons resolve to the same class identity in host and remote (see [ADR-005](docs/adr/0005-single-primary-entry.md)).

## Status

| Milestone | What it delivers | Status |
|-----------|------------------|--------|
| M1 | Core lib (5 registries + AG-UI adapter + chat shell + widget container + agent server) | ✅ |
| M2 | 10 schematics (`ng-add`, `tool`, `widget`, `chat-shell`, `backend`, `agent-server`, `mfe-capability`, `action`, `intent`, `form`) | ✅ |
| M3 | MFE federation (Native + webpack runtime APIs) + A2UI adapter + CapabilityRegistry | ✅ |
| M4 | Hashbrown adapter + Action / Intent / Form registries + Validation seam + cross-backend conformance suite | ✅ |
| M5 | DataSource / Persistence / Layout / SchemaTransformer registries + MCP bridge + OTel telemetry sink | ✅ |
| v1.0 polish | Docs, cookbook, ADRs, Gemini-backed demo with working MFE federation + generative UI | ✅ |

**Test count**: 10 spec files / 58 unit tests passing (registries, run-orchestrator, capability-module, conformance suite, M4 + M5 registries, AG-UI converters/event-mapper/async-iterable, static-JSON MFE registry).

**Working demos**:
- `demo-monolith` — single-app with bookFlight tool + flightCard widget registered locally.
- `demo-shell` (host) + `demo-remote-bookings` (remote) — Native Federation; the remote contributes the bookFlight tool and flightCard widget to the host at runtime.
- `demo-server` — Hono + Gemini 2.5 Flash agent.

## Quick start — the federated demo

The workspace ships a 3-process demo: an Angular host (`demo-shell`) loading an MFE remote (`demo-remote-bookings`) over Native Federation, talking to a Hono-based agent server (`demo-server`) backed by **Google Gemini** (free tier — get a key at https://aistudio.google.com/apikey).

### 1. Install dependencies

```bash
npm install
cd projects/demo-server && npm install && cd ../..
```

### 2. Add your Gemini key

```bash
cp projects/demo-server/.env.example projects/demo-server/.env
# Edit projects/demo-server/.env and paste your key into GOOGLE_GENERATIVE_AI_API_KEY=
```

The demo also works without a key — it falls back to an Echo agent that mirrors your message word-by-word (useful for validating the SSE pipeline).

### 3. Build the library once

```bash
npm run build:lib
```

This builds `dist/agentic-ui` (a single primary entry — see [ADR-005](docs/adr/0005-single-primary-entry.md)) and refreshes the schematics.

### 4. Start all three processes — one terminal each

```bash
# Terminal 1 — agent server (Hono + Gemini, port 4111)
cd projects/demo-server && npm run dev

# Terminal 2 — MFE remote (port 4201)
npx ng serve demo-remote-bookings

# Terminal 3 — host shell (port 4200)
npx ng serve demo-shell
```

Wait for all three to print their "Ready" / "Listening" lines.

### 5. Open http://localhost:4200

You should see:
- A header `Capabilities: 1 tool(s) across 1 remote(s): demo-remote-bookings` — proves the MFE remote loaded and contributed `bookFlight` to the host's `ToolRegistry`.
- A backend pill showing `AG-UI`.
- A chat panel.

### 6. Try these prompts

| Prompt | What renders |
|--------|--------------|
| `Hi, what can you do?` | Plain text streaming response. Validates SSE pipeline. |
| **`Book me a flight from LAX to JFK on 2026-05-15`** | Tool-call line + result + **a styled `flightCard` widget** from the MFE remote + Gemini's confirmation summary. Validates the entire MFE → tool → widget chain. |
| `What's 2+2?` | Plain text answer, no tool call. |

The `flightCard` widget render is the headline test — it proves the lib's generative-UI flow works end-to-end **with a real MFE federation handshake**: the `FlightCardComponent` is defined in the remote, registered in the remote's `capability.ts`, federated into the host's `ComponentRegistry` at boot, and rendered by the host's `<mvk-widget-container>` via `*ngComponentOutlet` when the agent calls `bookFlight`.

## Workspace layout

```
ag_ui_maverick/
├── PLAN.md                         # canonical architecture plan
├── docs/
│   ├── USER_GUIDE.md               # step-by-step run guide
│   ├── adr/                        # architecture decision records
│   └── cookbook/                   # how-to guides
├── projects/
│   ├── agentic-ui/                 # @maverick/agentic-ui — single-entry library
│   │   ├── src/
│   │   │   ├── public-api.ts       # primary entry; re-exports everything
│   │   │   └── lib/
│   │   │       ├── types/          # AgenticBackend, AgenticEvent, registry defs
│   │   │       ├── telemetry/      # AgenticTelemetrySink + AgenticLogger
│   │   │       ├── registries/     # 13 registries
│   │   │       ├── validation/     # ValidationRegistry
│   │   │       ├── factories/      # agenticTool / agenticWidget / etc.
│   │   │       ├── providers/      # provideAgenticUi
│   │   │       ├── chat/           # injectAgenticChat + run-orchestrator
│   │   │       ├── components/     # <mvk-chat-shell> + widget-container + form-renderer
│   │   │       ├── backends/{ag-ui,hashbrown,a2ui}/
│   │   │       ├── mfe/                   # capability-module, registry-source, loadRemote
│   │   │       ├── mfe-module-federation/ # webpack-MF wrapper
│   │   │       ├── otel/                  # OpenTelemetry sink
│   │   │       ├── testing/               # FakeAgenticBackend, conformance suite
│   │   │       └── mcp/                   # MCP bridge
│   │   └── schematics/             # ng-add + 9 generators
│   ├── agentic-ui-server/          # @maverick/agentic-ui-server (Node)
│   ├── demo-monolith/              # single-app demo (no MFE)
│   ├── demo-shell/                 # Native Federation HOST app
│   ├── demo-remote-bookings/       # Native Federation REMOTE app
│   └── demo-server/                # Hono + Gemini agent server
└── scripts/
    └── copy-schematics-assets.mjs
```

## Cookbook

- [USER_GUIDE.md](./docs/USER_GUIDE.md) — step-by-step from clean install to seeing the flight-card widget render.
- [Quickstart](./docs/cookbook/quickstart.md) — wire `provideAgenticUi` + a backend in 5 minutes.
- [Federate an MFE](./docs/cookbook/federate-an-mfe.md) — let a remote contribute tools and widgets.
- [Swap the backend](./docs/cookbook/swap-backend.md) — AG-UI ↔ Hashbrown ↔ A2UI.
- [Observability](./docs/cookbook/observability.md) — wire `provideAgenticTelemetry` to OpenTelemetry.

## Architecture decisions

- [ADR-001 — Pluggable backend abstraction](./docs/adr/0001-agentic-backend-abstraction.md)
- [ADR-002 — Layered registry system](./docs/adr/0002-layered-registry-system.md)
- [ADR-003 — MFE registry source as a pluggable adapter](./docs/adr/0003-pluggable-mfe-registry-source.md)
- [ADR-005 — Single primary entry (no ng-packagr secondary entries)](./docs/adr/0005-single-primary-entry.md)

## Build and test

```bash
npm run build:lib          # builds @maverick/agentic-ui + schematics
npx ng build demo-monolith
npx ng build demo-shell
npx ng build demo-remote-bookings
npx ng test agentic-ui --no-watch    # 58 unit tests
```

## License

MIT.
