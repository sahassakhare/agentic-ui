# demo-chatless

> A minimal Angular app that **talks to an agent backend without a chat shell**.

The whole point of `@infra-tools/agentic-ui` isn't the chat rail — it's the agent loop, the registries, and the generative-UI dispatch. This demo proves that point by mounting **no `<mvk-chat-shell>` at all**. Instead, it:

- Wires the **AG-UI backend** to the bundled reference server (`examples/demo-server`).
- Uses `injectAgenticChat()` programmatically to fire a turn when the user clicks a task card.
- Renders the agent-emitted widgets through `<mvk-widget-container>` in a dedicated results pane — same `ComponentRegistry` resolution path the chat shell uses, no chat transcript.

```
┌─────────────────────────────────────────────────────────────────┐
│   demo-chatless  (Angular app, no <mvk-chat-shell>)             │
│                                                                 │
│   ┌─ Task launcher ─┐         ┌─ Results pane ────────────────┐ │
│   │ ✈ Book flight   │ click→  │  "Booking confirmed..."        │ │
│   │ ★ Check points  │         │  <mvk-widget-container         │ │
│   │ ✉ Open ticket   │         │     [widget]="flightCard" />   │ │
│   └─────────────────┘         └────────────────────────────────┘ │
│            │                            ▲                       │
│            │ chat.sendMessage(prompt)    │ AgenticMessage.widgets│
│            ▼                            │                       │
│        injectAgenticChat() ───────►  AG-UI backend (SSE)        │
└────────────────────────────────────────────┬────────────────────┘
                                             │
                                             ▼
                              examples/demo-server :4111
                              /agents/gemini/run
                              (runs the shared tools from
                               @infra-tools/demo-shared-tools)
```

## What this demonstrates

| | The chat-shell demos (`demo-monolith`, `demo-shell`, …) | **This demo** |
|---|---|---|
| `<mvk-chat-shell>` mounted? | ✓ | **✗** |
| Chat transcript visible to the user? | ✓ | **✗** |
| Agent backend? | AG-UI / Hashbrown / A2UI | **AG-UI** |
| Tool calls fire? | ✓ (model-routed) | ✓ (model-routed via fixed task prompts) |
| Generative UI? | ✓ via `<mvk-widget-container>` | ✓ via `<mvk-widget-container>` |
| Chat-only UI affordances (composer / typing indicator / message bubbles) | ✓ | **✗** |

The runtime tier is genuinely chat-agnostic. The same `ToolRegistry`, `ComponentRegistry`, `injectAgenticChat()` controller, and `<mvk-widget-container>` resolution work whether the user is conversing in chat or clicking task cards.

## Run it

You need the reference agent server running on `:4111` with a Gemini key — the chatless app sends prompts like *"Book a flight from LAX to JFK on 2026-06-15"* and the agent's tool selection drives the demo:

```bash
# Terminal 1 — the reference server (one-time setup).
cd examples/demo-server
cp .env.example .env
# add GOOGLE_GENERATIVE_AI_API_KEY=… to .env
npm install
npm run dev     # :4111

# Terminal 2 — the chatless app.
cd ../..
npm run build:lib                  # produces dist/agentic-ui (cached)
npm install ./dist/agentic-ui --no-save
npx ng serve demo-chatless         # :4207
```

Open <http://localhost:4207>. Click any task card; the result widget should mount in the results pane within a second or two.

## File map

| File | What it does |
|---|---|
| `src/app/app.config.ts` | `provideAgenticUiPlatform({ tools: sharedTools, widgets, transport: provideAgUiBackend(...) })`. One call, no chat-specific providers. |
| `src/app/app.ts` | The shell — task launcher + results pane. Calls `injectAgenticChat().sendMessage(prompt)` on click; renders `lastReply().widgets` via `<mvk-widget-container>`. **No `<mvk-chat-shell>` import.** |
| `src/app/widgets/{flight,points,ticket}-card.component.ts` | The three Angular components the agent picks by name (`flightCard` / `pointsCard` / `ticketCard`) — same names the shared tools emit in `components: [{ name, props }]`. |
| `src/app/widgets/widgets.ts` | Wires the three components into the registry via `agenticWidget({ name, component, propsSchema })`. |

## Why this pattern matters

It's the simplest proof of the [post-chat-surfaces](../../docs/plans/post-chat-surfaces-plan.md) thesis: the agent isn't a chat box; it's a *capability source*. Once a tool is registered and a widget is registered for its result shape, the agent can be driven from any UI affordance — a button, a ⌘K palette, a scheduled trigger, a dashboard tile drilldown, a row-action menu — and the result renders the same way. The chat shell is one consumer among many.
