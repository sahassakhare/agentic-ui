# Multi-agent orchestration

Pattern: one orchestrator agent classifies the user's intent and forwards the
event stream from a chosen specialist agent. Each specialist has its own
system prompt and focus area; the host's tool and component registries are
passed through untouched, so generative-UI widgets and client-side tool calls
keep working transparently.

This guide walks you through the working example in
[`projects/demo-multi-agent`](../../projects/demo-multi-agent) and the
[`OrchestratorAgent`](../../projects/demo-server/src/orchestrator-agent.ts)
in the demo server.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Browser — host app (demo-multi-agent, port 4204)                              │
│                                                                              │
│   <mvk-chat-shell> — speaks AG-UI to /agents/orchestrator/run                 │
│                                                                              │
│   ToolRegistry: bookFlight · cancelFlight                                     │
│                 checkPoints · redeemPoints                                    │
│                 openTicket · checkTicket                                      │
│   ComponentRegistry: flightCard · pointsCard · ticketCard                     │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │ AG-UI SSE
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Agent server — single Node process (demo-server, port 4111)                  │
│                                                                              │
│   /agents/orchestrator/run  →  OrchestratorAgent                             │
│                                                                              │
│       1. classify(userText)      [one quick LLM call]                        │
│              │                                                               │
│              ▼                                                               │
│       { agent: "bookings" | "loyalty" | "support" | "none", reason }         │
│              │                                                               │
│              ▼                                                               │
│       forward sub-agent events verbatim                                      │
│       (strip RUN_STARTED / RUN_FINISHED — those belong to the orchestrator)  │
│                                                                              │
│   /agents/bookings/run    →  GeminiAgent("bookings", booking system prompt)   │
│   /agents/loyalty/run     →  GeminiAgent("loyalty",  loyalty system prompt)   │
│   /agents/support/run     →  GeminiAgent("support",  support system prompt)   │
│                                                                              │
│   Each specialist can ALSO be talked to directly — the orchestrator is not    │
│   in the way; the chat shell just chooses which URL to point at.              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Why classification + forwarding (not delegate-as-tool)

Two patterns are commonly conflated:

| Pattern | How it works | Trade-off |
|---|---|---|
| **Classification + forwarding** (this example) | Orchestrator picks one specialist per turn, then forwards its event stream verbatim. The chat shell sees one continuous AG-UI stream. | Tool calls, generative-UI widgets, and text deltas all work without extra plumbing. One commit per turn — no in-turn agent hopping. |
| **Delegate-as-tool** | Orchestrator has tools like `askBookings({query})`. Each tool's handler opens a separate AG-UI stream to the specialist and collects text. | Multiple agents can be combined in one turn, but specialist tool calls / widgets must round-trip through the orchestrator's transcript, which adds layers and breaks the single-stream model. |

Both work. The classification + forwarding model is what the demo ships
because it preserves AG-UI fidelity — you don't lose anything by routing
through it. If you later need cross-specialist composition in a single turn,
graduate to a planner-executor (an `IntentRegistry`-driven planner that
issues a sequence of specialist calls).

## Server: register the orchestrator alongside specialists

[`projects/demo-server/src/server.ts`](../../projects/demo-server/src/server.ts)
wires four LLM-backed agents under one Hono process:

```ts
const bookingsAgent = new GeminiAgent('bookings', { apiKey, model, systemInstruction: '…' });
const loyaltyAgent  = new GeminiAgent('loyalty',  { apiKey, model, systemInstruction: '…' });
const supportAgent  = new GeminiAgent('support',  { apiKey, model, systemInstruction: '…' });

const orchestrator = new OrchestratorAgent('orchestrator', {
  apiKey,
  model,
  subAgents: [
    {
      id: 'bookings',
      agent: bookingsAgent,
      description: 'flight search, booking, cancellation, schedule changes',
      examples: ['Book a flight from LAX to JFK on March 5', 'Cancel my booking BK-XXX'],
    },
    {
      id: 'loyalty',
      agent: loyaltyAgent,
      description: 'points balance, tier status, reward redemption',
      examples: ['How many points do I have?', 'Redeem 25,000 points for a flight'],
    },
    {
      id: 'support',
      agent: supportAgent,
      description: 'support tickets, account problems, complaints',
      examples: ['Open a ticket for my refund', 'My account is locked'],
    },
  ],
});

agents.set('bookings',     bookingsAgent);
agents.set('loyalty',      loyaltyAgent);
agents.set('support',      supportAgent);
agents.set('orchestrator', orchestrator);
```

The `description` and `examples` you pass for each specialist anchor the
classifier — they become the prompt the routing LLM sees. Treat them like
documentation: write the way you'd want a colleague to skim them.

## Host: register tools and widgets for every domain

The orchestrator forwards `input.tools` and `input.widgets` to whichever
specialist it picks, so the host registers the union of every domain's
capabilities:

```ts
// projects/demo-multi-agent/src/app/agentic/agentic.ts
export const tools: ToolDef[] = [
  bookFlightTool, cancelFlightTool,                 // bookings
  checkPointsTool, redeemPointsTool,                // loyalty
  openTicketTool, checkTicketTool,                  // support
];

export const widgets: ComponentDef[] = [
  flightCardWidget, pointsCardWidget, ticketCardWidget,
];
```

Each specialist's system prompt instructs it to use only the tools relevant
to its domain — and to politely defer when asked something out of scope.
That's the full multi-agent contract: the host owns the toolbox, specialists
own the personality and judgment.

## Federation note

In a real federated app each domain's tools and widgets would live in its
own MFE remote (one team owns bookings, another owns loyalty, etc.) and be
loaded via [`loadRemoteCapabilities`](./federate-an-mfe.md). The orchestrator
contract is unchanged — it still forwards whatever's in the host's
registries. Per-app agent ownership is just per-team capability ownership;
the routing layer is what unifies them for the user.

## Run it

```bash
# In one terminal, with GOOGLE_GENERATIVE_AI_API_KEY in projects/demo-server/.env
cd projects/demo-server
npm install
npx tsx src/server.ts

# In another terminal, from the workspace root
npm install
npm run build:lib
npm install ./dist/agentic-ui --no-save
npx ng serve demo-multi-agent
```

Open http://localhost:4204 and try:

| Prompt | Routes to | What you should see |
|---|---|---|
| `Book a flight from LAX to JFK on March 5` | bookings | "_Routed to **bookings** specialist._" → `bookFlight` tool call → flight card |
| `How many loyalty points do I have?` | loyalty | "_Routed to **loyalty** specialist._" → `checkPoints` tool call → points card |
| `Open a support ticket — my refund hasn't arrived` | support | "_Routed to **support** specialist._" → `openTicket` tool call → ticket card |
| `What is the airspeed velocity of an unladen swallow?` | none | Orchestrator falls back to a "no specialist matched" message |

You can also bypass the orchestrator and chat with a specialist directly by
pointing `environment.agentUrl` at `http://localhost:4111/agents/bookings/run`
(or `/loyalty/run`, `/support/run`).

## Extending

- **Swap the classifier**: subclass `OrchestratorAgent`, override `classify()`.
  A keyword router (no LLM call) is one line; an `IntentRegistry`-backed
  router stays type-safe.
- **Per-specialist context**: thread custom system prompts or memory in via
  the specialist's `GeminiAgent` config — the orchestrator doesn't care.
- **Per-app agents**: in a real MFE deployment, each remote can register a
  capability that includes both its tools/widgets AND a hint about which
  specialist it expects. The orchestrator config can then be assembled at
  boot from the loaded `CapabilityRegistry` snapshot.
