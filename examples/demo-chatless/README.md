# demo-chatless

> A dashboard of tiles that **each run an agent turn**, in parallel — with **no `<mvk-chat-shell>`**.

The whole point of `@infra-tools/agentic-ui` isn't the chat rail — it's the agent loop, the registries, and the generative-UI dispatch. This demo proves that point by mounting **no `<mvk-chat-shell>` at all** and using `injectAgenticChat()` programmatically from *each tile* on a dashboard canvas. Every tile owns its own thread, its own run, its own loading state. They stream in parallel; their results render through `<mvk-widget-container>` in-tile.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│   demo-chatless  (Angular app, no <mvk-chat-shell>)                         │
│                                                                             │
│   ┌── Header ──────────── endpoint · refreshes · [↻ Refresh all] ─────────┐ │
│   ├─────────────────────────────────────────────────────────────────────────┤ │
│   │                                                                       │ │
│   │   ┌─ tile A ─────────┐   ┌─ tile B ─────────┐                         │ │
│   │   │ ✈ Flight to JFK  │   │ ✈ Flight to ATL  │                         │ │
│   │   │ status: streaming│   │ status: ready    │                         │ │
│   │   │ <widget          │   │ <widget          │                         │ │
│   │   │   flightCard />  │   │   flightCard />  │                         │ │
│   │   │ tools: bookFlight│   │ tools: bookFlight│                         │ │
│   │   └──────────────────┘   └──────────────────┘                         │ │
│   │                                                                       │ │
│   │   ┌─ tile C ─────────┐   ┌─ tile D ─────────┐                         │ │
│   │   │ ★ Loyalty status │   │ ✉ Support ticket │                         │ │
│   │   │ <widget          │   │ <widget          │                         │ │
│   │   │   pointsCard />  │   │   ticketCard />  │                         │ │
│   │   └──────────────────┘   └──────────────────┘                         │ │
│   │                                                                       │ │
│   │   each tile = independent injectAgenticChat() thread                  │ │
│   │   per-tile [↻] refresh + global [↻ Refresh all]                       │ │
│   └─────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │
                                         ▼
                          examples/demo-server :4111
                          /agents/gemini/run  (one backend, four parallel runs)
                          (runs the shared tools from
                           @infra-tools/demo-shared-tools)
```

## What's dynamic about it

- **Four tiles, four parallel agent runs**, each fired on mount. No user click required to see the UI come alive.
- **Independent per-tile state** — one tile loading, one tile ready, one tile errored, all rendered simultaneously, because each tile holds its own `injectAgenticChat()` controller and thus its own `threadId` / `isLoading` / `error` signals.
- **Skeleton placeholders** while a tile streams; **status pill** (idle / streaming / ready / error) per tile.
- **Per-tile `↻` refresh** re-runs that tile's prompt; **global `↻ Refresh all`** in the header re-runs every tile by bumping a shared signal each tile's `effect()` listens for.
- **Tool-call trace** in each tile's footer (which tool fired, in lowercase).

The runtime tier is genuinely chat-agnostic. The same `ToolRegistry`, `ComponentRegistry`, `injectAgenticChat()` controller, and `<mvk-widget-container>` resolution work whether the user is conversing in chat or watching tiles light up on a dashboard.

## What this demonstrates

| | The chat-shell demos (`demo-monolith`, `demo-shell`, …) | **This demo** |
|---|---|---|
| `<mvk-chat-shell>` mounted? | ✓ | **✗** |
| Chat transcript visible to the user? | ✓ | **✗** |
| Concurrent agent runs (different threads)? | one | **four** (one per tile) |
| Agent backend? | AG-UI / Hashbrown / A2UI | **AG-UI** |
| Tool calls fire? | ✓ (model-routed) | ✓ (model-routed, four in parallel) |
| Generative UI? | ✓ via `<mvk-widget-container>` | ✓ via `<mvk-widget-container>`, in-tile |
| Chat-only affordances (composer / typing / message bubbles) | ✓ | **✗** |

## Run it

You need the reference agent server running on `:4111` with a Gemini key:

```bash
# Terminal 1 — the reference server (one-time setup).
cd examples/demo-server
cp .env.example .env
# add GOOGLE_GENERATIVE_AI_API_KEY=… to .env
npm install
npm run dev     # :4111

# Terminal 2 — the chatless dashboard.
cd ../..
npm run build:lib                  # produces dist/agentic-ui (cached)
npm install ./dist/agentic-ui --no-save
npx ng serve demo-chatless         # :4207
```

Open <http://localhost:4207>. The four tiles fire automatically; widgets mount as each agent run completes.

## File map

| File | What it does |
|---|---|
| `src/app/app.config.ts` | `provideAgenticUiPlatform({ tools: sharedTools, widgets, transport: provideAgUiBackend(...) })`. One call, no chat-specific providers. |
| `src/app/app.ts` | The shell — header + grid of `<app-task-tile>`s. Owns the global `refreshTick` signal that fans out to every tile. **No `<mvk-chat-shell>` import.** |
| `src/app/task-tile.component.ts` | One tile = one `injectAgenticChat()` controller. Auto-fires on mount via `effect()` watching `refreshTick`. Renders skeleton → widget(s) via `<mvk-widget-container>`. Per-tile `↻` reruns the prompt. |
| `src/app/widgets/{flight,points,ticket}-card.component.ts` | The three Angular components the agent picks by name (`flightCard` / `pointsCard` / `ticketCard`) — same names the shared tools emit in `components: [{ name, props }]`. |
| `src/app/widgets/widgets.ts` | Wires the three components into the registry via `agenticWidget({ name, component, propsSchema })`. |

## Why this pattern matters

It's the simplest proof of the [post-chat-surfaces](../../docs/plans/post-chat-surfaces-plan.md) thesis: the agent isn't a chat box; it's a *capability source*. Once a tool is registered and a widget is registered for its result shape, the agent can be driven from any UI affordance — a button, a ⌘K palette, a scheduled trigger, **a dashboard tile**, a row-action menu — and the result renders the same way. The chat shell is one consumer among many; the dashboard is another.

For the library's first-class dashboard infrastructure (with `DashboardRegistry`, `<mvk-dashboard-canvas>`, `<mvk-dashboard-tile>`, `TileResultCache`, drilldown + explain events, refresh strategies, federated tiles), see [`docs/cookbook/dashboards.md`](../../docs/cookbook/dashboards.md) and [ADR-044](../../docs/adr/0044-dashboard-registry.md). This demo intentionally rolls its own tile component to stay tightly focused on showing the chat-less agent-loop path; the production dashboard surface uses the registry-driven canvas.
