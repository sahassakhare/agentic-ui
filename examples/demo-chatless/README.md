# demo-chatless

> **TravelOps — Account dashboard.** A product page that *looks* like a normal SaaS dashboard. There is no chat surface, no "ask the agent" affordance, no prompt previews, no tool-call traces. The cards on the page are filled by an LLM agent running in the background; the user has no idea the agent exists.

This is the [**CopilotKit "Chatless / Generative UI integrated into application UI"**](https://docs.copilotkit.ai/) pattern, applied with `@infra-tools/agentic-ui`.

> **Chatless (Generative UI integrated into application UI).** *The agent doesn't talk directly to the user. Instead, it communicates with the application through APIs, and the app renders generative UI from the agent as part of its native interface.*
>
> **Key traits:**
> - No chat surface at all.
> - App decides when and where generative UI appears.
> - Feels like a built-in product feature, rather than a conversation.
> - Ideal for dashboards, suggestions, and autonomous task helpers.
>
> **Examples:** Microsoft 365 Copilot (inline editing), Linear Insights, Superhuman AI triage, HubSpot AI Assist, Datadog Notebooks AI panels.

## Compliance map — CopilotKit traits → this demo

| CopilotKit trait | How this demo honours it |
|---|---|
| **No chat surface at all** | No `<mvk-chat-shell>` is mounted, no chat composer, no message bubbles, no transcript, no typing indicator, no "agent here" badge. The DOM contains **zero** `agent` / `chat` / `prompt` / `tool` strings (verified). |
| **App decides when and where generative UI appears** | The `app-root` component declares fixed sections (*Upcoming trips* · *Account* · *Open support*) at fixed layout positions. Each card's hidden prompt is **app-authored**, not user-typed. The agent populates the *contents*; the app owns the *frame*. |
| **Feels like a built-in product feature** | Topbar: "✦ TravelOps" + Refresh + user avatar — looks like any SaaS app. Cards show **skeleton placeholders** while loading, never a status pill or "streaming…" label. On error, a generic *"This section is temporarily unavailable"* — no agent verbiage. |
| **Ideal for dashboards / suggestions / autonomous helpers** | Four agent runs fire **in parallel** the moment the user opens the page. The user sees a populated dashboard — they don't have to ask for it. |

## What's running underneath

Each card on the page mounts an `<app-dashboard-card>`. That component:

1. Calls `injectAgenticChat()` — a fresh controller with its own `threadId`.
2. On mount (and again on Refresh), silently `chat.sendMessage(spec.prompt)` where `spec.prompt` is the **app-authored** string from `SECTIONS` in `app.ts` — the user never sees this string.
3. The reference agent backend (`examples/demo-server` → `gemini` agent) picks the matching tool from `ToolRegistry` (the shared `bookFlight` / `checkPoints` / `openTicket` from `@infra-tools/demo-shared-tools`).
4. The tool result's `components: [{ name, props }]` payload is rendered through `<mvk-widget-container>` — the resolved Angular component **becomes** the card's body. No chrome around it announces "this came from an agent."
5. If still loading, a shimmering skeleton fills the card. If errored, a generic placeholder.

Four cards, four concurrent agent threads, one dashboard. Zero chat UI.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ✦ TravelOps                                  [↻ Refresh]   SS              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Welcome back                                                               │
│   Here's what's happening with your account.                                 │
│                                                                              │
│   UPCOMING TRIPS                                                             │
│   ┌─────────────────────────────┐ ┌─────────────────────────────┐            │
│   │  ✈  LAX → JFK  · confirmed  │ │  ✈  LAX → ATL  · confirmed  │            │
│   │     2026-06-15              │ │     2026-07-04              │            │
│   │     Booking BK-…            │ │     Booking BK-…            │            │
│   └─────────────────────────────┘ └─────────────────────────────┘            │
│                                                                              │
│   ACCOUNT                                                                    │
│   ┌─────────────────────────────────────────────────────────────────┐        │
│   │  ★  Points balance · Gold                                       │        │
│   │     127,450                                                     │        │
│   └─────────────────────────────────────────────────────────────────┘        │
│                                                                              │
│   OPEN SUPPORT                                                               │
│   ┌─────────────────────────────────────────────────────────────────┐        │
│   │  ✉  Refund delayed  · HIGH                                      │        │
│   │     Status: open · Ticket TK-…                                  │        │
│   └─────────────────────────────────────────────────────────────────┘        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

(The widget designs above — `flightCard`, `pointsCard`, `ticketCard` — are normal Angular components registered by name in `ComponentRegistry`. The agent didn't draw them; it just picked which one to render with which props.)

## What this demonstrates

| | The chat-shell demos (`demo-monolith`, `demo-shell`, …) | **This demo** |
|---|---|---|
| `<mvk-chat-shell>` mounted | ✓ | **✗** |
| User-visible "agent" affordances (composer, transcript, prompt input) | ✓ | **✗** |
| Generative UI dispatch | ✓ via `<mvk-widget-container>` | ✓ via `<mvk-widget-container>`, in-place on the dashboard |
| Concurrent agent runs (different threads) | one | **four** (one per card) |
| Agent backend | AG-UI / Hashbrown / A2UI | **AG-UI** |
| Tool calls fire? | ✓ (model-routed by user prompt) | ✓ (model-routed by **app-authored** prompts) |

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

Open <http://localhost:4207>. The four cards fill in as each agent run completes. No prompt, no composer, no chat — just data appearing.

## File map

| File | What it does |
|---|---|
| `src/app/app.config.ts` | `provideAgenticUiPlatform({ tools: sharedTools, widgets, transport: provideAgUiBackend(...) })`. One call, zero chat-specific providers. |
| `src/app/app.ts` | The product shell — TravelOps topbar, three labeled sections, four cards. Owns the global `refreshTick` signal the cards listen to. **No `<mvk-chat-shell>` import.** |
| `src/app/dashboard-card.component.ts` | One card = one `injectAgenticChat()` controller. Auto-fires the app-authored prompt on mount via `effect()`. Renders skeleton → widget(s) via `<mvk-widget-container>` → generic error placeholder. **No agent affordances exposed to the UI.** |
| `src/app/widgets/{flight,points,ticket}-card.component.ts` | Normal Angular components — the design system. Selected by name when the agent emits `components: [{ name, props }]`. |
| `src/app/widgets/widgets.ts` | Wires the three components into `ComponentRegistry` via `agenticWidget({ name, component, propsSchema })`. |

## Why this pattern matters

The agent isn't a chat box; it's a *capability source*. Once a tool is registered and a widget is registered for its result shape, the agent can populate **any** UI surface — a dashboard card, a Linear-style insight, an M365 inline rewrite, a Superhuman triage badge, a Datadog Notebooks AI panel — and the user just sees a better product.

For the library's first-class registry-driven dashboard surface (with `DashboardRegistry`, `<mvk-dashboard-canvas>`, `<mvk-dashboard-tile>`, `TileResultCache`, drilldown + explain events, refresh strategies, federated tiles), see [`docs/cookbook/dashboards.md`](../../docs/cookbook/dashboards.md) and [ADR-044](../../docs/adr/0044-dashboard-registry.md). This demo intentionally rolls its own minimal card component to stay tightly focused on the CopilotKit chatless thesis: **the user shouldn't be able to tell the agent is there.**
