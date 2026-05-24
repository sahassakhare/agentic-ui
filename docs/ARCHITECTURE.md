# Architecture

> How `@infra-tools/agentic-ui` is put together — the problem it solves, the layered
> runtime, the registry model, and the external-surface adapters. For the elevator
> pitch and quick start, see the [root README](../README.md).

## Problem statement (for technical architects)

Agentic UIs are easy to demo and hard to ship. The pain compounds across six axes — every team building this shape of product hits at least four of them.

| # | Problem | What teams build without an abstraction | What this library does |
|---|---|---|---|
| 1 | **Protocol churn** — AG-UI, Hashbrown, A2UI all evolve quarterly; picking one is betting on a moving target. | Hand-rolled SSE / WebSocket / NDJSON parser per app, retried per protocol revision; chat-shell rewrites every quarter. | One `AgenticBackend` interface with three shipped adapters; the chat shell never sees the wire format. Swap protocols by changing one provider. |
| 2 | **Fan-out** — an agentic UI isn't just chat; it's tools + components + validation + persistence + telemetry + audit + federation. Each becomes bespoke. | Each capability shipped as a one-off store / service with its own conventions, life-cycle, signal pattern, and teardown semantics. | One `Registry<TDef>` base class. Eighteen registries (Tool, Component, Action, Form, DataSource, Approval, Operation, Trigger, Dashboard, Playbook, …) all expose the same `register / list / signal / removeBySource / setScopePolicy`. Adding your own registry for a domain concept is ~30 LOC. |
| 3 | **Generative UI dispatch** — the LLM emits "render flight-card with these props" as a string; resolving that to a typed Angular component with validated inputs is fiddly. | A growing `switch` over LLM-emitted strings, mounting hard-imported components, no schema validation on props. | `ComponentRegistry.get(name)` + Zod-validated props + `*ngComponentOutlet` mount. The agent's choice of widget is a registry read; missing names show a fallback, not a runtime crash. |
| 4 | **Microfrontend composition** — multiple teams need to contribute tools and widgets to one chat without recompiling the host or redeploying the shell. | Static imports + central registration list maintained by the host team; every new MFE is a host-team PR. | `defineCapabilityModule` + Native or webpack Federation. Remote loads at runtime, calls `registerAll`, and the next chat turn sees its tools. Unload runs `removeBySource` across all 18 registries in one pass — federation symmetry now extends to the post-chat-surfaces registries (triggers, dashboards, playbooks). |
| 5 | **Governance + persona scope** — regulated domains require per-role tool surfaces. The LLM should not even see tools the active user can't invoke. | Bolt-on input filter in the chat shell only; remotes that come later don't honour it; the audit story is per-app. | `RegistryBase.setScopePolicy(predicate)` filters every `list / get / signal` read — the LLM's tool list, the widget container's resolution, the form renderer's available shapes — uniformly across all 18 registries. Three layers: library enforces, app authorises (predicate), server verifies (trust boundary). |
| 6 | **Observability across the SSE boundary** — a chat turn fans out into LLM streaming, multiple tool calls, federation loads, persistence writes. Tracing it end-to-end is non-trivial. | Per-app logs, no correlation between client + server, no W3C trace propagation; debugging slow turns means staring at network tabs. | `AgenticTelemetrySink` emit points baked in from M1 (no-op default). Optional `/otel` entry point ships an OpenTelemetry-backed sink with W3C `traceparent` propagation across the SSE handshake — one trace covers `chat shell → backend → server → LLM → tool → registry`. |

**The architect's net.** You design *one* shape — registries plus pluggable backends plus an MFE-aware host — and protocol shifts, governance changes, and team ownership splits land as configuration changes, not chat-shell rewrites. The library trades a few extra abstractions up front (yes, eighteen registries) for the elimination of bespoke code for the next five years of agent protocol churn.

## System architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                       ANGULAR HOST APPLICATION  (browser)                  │
│                                                                            │
│  UI layer                                                                  │
│   <mvk-chat-shell>     <mvk-widget-container>     <mvk-form-renderer>      │
│   <mvk-approval-card>  <mvk-operation-progress>   <mvk-workflow-renderer>  │
│           │                       ▲                      ▲                 │
│           │ injectAgenticChat()   │ resolves from        │                 │
│           ▼                       │ ComponentRegistry    │                 │
│   Agentic core (Angular 21 resource() + signals)                           │
│   runUntilSettled · message stream · abort · turn orchestration            │
│           │                                                                │
│           │ reads/writes via uniform Registry<TDef>                        │
│           ▼                                                                │
│   Registry layer  (18 root injectables, signal-backed)                     │
│     CORE:    Tool · Component · Capability · Backend · MFE                 │
│     EXT:     Action · Intent · Form · DataSource · Approval(F4) ·          │
│              Operation(F5) · Trigger · Dashboard · Playbook                │
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
       @infra-tools/agentic-ui-server          Spring Boot OR static JSON
       /api/agents/:id/run  ── SSE          via MfeRegistrySource
       ServerAgent implementations          GET /mfes?env=...
       (GeminiAgent, EchoAgent, ...)        SSE /mfes/watch
```

The chat shell talks to the registry layer; the registry layer dispatches the active `AgenticBackend`; the backend streams events from the agent server. Federation loads MFE remotes into the same browser realm so their `CapabilityModule.apply()` writes directly into the host's registries — and because the library ships as a single primary entry shared via federation, the registry singletons resolve to the same class identity in host and remote.

### The registry layer up close

All eighteen registries inherit one base class — `Registry<TDef>` — with identical `register / list / signal / removeBySource / setScopePolicy` semantics. They split into three tiers by adoption stage:

![Eighteen registries grouped into Core / Extended / Seams, all inheriting one base class — image still depicts the original 13-registry layout; F4 Approval + F5 Operation + the three post-chat-surfaces additions (Trigger / Dashboard / Playbook) slot into the Extended tier](assets/registry-tiers.png)

- **Core (5)** — every agentic UI needs these from day one. Tool, Component, Capability, Backend, MFE.
- **Extended (9)** — agent-driven UI beyond chat. Action (NgRx-style commands), Intent (NL → tool routing), Form (schema-driven dynamic forms), DataSource (REST/GraphQL/SSE adapters), Approval (F4 — HITL gating), Operation (F5 — long-running tools), Trigger (ADR-045 — cron / webhook / queue-fired tool calls), Dashboard (ADR-044 — user-built tile compositions), Playbook (post-chat-surfaces P5 — versioned tool-call sequences).
- **Seams (4)** — interface + thin default; you plug in your own. Validation (Zod by default; pluggable Ajv / Joi), Persistence (localStorage / sessionStorage / Dexie), Layout (CDK-friendly), SchemaTransformer (JSON Schema ↔ Zod, OpenAPI → Tool importer).

Adding a registry of your own — say, a `MetricRegistry` for a custom domain — is ~30 LOC of base-class extension and gets the same MFE teardown, conformance suite, and persona scope policy out of the box.

### Bring the agent to other surfaces — four adapter packages

Your operators don't all live in your app. Some are in **Microsoft Teams chat**; some in **GitHub Copilot Chat** (VS Code / JetBrains / github.com); some in **Microsoft 365 Copilot** (Word / Outlook / Teams / Copilot web). The library ships four sibling packages — one per ecosystem — so your existing tools become callable from each surface without the agent loop, the catalog, or the audit chain forking.

Each adapter is a **thin protocol shim**: it verifies the inbound signature, parses the wire format, hands the request to a single `Handler` callback (your agent loop), and translates outbound events back into the surface's native shape (Adaptive Cards / SSE / OpenAPI). No LLM is embedded — your existing backend runs unchanged.

```
                       ╔═══════════════════════════════════════════╗
                       ║   YOUR EXISTING AGENT LOOP (server-side)  ║
                       ║   one tool catalog · one audit chain      ║
                       ╚════╤══════════╤═══════════╤═══════════╤═══╝
                            │          │           │           │
              ┌─────────────┘    ┌─────┘     ┌─────┘     ┌─────┘
              │                  │           │           │
   ┌──────────▼─────┐  ┌─────────▼─────┐  ┌──▼─────────┐  ┌─▼─────────────────┐
   │ provideTeams   │  │ teams-bot     │  │ copilot-   │  │ copilot-studio-   │
   │ Context        │  │ middleware    │  │ skill mw   │  │ connector mw      │
   │ (in-app)       │  │ (server)      │  │ (server)   │  │ (server)          │
   │                │  │ JWT verify    │  │ ECDSA verify  │ AAD JWT verify    │
   │ getContext →   │  │ + AAD bearer  │  │ + OpenAI SSE  │ + Zod→OpenAPI mfst│
   │ TEAMS_CONTEXT  │  │ + AC cards    │  │   chunks      │ + AC response     │
   │ signal         │  │               │  │               │                   │
   └────┬───────────┘  └─────┬─────────┘  └─────┬───────┘  └────┬──────────────┘
        │                    │                  │                │
        ▼                    ▼                  ▼                ▼
  ┌──────────────┐  ┌──────────────────┐ ┌────────────────┐  ┌─────────────────┐
  │ Teams Tab    │  │ Teams chat       │ │ GitHub Copilot │  │ M365 Copilot    │
  │ (host the    │  │ (channel · DM ·  │ │ Chat           │  │ (Word · Outlook │
  │  Angular app │  │  group)          │ │ (@ediscovery)  │  │  · Teams · web) │
  │  in a tab)   │  │                  │ │                │  │                 │
  └──────────────┘  └──────────────────┘ └────────────────┘  └─────────────────┘
       P0                  P1                   P2                   P3
```

| Phase | Package | Surface | Wire format | Auth | Cookbook |
|-------|---------|---------|-------------|------|----------|
| P0 | `provideTeamsContext` (in-lib) | Teams Tab | n/a — embeds the Angular app | Teams SSO (host-side) | [teams-tab-embed](./cookbook/teams-tab-embed.md) |
| P1 | `@infra-tools/agentic-ui-teams-bot` | Teams chat | Bot Framework activities + Adaptive Cards | JWT verify against Bot Connector keys; AAD client-credentials for outbound | [teams-bot-adaptive-cards](./cookbook/teams-bot-adaptive-cards.md) |
| P2 | `@infra-tools/agentic-ui-copilot-skill` | GitHub Copilot Chat | Signed JSON webhook + OpenAI-shaped SSE | GitHub ECDSA P-256 signed-request verify | [github-copilot-extension](./cookbook/github-copilot-extension.md) |
| P3 | `@infra-tools/agentic-ui-copilot-studio-connector` | Microsoft 365 Copilot | Power Platform OpenAPI 2.0 + Adaptive Card response | Azure AD v2.0 JWT (tenant whitelist + JWKS) | [copilot-studio-connector](./cookbook/copilot-studio-connector.md) |

[ADR-041](./adr/0041-teams-copilot-external-surfaces.md) and [ADR-042](./adr/0042-copilot-studio-connector.md) document the design contracts. The integration plan that prioritised these four paths is at [docs/plans/teams-copilot-integration-plan.md](./plans/teams-copilot-integration-plan.md). All four are **additive** — runtime tier (`@infra-tools/agentic-ui`) is unchanged; adopters install only the adapters they need.
