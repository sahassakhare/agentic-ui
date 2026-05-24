# Demo applications

The repository ships **sixteen reference applications** under `examples/` (fifteen runnable apps + one shared domain library). They cover four patterns: single-process showcases, federated MFEs, agent backends, and a flagship enterprise reference.

## 🏛 Flagship — enterprise eDiscovery reference (Phases 0–7 shipped)

A multi-pane regulated-domain reference app built across the eight phases in [docs/plans/ediscovery-app-plan.md](./plans/ediscovery-app-plan.md) plus the six dynamic-UI capabilities (F1–F6) from the [r3 plan](./plans/ediscovery-dynamic-ui-plan.md). Exercises every load-bearing library feature simultaneously: 25+ tools across 4 specialists, 3 federated MFE remotes, all 18 registries (including F4 `ApprovalRegistry` + F5 `OperationRegistry` + the post-chat-surfaces `TriggerRegistry` / `DashboardRegistry` / `PlaybookRegistry`), tamper-evident chain-of-custody audit (extended with `tool-approved` / `tool-rejected` / `operation-*` event kinds), MCP for analyst workstations, persona-scoped permission filtering, `/approvals` queue + `/operations` panel routes. **Drop the eight phases plus F1–F6 in here for the headline architectural story.**

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
- **Phase 6** — MCP server (`@infra-tools/demo-ediscovery-mcp`) for analyst workstations
- **Phase 7** — persona permission shim (5 personas, allow-listed tools, live tool-count badge)

## Single-process examples

| App | Purpose | Port |
|-----|---------|------|
| `demo-monolith` | Single-app, single-agent demo. Tools and widgets registered locally; no federation moving parts. | 4202 |
| `demo-multi-agent` | One host, multiple agents. Registers tools + widgets for three domains inline; the orchestrator on the server classifies each turn and forwards events from the chosen specialist. | 4204 |
| `demo-feature-tour` | Extended-registry showcase. Demonstrates the four library capabilities not covered by the other demos: `ActionRegistry` (agent-triggered navigation + toasts), `FormRegistry` (`<mvk-form-renderer>`), `DataSourceRegistry` (typed REST adapter), and an `IntentRegistry` entry for pre-LLM short-circuit. | 4206 |

## Federated example — one app per domain, one agent per app

| App | Purpose | Port |
|-----|---------|------|
| `demo-shell` | Native Federation host. Discovers remotes via `MfeRegistryClient`, blocks bootstrap until each `Capability` registers via `provideAppInitializer`. Talks to `/agents/orchestrator/run`. | 4200 |
| `demo-remote-bookings` | Bookings MFE remote. Exposes `./Capability` with `bookFlightTool` + `flightCardWidget`. **Also has its own form-driven UI** at `:4201` that calls the same handler and renders the same widget. | 4201 |
| `demo-remote-loyalty` | Loyalty MFE remote. Exposes `./Capability` with `checkPointsTool`, `redeemPointsTool`, and `pointsCardWidget`. **Also has its own UI** at `:4203` (check balance + redeem) that reuses the same handlers and widget. | 4203 |
| `demo-remote-support` | Support MFE remote. Exposes `./Capability` with `openTicketTool`, `checkTicketTool`, and `ticketCardWidget`. **Also has its own UI** at `:4205` (open + check ticket) reusing the same handlers and widget. | 4205 |

## Backend

| App | Purpose | Port |
|-----|---------|------|
| `demo-server` | Hono SSE agent server. Hosts six `ServerAgent` implementations under one process: `EchoAgent`, the single-domain `GeminiAgent`, three specialists (`bookings`, `loyalty`, `support`), and an `OrchestratorAgent` that classifies each turn and forwards events from the chosen specialist. | 4111 |

## Quick start — single-process multi-agent (`demo-multi-agent`)

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

## Quick start — federated, one app per domain (`demo-shell` + remotes)

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

### Each remote is also a standalone app

Open <http://localhost:4201>, <http://localhost:4203>, and <http://localhost:4205> directly to see each domain MFE running on its own with a real form-driven UI. The standalone UIs call the **same tool handlers** and render the **same widget components** the agent uses — proving each MFE is a complete domain artefact, not a chat-only shim. The capability surface (`./Capability` exposed via federation) is unchanged; the host shell at `:4200` keeps consuming each remote exactly as before.
