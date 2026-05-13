# User Guide — `@infra-tools/agentic-ui` MFE Demo

Goal: in ~10 minutes, get an Angular **host** app + an Angular **MFE remote** + a **Gemini-backed agent server** running locally, and see the LLM call a tool from the remote and render its widget in the host. Step-by-step from a fresh clone.

---

## What you'll see when it works

A chat panel where you type:

> Book me a flight from LAX to JFK on 2026-05-15

…and Gemini responds with:
- A **tool-call line** (`→ bookFlight({"from":"LAX","to":"JFK","date":"2026-05-15"})`).
- A **tool-result line** with the booking ID.
- A **boxed flight-card UI component** rendered with the booking details — and that component is defined in a *separate microfrontend* the host loaded at runtime.
- Gemini's natural-language confirmation message.

The boxed card is the proof point. Every layer of the lib (registries, AG-UI adapter, federation, Zod-validated handoffs, generative UI) is exercised end-to-end.

---

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node.js | 20.19+ (≤ 25.x) | Angular 21 + Hono need a recent Node. |
| npm | 10+ | Workspace install. |
| A Google API key | free tier OK | https://aistudio.google.com/apikey — enables the Gemini agent. Without it the demo falls back to an Echo agent (still useful, but no real LLM). |

---

## Step 1 — Install dependencies

From the workspace root:

```bash
npm install
cd examples/demo-server && npm install && cd ../..
```

The first one installs Angular 21, the lib's peer deps, federation runtimes, etc. The second installs Hono + the Google Gen AI SDK for the agent server.

---

## Step 2 — Add your Gemini key

```bash
cp examples/demo-server/.env.example examples/demo-server/.env
```

Open `examples/demo-server/.env` in your editor and paste your key:

```
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
```

> The `.env` file is git-ignored — your key won't be committed.

If you skip this step the demo still runs (against the Echo agent at `/agents/echo/run`); you'll just see word-by-word echoes instead of LLM responses.

---

## Step 3 — Build the library

```bash
npm run build:lib
```

This builds `dist/agentic-ui` (a single primary entry — see [ADR-005](./adr/0005-single-primary-entry.md)) and copies the schematics. Both demo apps reference the lib via `node_modules/@infra-tools/agentic-ui` which is linked to `dist/agentic-ui` via the workspace `package.json`'s `file:` dep.

You'll see output ending with:

```
✔ Built @infra-tools/agentic-ui
Build at: ... - Time: ~5s
```

---

## Step 4 — Open three terminals

You need three processes running concurrently. Open three terminals in the workspace root.

### Terminal 1: agent server

```bash
cd examples/demo-server
npm run dev
```

Wait for:

```
[demo-server] listening on http://localhost:4111
[demo-server]   /health           http://localhost:4111/health
[demo-server]   echo agent (no LLM)   POST http://localhost:4111/agents/echo/run
[demo-server]   gemini agent          POST http://localhost:4111/agents/gemini/run
```

If you see `gemini agent NOT configured`, your `.env` isn't being read — check the path and the variable name (`GOOGLE_GENERATIVE_AI_API_KEY`).

Sanity check from another terminal:

```bash
curl http://localhost:4111/health
# → {"ok":true,"agents":["echo","gemini"],"geminiConfigured":true}
```

### Terminal 2: MFE remote

```bash
npx ng serve demo-remote-bookings
```

Wait for:

```
Application bundle generation complete. ...
  ➜  Local:   http://localhost:4201/
```

Sanity check:

```bash
curl -I http://localhost:4201/remoteEntry.json
# → HTTP/1.1 200 OK
```

The remote exposes one module: `./Capability` (its [`capability.ts`](../examples/demo-remote-bookings/src/app/capability.ts)) which contributes the `bookFlight` tool and `flightCard` widget.

### Terminal 3: host shell

```bash
npx ng serve demo-shell
```

Wait for:

```
Application bundle generation complete. ...
  ➜  Local:   http://localhost:4200/
```

The shell uses `provideAppInitializer` to call `loadRemoteCapabilities` *before* rendering — Angular won't show the chat panel until the remote has registered its capabilities.

---

## Step 5 — Open the app

Open http://localhost:4200 in a browser tab.

### What to verify before typing anything

Open DevTools → Console. You should see:

```
[demo-shell] Remote loaded: demo-remote-bookings (1 tool(s), 1 widget(s))
Angular is running in development mode.
```

> If you see `NG0912: Component ID generation collision` warnings, the federation isn't deduplicating the lib correctly — see [Troubleshooting](#troubleshooting) below.

The page header should read:

```
Capabilities: 1 tool(s) across 1 remote(s): demo-remote-bookings
```

That string is computed from `CapabilityRegistry.list()` and proves the federation handshake worked.

---

## Step 6 — Test the demo

### Test A: streaming text (no tools)

Type **`Hi, what can you do?`**

Expected: Gemini introduces itself as a flight booking assistant, streamed word-by-word into a single assistant bubble.

This validates: chat shell ↔ AG-UI adapter ↔ SSE ↔ agent server ↔ Gemini, plus signal-based delta accumulation.

### Test B: tool calling + generative UI (the headline)

Type **`Book me a flight from LAX to JFK on 2026-05-15`**.

Expected transcript:

```
─── user bubble ──────────────────────────────────
Book me a flight from LAX to JFK on 2026-05-15

─── assistant bubble ─────────────────────────────
→ bookFlight({"from":"LAX","to":"JFK","date":"2026-05-15"})
  ⇒ {"bookingId":"BK-XXXXXX","from":"LAX","to":"JFK","date":"2026-05-15","status":"confirmed",components:[…]}

  ┌─ flight-card widget ───────────────┐
  │  LAX → JFK              ✓ confirmed │
  │  2026-05-15                          │
  │  Booking: BK-XXXXXX                 │
  └─────────────────────────────────────┘

  Your flight from LAX to JFK on 2026-05-15 has been booked!
  Booking confirmation: BK-XXXXXX.
```

The boxed card is `FlightCardComponent`, a standalone Angular component **defined in the remote MFE**, dynamically rendered by the host through `<mvk-widget-container>` via `*ngComponentOutlet`.

### Test C: backend swap

Stop the agent server (Ctrl-C in Terminal 1), then change line ~7 of [`examples/demo-shell/src/app/app.config.ts`](../examples/demo-shell/src/app/app.config.ts):

```ts
const AGENT_URL = 'http://localhost:4111/agents/gemini/run';
// Change to:
const AGENT_URL = 'http://localhost:4111/agents/echo/run';
```

Restart the agent server (`npm run dev` in Terminal 1). Vite will hot-reload the host. Type any message — the response is `You said: <message>` streamed word-by-word.

Same chat shell. Same registries. Same MFE-loaded tools. Just a different backend behind the `AgenticBackend` interface. Switch back to `gemini` when done.

---

## Step 7 — Stop everything

Hit Ctrl-C in each terminal. Or:

```bash
kill $(lsof -ti:4111)   # agent server
kill $(lsof -ti:4200)   # host
kill $(lsof -ti:4201)   # remote
```

---

## Troubleshooting

### Header reads `0 tool(s)` or `no remotes loaded`

The MFE remote didn't load. Check:

- Is `demo-remote-bookings` running on port 4201? `curl -I http://localhost:4201/remoteEntry.json` must return 200.
- Browser DevTools → Network: look for a `Capability.js` request to `:4201`. If it's failing, check the Console for the actual error.
- Is `node_modules/@infra-tools/agentic-ui` linked to `dist/agentic-ui`? If you reinstalled and the build went stale, run `npm run build:lib && rm -rf node_modules/@infra-tools && npm install`.

### `NG0912: Component ID generation collision detected`

The lib is being loaded twice (once in the host bundle, once in the remote bundle) instead of being shared via federation. Check:

- Both `examples/demo-shell/federation.config.js` and `examples/demo-remote-bookings/federation.config.js` have `'@infra-tools/agentic-ui'` in their `shared` block AND `features: { ignoreUnusedDeps: false }`.
- `dist/agentic-ui` exists and was built recently.
- Hard-refresh the browser (Cmd-Shift-R / Ctrl-Shift-R) — Vite dev server may be serving a cached chunk.

### `Error: Unable to resolve specifier '@infra-tools/agentic-ui'`

Same root cause as NG0912 from a different angle — the federation importmap doesn't have an entry for the lib. Check the same federation config items, then restart the dev server (federation manifest is built once at boot).

### Gemini returns `"NOT_FOUND"` or `models/X is not found`

The model id is stale. Edit `examples/demo-server/src/gemini-agent.ts` (`config.model ?? 'gemini-2.5-flash'`) or set `GEMINI_MODEL` in `.env`. List available models for your key:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_GENERATIVE_AI_API_KEY" \
  | python3 -c "import json,sys; [print(m['name']) for m in json.load(sys.stdin)['models'] if 'generateContent' in m.get('supportedGenerationMethods',[])]"
```

### Tool not called — Gemini asks clarifying questions instead

Most likely the chat shell sent an empty `tools` array because the remote hadn't finished loading. Check:

- The Console shows `[demo-shell] Remote loaded:` *before* you type. If not, the boot sequence isn't blocking on the remote load — verify [`examples/demo-shell/src/app/app.config.ts`](../examples/demo-shell/src/app/app.config.ts) uses `provideAppInitializer` (returns the loadRemote promise), not the older `provideEnvironmentInitializer` (fire-and-forget).

### Port already in use (`EADDRINUSE`)

Free the port:

```bash
kill $(lsof -ti:4111)   # or 4200, 4201
```

---

## Use cases

This library is opinionated for one shape of work — agent-driven UI in Angular — but within that shape it covers a handful of distinct scenarios that real apps need. The matrix lists them; each subsection below walks through the wiring with a code skeleton and links to a cookbook entry for depth.

| # | Use case | What the library does | Cookbook |
|---|---|---|---|
| 1 | [Generative UI — agent picks the component](#1-generative-ui--agent-picks-the-component) | `ComponentRegistry` + `<maverick-widget-container>` mount Angular components by name with Zod-validated props | [quickstart](./cookbook/quickstart.md) |
| 2 | [Tool calling with state mutation](#2-tool-calling-with-state-mutation) | `ToolRegistry` handlers, `tool-call-*` events, abort signals | [extended-registries-feature-tour](./cookbook/extended-registries-feature-tour.md) |
| 3 | [Federating MFE remotes](#3-federating-mfe-remotes) | `defineCapabilityModule` + `loadRemoteCapabilities`; native + webpack federation | [federate-an-mfe](./cookbook/federate-an-mfe.md) |
| 4 | [Per-persona entitlement](#4-per-persona-entitlement) | `RegistryBase.setScopePolicy(...)` filters every read | this guide (below) |
| 5 | [Backend swap (AG-UI ↔ Hashbrown ↔ A2UI)](#5-backend-swap-ag-ui--hashbrown--a2ui) | `AgenticBackend` interface — chat shell never sees the protocol | [swap-backend](./cookbook/swap-backend.md) |
| 6 | [Multi-agent orchestration with sticky routing](#6-multi-agent-orchestration-with-sticky-routing) | `OrchestratorAgent` + per-thread sticky state | [multi-agent-orchestration](./cookbook/multi-agent-orchestration.md) |
| 7 | [Per-turn tool budget at scale](#7-per-turn-tool-budget-at-scale) | `provideToolFilter` + `keywordToolFilter` for 17+ tool inventories | [federation-at-scale](./cookbook/federation-at-scale.md) |
| 8 | [MCP — same tools power analyst desktops](#8-mcp--same-tools-power-analyst-desktops) | `@infra-tools/agentic-ui-mcp` exposes ToolDefs as an MCP server | [mcp-server](./cookbook/mcp-server.md) |
| 9 | [Observability — distributed tracing per chat turn](#9-observability--distributed-tracing-per-chat-turn) | `AgenticTelemetrySink` + `@infra-tools/agentic-ui/otel` | [observability](./cookbook/observability.md) |
| 10 | [Audit trail / chain-of-custody](#10-audit-trail--chain-of-custody) | Pattern (not core lib): `prevHash` / `chainHash` auto-stamping in your data layer | [paralegal-mcp-review](./cookbook/paralegal-mcp-review.md) |
| 11 | [Composable forms at runtime](#11-composable-forms-at-runtime) | `agenticForm({ composition })` + `CompositionStore` + closed-AST `if` DSL | [composable-intake-form](./cookbook/composable-intake-form.md) |
| 12 | [Live data fetching from generated UI](#12-live-data-fetching-from-generated-ui) | `ComponentDef.dataSources` + `DataSourceRegistry.getTyped<>()` + mount-time validation | [widgets-with-live-data](./cookbook/widgets-with-live-data.md) |
| 13 | [Guided multi-step workflows](#13-guided-multi-step-workflows) | `agenticWorkflow({ steps, onComplete })` + `<mvk-workflow-renderer>` | [interactive-workflows](./cookbook/interactive-workflows.md) |
| 14 | [Human-in-the-loop approval](#14-human-in-the-loop-approval) | `agenticApproval({ tool, required, approverRoles })` + chat-shell intercept | [approval-flow](./cookbook/approval-flow.md) |
| 15 | [Long-running operations](#15-long-running-operations) | `agenticTool({ longRunning: true })` + `OperationRegistry` + `<mvk-operation-progress>` | [long-running-operations](./cookbook/long-running-operations.md) |
| 16 | [Multi-modal input](#16-multi-modal-input) | `MessageContent` union + composer paperclip / drag-drop / paste-image | [multi-modal-input](./cookbook/multi-modal-input.md) |
| 17 | [Persona-shaped workspace layouts (P0)](#17-persona-shaped-workspace-layouts-post-chat-surfaces-p0) | Promoted `LayoutRegistry` + `<mvk-workspace-layout>` + `provideLayoutPolicy({...})` ([ADR-043](./adr/0043-layout-registry-promotion.md)) | [agent-directed-workspace-layouts](./cookbook/agent-directed-workspace-layouts.md) |
| 18 | [In-context agent affordances (P1)](#18-in-context-agent-affordances-post-chat-surfaces-p1) | `<mvk-cmd-k-palette>`, `<mvk-smart-cell>`, `<mvk-row-action-menu>`, `<mvk-bulk-toolbar>`, `<mvk-assist-panel>` | [cmd-k-palette](./cookbook/cmd-k-palette.md) |
| 19 | [Proactive triggers + inbox (P2)](#19-proactive-triggers--inbox-post-chat-surfaces-p2) | `TriggerRegistry` + `provideTriggerRunner({...})` + `<mvk-notification-tray>` + `<mvk-inbox>` + `<mvk-lifecycle-stages>` ([ADR-045](./adr/0045-trigger-registry.md)) | [proactive-triggers-and-inbox](./cookbook/proactive-triggers-and-inbox.md) |
| 20 | [User-built + conversational + live dashboards (P3)](#20-user-built--conversational--live-dashboards-post-chat-surfaces-p3) | `DashboardRegistry` + `<mvk-dashboard-canvas>` + `<mvk-dashboard-preview>` + `TileResultCache` ([ADR-044](./adr/0044-dashboard-registry.md)) | [dashboards](./cookbook/dashboards.md) |
| 21 | [Workflow surfaces — review queue, timeline, CAL (P4)](#21-workflow-surfaces--review-queue-timeline-cal-post-chat-surfaces-p4) | `<mvk-review-queue>`, `<mvk-timeline-canvas>`, `<mvk-cal-workbench>` — Workflow E / D / C | [review-queue](./cookbook/review-queue.md) |
| 22 | [Versioned tool-call playbooks (P5)](#22-versioned-tool-call-playbooks-post-chat-surfaces-p5) | `PlaybookRegistry` + `PlaybookRunner` + `<mvk-playbook-runner>` — chain-hashed `origin: 'playbook'` audit | [playbooks](./cookbook/playbooks.md) |
| 23 | [Wire the catalog platform](#23-wire-the-catalog-platform) | `provideAgenticPlatform({...})` — single composite provider for IAM persona + MFE registry + capability registrar / authorizer + usage metering | [ADR-031](./adr/0031-provide-agentic-platform.md) |
| 24 | [Embed the shell as a Teams Tab](#24-external-surface--embed-the-shell-as-a-teams-tab) | `provideTeamsContext({ loadContext })` bridges `microsoftTeams.app.getContext()` into a signal; no hard SDK dep | [teams-tab-embed](./cookbook/teams-tab-embed.md) |
| 25 | [Teams chat-native via Bot Framework](#25-external-surface--teams-chat-native-via-bot-framework) | `@infra-tools/agentic-ui-teams-bot` — JWT verify + AAD bearer + Adaptive Card responses in Teams chat | [teams-bot-adaptive-cards](./cookbook/teams-bot-adaptive-cards.md) |
| 26 | [GitHub Copilot Extension](#26-external-surface--github-copilot-extension) | `@infra-tools/agentic-ui-copilot-skill` — wraps the GitHub Copilot Extensions webhook protocol | [github-copilot-extension](./cookbook/github-copilot-extension.md) |
| 27 | [Microsoft Copilot Studio Connector](#27-external-surface--microsoft-copilot-studio-connector) | `@infra-tools/agentic-ui-copilot-studio-connector` — Zod→OpenAPI manifest + Azure AD JWT + per-persona Connector publishing | [copilot-studio-connector](./cookbook/copilot-studio-connector.md) |

---

### 1. Generative UI — agent picks the component

> **Scenario.** A user asks "show me the flight options". You don't want the agent to return prose — you want a `<flight-card>` UI component with the actual booking shape. The agent decides *which* component to render and *what* props to pass.

**Library responsibility.**
- `ComponentRegistry` stores `{ name, component: Type<unknown>, propsSchema: Zod }` entries.
- The backend adapter maps the protocol's render event (`show-component` tool result in AG-UI, native widget stream in Hashbrown) into a `widget-render` event on `AgenticBackend`.
- `<maverick-widget-container>` resolves the name via `ComponentRegistry.get(...)` and uses `*ngComponentOutlet` to mount it; props are Zod-validated before assignment.

**Wiring.**

```ts
// flight-card.widget.ts
import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { FlightCardComponent } from './flight-card.component';

export const flightCard = agenticWidget({
  name: 'flight-card',
  component: FlightCardComponent,
  propsSchema: z.object({
    flightId: z.string(),
    from: z.string().length(3),
    to: z.string().length(3),
    price: z.number().positive(),
  }),
});

// app.config.ts
provideAgenticUi({
  widgets: [flightCard],
  // ...
});
```

The agent emits `widget-render` with `{ name: 'flight-card', props: {...} }`; if `props` doesn't validate, the container shows an error placeholder instead of crashing.

---

### 2. Tool calling with state mutation

> **Scenario.** The agent should run `bookFlight({ flightId })` against your backend, get a result back, and the chat continues with the booking confirmation. Bonus: the user can hit Esc and abort mid-execution.

**Library responsibility.**
- `ToolRegistry` stores `{ name, description, schema, handler }` entries; the LLM sees `name + description + schema`.
- `runUntilSettled` (inside the chat-shell's `injectAgenticChat()`) calls your `handler(args, ctx)` when the LLM picks a tool, threads the result back into the next turn, and stops when the agent emits `text-end`.
- `ctx.signal: AbortSignal` lets handlers bail cleanly when the user aborts.

**Wiring.**

```ts
import { agenticTool } from '@infra-tools/agentic-ui';
import { z } from 'zod';

export const bookFlight = agenticTool({
  name: 'bookFlight',
  description: 'Book a flight for the user. Returns a confirmation id.',
  schema: z.object({ flightId: z.string() }),
  handler: async ({ flightId }, ctx) => {
    ctx.signal.throwIfAborted();
    const res = await fetch('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({ flightId }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`booking failed: ${res.status}`);
    return await res.json();        // becomes the `tool-call-result` payload
  },
});
```

For tools owned by an MFE remote, set `executeIn: 'remote'` so the handler resolves services from the *remote's* injector (see use case 3).

---

### 3. Federating MFE remotes

> **Scenario.** The bookings team owns their own tools, widgets, and routes; they ship independently and the host loads their bundle at runtime. Their tool inventory shows up in the agent's tool list within the same chat turn it loaded.

**Library responsibility.**
- `defineCapabilityModule({ tools, widgets, prompts })` is what the remote exports.
- `loadRemoteCapabilities({ remoteName, loader })` (Native Federation) or `loadRemoteCapabilitiesMF(...)` (webpack) imports the remote, reads its capability module, and pushes its tools / widgets into the host's registries with `source: 'remote:<name>'`.
- On unload, `removeBySource('remote:<name>')` runs across every registry; in-flight runs continue, but the next turn's tool list excludes the removed capabilities.

**Wiring (in the remote).**

```ts
// remote: bookings/src/app/capability.ts
import { defineCapabilityModule } from '@infra-tools/agentic-ui/mfe';
import { bookFlight, cancelFlight } from './tools';
import { flightCard } from './widgets';

export default defineCapabilityModule({
  tools: [bookFlight, cancelFlight],
  widgets: [flightCard],
});
```

**Wiring (in the host).**

```ts
// host: app.config.ts
provideAgenticUi({
  mfe: {
    federation: 'native',
    remotes: [
      { remoteName: 'bookings', remoteEntry: '/remoteEntry.json' },
    ],
  },
});
```

For deployments that already have an MFE registry service (e.g. Spring Boot), use `provideSpringBootMfeRegistry({ url })` and the remotes list comes from discovery.

---

### 4. Per-persona entitlement

> **Scenario.** An eDiscovery app has four roles — Lead Counsel, Associate, Paralegal, Vendor Reviewer. Lead Counsel needs every tool the agent can call. Vendor Reviewer is an external contractor and must only see read + tag tools — never `markPrivileged`, never `createProductionSet`, never `redactDocument`. The agent should not even *consider* tools the active user can't invoke (so an LLM hallucination can't bypass the rule), and the host shouldn't paint a generative-UI widget the role isn't entitled to see.
>
> The library handles this through `RegistryBase.setScopePolicy(...)` — added in 1.1.0. The app supplies the policy; the registry layer enforces on every read.

#### Three layers of responsibility

| Layer | Who enforces | What it does |
|---|---|---|
| Library | `ToolRegistry`, `ComponentRegistry`, every other registry | Filters `list()` / `get()` / `signal()` reads through your scope policy. Tools the persona can't invoke never reach the LLM's tool list; widgets it can't see don't resolve in `<maverick-widget-container>`. |
| Application | Your `PersonaService` (or whatever names your roles + allow-lists) | Decides which entries each role is allowed to read. The library calls your predicate with each `RegistryEntry`; you return `true` / `false`. |
| Agent server | Your tool handlers, before any side-effect | Re-verifies entitlement from the trusted session (JWT, cookie, etc.). Client-claimed personas are an UX hint, not a security boundary — a motivated client could bypass the browser. |

#### Implementing it with the library — step by step

The walkthrough below mirrors what the eDiscovery demo does in [`examples/demo-ediscovery-shell/src/app/app.config.ts`](../examples/demo-ediscovery-shell/src/app/app.config.ts).

##### Step a — Define your personas + allow-lists

The library is policy-agnostic — it doesn't care how you express roles. A simple service is plenty:

```ts
// src/app/services/persona.service.ts
import { Injectable, signal } from '@angular/core';

const ALLOW_LIST: Record<string, readonly string[]> = {
  'lead-counsel':   ['*'],
  'associate':      ['searchDocuments', 'markPrivileged', 'addCustodian',
                     'placeLegalHold', 'semanticSearch', 'filterByDateRange',
                     'filterByCustodians', 'runTARClassifier'],
  'paralegal':      ['searchDocuments', 'addCustodian', 'placeLegalHold',
                     'semanticSearch', 'filterByDateRange'],
  'vendor-reviewer':['searchDocuments', 'tagDocument'],
};

@Injectable({ providedIn: 'root' })
export class PersonaService {
  readonly active = signal<keyof typeof ALLOW_LIST>('lead-counsel');

  canInvoke(scope: string, toolName: string): boolean {
    const allow = ALLOW_LIST[scope] ?? [];
    return allow.includes('*') || allow.includes(toolName);
  }
}
```

Two things to notice:
- `active` is a signal — when the user switches persona via your UI, it changes, and the next read of `ToolRegistry.list()` re-runs the policy with the new role.
- `canInvoke` takes the scope **and** the tool name. The library will hand you the registry entry; you decide.

##### Step b — Wire the policy into the library

One call per registry you want filtered. For the eDiscovery demo, only `ToolRegistry` is scoped — but `ComponentRegistry`, `ActionRegistry`, etc. accept the same predicate:

```ts
// src/app/app.config.ts
import { provideAppInitializer, inject } from '@angular/core';
import { ToolRegistry } from '@infra-tools/agentic-ui';
import { PersonaService } from './services/persona.service';

function installPersonaScopePolicy() {
  return provideAppInitializer(() => {
    const persona = inject(PersonaService);
    const tools   = inject(ToolRegistry);
    // The predicate runs on every read — list(), get(), signal().
    // Return true to surface the entry, false to hide it.
    tools.setScopePolicy((entry) =>
      persona.canInvoke(persona.active(), entry.name));
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgenticUi({ /* ... */ }),
    bootAgenticCapabilities(),     // registers tools FIRST
    installPersonaScopePolicy(),   // then installs the filter
  ],
};
```

Order matters: install the policy *after* tools are registered (use `provideAppInitializer`'s declaration order, or run the policy install last). Otherwise the policy fires before the registry has anything to filter.

##### Step c — That's it for the input side

The library now does the rest:
- The chat shell calls `ToolRegistry.list()` when building each turn — only allow-listed tools reach the LLM.
- The sidebar's "18 tools" counter reads the same filtered signal — switching personas in the UI drops the count live.
- The orchestrator's `keywordToolFilter` (if you use one) runs **on top** of the scoped set, so the per-turn budget is bounded inside the persona's allow-list.

##### Step d — Optional: also scope the output side

If your generative-UI widgets are sensitive (e.g., a Vendor Reviewer shouldn't see a `chainOfCustodyReport` even if the LLM asks for it), wire `ComponentRegistry` the same way:

```ts
const components = inject(ComponentRegistry);
components.setScopePolicy((entry) =>
  persona.canSeeWidget(persona.active(), entry.name));
```

Now `<maverick-widget-container>` resolves through the filtered registry — a `widget-render` event for a forbidden component name returns `undefined` and silently no-ops, with a `console.warn` in dev mode.

##### Step e — Server-side verification (don't skip this)

The browser is not a trust boundary. Even with the registry filtered, a forged HTTP request straight to your tool handler would still execute side-effects. In every server-side tool handler:

```ts
// In your agent server's tool handler
async function markPrivileged({ docId }, ctx) {
  if (!ctx.session.permissions.has('markPrivileged')) {
    throw new Error('forbidden');     // bubbles back as a tool-call error
  }
  // ...mutate document...
}
```

The library's `ToolRegistry` filtering keeps the LLM honest and the UI tidy. Server-side checks keep the data safe.

#### Verifying it works

The eDiscovery demo's E2E suite has a Playwright spec for this — [`e2e/specs/05-persona-scope.spec.ts`](../e2e/specs/05-persona-scope.spec.ts) — that:

1. Reads each persona's tool-count badge and asserts strict ordering (Lead Counsel > Associate > Paralegal > Vendor Reviewer).
2. Switches to Vendor Reviewer in the header dropdown and asserts the sidebar's tool counter drops live within 5s of the persona change.
3. Persists the persona choice in `sessionStorage` and reloads — the role survives navigation.

Run it with `npm run test:e2e -- specs/05-persona-scope.spec.ts`. No LLM key needed — it's a pure UI test.

#### Where this fits in the bigger picture

- **ADR**: [`docs/adr/0008-registry-scope-policy.md`](./adr/0008-registry-scope-policy.md) — design rationale for putting the seam on `RegistryBase` (vs. a chat-shell-only filter, which was the Phase 7 first cut).
- **API reference**: [`projects/agentic-ui/src/lib/registries/registry-base.ts`](../projects/agentic-ui/src/lib/registries/registry-base.ts) — `setScopePolicy`, `permissiveScopePolicy`, `activeScopePolicy`, `getRaw`, `listRaw`.

> **Heads up.** `getRaw()` and `listRaw()` bypass the policy on purpose — for governance UIs that need to *show* the unfiltered set ("here's everything that exists; you have access to these"). Don't use them in handlers that perform actions.

---

### 5. Backend swap (AG-UI ↔ Hashbrown ↔ A2UI)

> **Scenario.** You ship v1 against AG-UI (server-side LLM, SSE streaming). v2 you want Hashbrown for client-side LLM tasks, and on a separate page you want A2UI for agent-driven UI mutations. Three protocols, but the chat shell shouldn't change.

**Library responsibility.**
- The `AgenticBackend` interface is the only seam the chat shell sees. All three protocols implement `run(input): AsyncIterable<AgenticEvent>`.
- Each adapter translates the protocol's events into the shared `AgenticEvent` union (`text-delta`, `tool-call-*`, `widget-render`, `ui-action`).
- `BackendRegistry` lets you register multiple at once and switch via UI.

**Wiring — picking one at boot.**

```ts
import { provideAgUiBackend } from '@infra-tools/agentic-ui/ag-ui';

provideAgenticUi({
  backend: provideAgUiBackend({ url: '/api/ag-ui' }),
  // later: swap to provideHashbrownBackend({...}) — no chat-shell changes
});
```

**Wiring — runtime switch (debug / preview).**

```ts
import { BackendRegistry } from '@infra-tools/agentic-ui';
const backends = inject(BackendRegistry);
backends.register({ id: 'ag-ui',     factory: () => agUiBackend,    label: 'AG-UI · SSE' });
backends.register({ id: 'hashbrown', factory: () => hashbrownBackend, label: 'Hashbrown · client' });
// the chat shell renders a backend pill; user picks one, chat re-binds
```

The chat shell's tools sidebar / widget rail feature-detect via `backend.capabilities.{clientTools, generativeUi, uiActions}` — adapters with `clientTools=false` hide the tools UI automatically.

---

### 6. Multi-agent orchestration with sticky routing

> **Scenario.** One chat panel for the whole eDiscovery matter. The user asks about custodians (collection specialist), then about a privilege flag (review specialist), then about Bates assignment (production specialist) — all without losing context. Routing decisions stay sticky for follow-up turns so the user can say "what about that one?" without naming the specialist.

**Library responsibility.**
- `OrchestratorAgent` (server-side, in `@infra-tools/agentic-ui-server`) classifies each user turn against your specialists' descriptions + examples, then runs the chosen specialist.
- A per-thread `ThreadStateStore` (in-memory by default; Redis adapter in cookbook) remembers the last specialist and replays it on the next turn unless the classifier explicitly switches.
- The "Routed to **review** specialist." banner in the demo is a cheap UX hint, not state — it's just the orchestrator emitting a text-delta when routing changes.

**Wiring (server side).**

```ts
import { OrchestratorAgent, GeminiAgent } from '@infra-tools/agentic-ui-server';

const coordinator = new OrchestratorAgent('coordinator', {
  apiKey, model: 'gemini-2.0-flash',
  subAgents: [
    { id: 'collection',  factory: (id) => new GeminiAgent(id, { /* tools: addCustodian, placeLegalHold */ }),
      description: 'custodians, legal holds, collection status',
      examples: ['Add Sarah as a custodian', 'Place a hold on Project Phoenix'] },
    { id: 'review',      factory: (id) => new GeminiAgent(id, { /* tools: searchDocuments, markPrivileged */ }),
      description: 'document search, privilege flags, tagging',
      examples: ['Find docs about Project Phoenix', 'Mark DOC-789 as attorney-client'] },
    // ... production, search ...
  ],
});
```

The orchestrator handles the routing loop. From the host's perspective, it's still one `AgenticBackend` — the chat shell never knows there are 4 agents under it.

---

### 7. Per-turn tool budget at scale

> **Scenario.** You have 50+ tools across three federated remotes. Sending all of them to the LLM every turn blows your context budget and slows responses. You want the agent to see only the 12 most-relevant tools per turn — selected by keyword match against the user's prompt — but always include 5 "core" tools that should be available regardless.

**Library responsibility.**
- `provideToolFilter(filter)` registers a filter that runs *between* `ToolRegistry.list()` and the LLM.
- `keywordToolFilter({ maxTools, floor })` is a stock implementation: extract keywords from the latest user message, score each tool by description-match, return the top `maxTools` plus the `floor` highest-priority ones unconditionally.
- Composes with `setScopePolicy` from use case 4: the persona scope filters first (governance), then the keyword filter narrows further (efficiency).

**Wiring.**

```ts
import { provideToolFilter, keywordToolFilter } from '@infra-tools/agentic-ui';

provideAgenticUi({
  // ...
  providers: [
    provideToolFilter(keywordToolFilter({ maxTools: 12, floor: 5 })),
    // and (if using persona scope policy):
    installPersonaScopePolicy(),
  ],
});
```

For 17+ tool inventories like the eDiscovery demo, this typically narrows each turn to ~10 tools and cuts prompt size by 70%. Custom filter? Implement `ToolFilter = (tools, ctx) => readonly ToolDef[]` and pass to `provideToolFilter`.

---

### 8. MCP — same tools power analyst desktops

> **Scenario.** Your tool definitions are valuable IP — you want them callable not just from your in-browser chat shell, but also from Claude Desktop, Cursor, and Zed via the Model Context Protocol. One source of truth, three surfaces.

**Library responsibility.**
- `@infra-tools/agentic-ui-mcp` is a separate package that wraps `ToolDef` instances as an MCP server.
- `createMcpServer({ tools, transport })` produces a Hono-mountable server that speaks MCP over stdio, SSE, or the `text/html;profile=mcp-app` HTTP profile.
- Same Zod schemas, same handlers — only the transport differs.

**Wiring.**

```ts
import { createMcpServer } from '@infra-tools/agentic-ui-mcp';
import { searchDocuments, markPrivileged, tagDocument } from './tools';

// In your agent server (or a separate Node process):
const mcp = createMcpServer({
  name: 'ediscovery-paralegal',
  version: '1.0.0',
  tools: [searchDocuments, markPrivileged, tagDocument],
});

app.route('/mcp', mcp);
```

In Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ediscovery": { "command": "node", "args": ["dist/mcp-stdio.js"] }
  }
}
```

The paralegal MCP cookbook walks through a privilege-review flow where the same tools that drive the in-browser chat also let an analyst do the work from Claude Desktop. Persona scope still applies via your `setScopePolicy` because MCP also reads through `ToolRegistry`.

---

### 9. Observability — distributed tracing per chat turn

> **Scenario.** A user reports "the agent is slow on production runs". You need to see — in one trace — the chat-shell run, the SSE handshake, the orchestrator's classification, the specialist's LLM call, every tool call, and where the time went. With W3C trace-context propagating across the SSE boundary so client + server stitch into one trace.

**Library responsibility.**
- `AgenticTelemetrySink` is a no-op interface by default; the library emits at every meaningful boundary (`agentic.run`, `agentic.tool_call`, `agentic.widget_render`, `agentic.federation.load`).
- `@infra-tools/agentic-ui/otel` ships the OpenTelemetry-backed sink; opt-in via `provideAgenticTelemetry(...)`.
- The AG-UI adapter inserts `traceparent` into request headers; the server-side route extracts it and continues the trace inside Mastra/Hono.

**Wiring.**

```ts
import { provideAgenticTelemetry } from '@infra-tools/agentic-ui/otel';

provideAgenticUi({
  // ...
  telemetry: provideAgenticTelemetry({
    serviceName: 'demo-shell',
    exporter: 'otlp-http',
    endpoint: 'http://otel-collector:4318/v1/traces',
    sampler: { kind: 'ratio', ratio: 0.1 },         // 10% in prod
    instrumentations: { runs: true, toolCalls: true, federation: true },
    redaction: { argsAllowList: ['flightId', 'docId'] },  // don't ship PII to traces
  }),
});
```

Defaults are conservative: tool args / message bodies are never captured as span attributes — only sizes and stable hashes. Opt in field-by-field.

---

### 10. Audit trail / chain-of-custody

> **Scenario.** A regulated domain (eDiscovery, finance, healthcare). Every state-mutating tool call needs to land in an immutable audit log: who did what, when, what the previous state was, with a hash chain so any tamper attempt breaks the chain visibly.

**Library responsibility.**
This is *not* core to `@infra-tools/agentic-ui` — auditing is application-layer work. But the library makes the right hooks visible:
- Every tool's `handler(args, ctx)` knows the actor (`ctx.session`) and the persona (via your scope policy from use case 4).
- The `AgenticTelemetrySink` from use case 9 emits a `tool-call` span you can fan out to your audit sink alongside OTel.
- The eDiscovery demo's mock data layer shows the recommended **prevHash / chainHash** pattern: every `appendAudit(event)` auto-stamps `prevHash` (last entry's hash) and `chainHash` (hash of `event + prevHash`). Replay verifies the chain.

**Wiring (sketch — implement against your data layer).**

```ts
function appendAudit(event: AuditEvent) {
  const prev = audit.list().at(-1);
  const chained = {
    ...event,
    timestamp: new Date().toISOString(),
    prevHash: prev?.chainHash ?? null,
    chainHash: hash(JSON.stringify({ ...event, prevHash: prev?.chainHash ?? null })),
  };
  audit.append(chained);
}

// in your tool handler:
handler: async ({ docId, flag }, ctx) => {
  const before = await documents.get(docId);
  const after  = await documents.update(docId, { privilege: flag });
  appendAudit({ kind: 'mark-privileged', actor: ctx.session.userId,
                docId, before: before.privilege, after: flag });
  return after;
}
```

Pair with use case 4 (persona scope) and use case 9 (OTel) and you have the three-piece compliance story: who *can* do it, who *did* do it, and what happened in the system when they did. The Audit Trail page in the eDiscovery demo verifies the chain on render — a `verified` badge means the hashes match end-to-end; a `break` badge means tampering was detected.

---

### 11. Composable forms at runtime

> **Scenario.** A custodian-onboarding form whose visible sections depend on the matter type, the persona, and the custodian's department. Securities-related matters need a regulatory-disclosure section; paralegal turns need a supervisor-signoff section; Finance custodians need an accounting-system picker. Hard-coding N variants is a dead end.

**Library responsibility.**
- `agenticForm({ composition: [{ widget, section?, if?, predicate? }, ...] })` declares an ordered list of registered widgets. Each entry's `if` is parsed at registration into a closed-AST DSL (`===`, `!==`, `&&`, `||`, dotted access, parens, literals) and rejected on malformed input. `predicate` is the programmatic escape hatch.
- `<mvk-form-renderer>`'s composition branch evaluates predicates against the `context` input and mounts surviving widgets via `*ngComponentOutlet` with a per-section child injector providing `COMPOSITION_SLOT`.
- `CompositionStore` is renderer-scoped and signal-backed; section widgets opt in by `inject(COMPOSITION_SLOT) + inject(CompositionStore)` so values survive section unmount when predicates toggle.
- A predicate that flips visible→hidden on a dirty slot triggers an inline drop-or-keep banner, never a silent value loss.

**Wiring.**

```ts
agenticForm({
  name: 'custodianIntake',
  composition: [
    { widget: 'intake-identity-fields',     section: 'Identity' },
    { widget: 'intake-regulatory-consent',  section: 'Compliance', if: 'matter.type === "securities"' },
    { widget: 'intake-supervisor-picker',   section: 'Approval',   if: 'persona !== "lead-counsel"' },
    { widget: 'intake-accounting-systems',  section: 'Discovery',  if: 'department === "Finance"' },
  ],
  submit: async (values) => {/* aggregated by widget name */},
});
```

Full walkthrough — including the AC-F1-2 drop/keep contract, prototype-pollution defense in path resolution, and the per-slot injector pattern — in the [composable-intake-form](./cookbook/composable-intake-form.md) cookbook.

---

### 12. Live data fetching from generated UI

> **Scenario.** The supervisor-signoff section in use case 11 is an autocomplete that hits `/api/users?prefix=...`. The widget shouldn't bake the URL in — it should declare a logical dependency the host wires per environment. Mock in dev, REST in prod, GraphQL in v2 — without changing the widget code.

**Library responsibility.**
- `ComponentDef.dataSources?: readonly string[]` declares names the widget consumes. `<mvk-widget-container>` and the form-renderer's composition path validate the names against `DataSourceRegistry` at mount time; a missing source surfaces an inline placeholder citing the widget + missing entries instead of a silently-broken widget at first call.
- `DataSourceRegistry.getTyped<TQuery, TResult>(name)` returns a typed adapter view. Throws `UnknownDataSourceError` on missing — but mount-time validation runs first, so production callers can rely on resolution.
- `agenticDataSource({ name, kind, adapter })` registers a source; `restDataSource(name, baseUrl, fetchFn?)` is the convenience for path-encoded REST. Wrapped adapters automatically emit `data_source.query_ms` histograms via the telemetry sink.

**Wiring.**

```ts
agenticWidget({
  name: 'supervisor-signoff-picker',
  component: SupervisorPickerComponent,
  propsSchema: z.object({}),
  dataSources: ['users'],          // declared dependency — validated at mount
});

env.get(DataSourceRegistry).register(
  agenticDataSource<UserQuery, Promise<readonly User[]>>({
    name: 'users',
    kind: 'rest',
    adapter: async ({ prefix, role }) => fetch(`/api/users?prefix=${prefix}`).then((r) => r.json()),
  }),
);
```

Tools (LLM-initiated) and data sources (UI-initiated) are sister concepts. Both end up calling backend endpoints; tools cost tokens, data sources don't. Full walkthrough in the [widgets-with-live-data](./cookbook/widgets-with-live-data.md) cookbook.

---

### 13. Guided multi-step workflows

> **Scenario.** Placing a legal hold isn't one form — it's a wizard. Step 1: pick keywords. Step 2: pick custodians (zero selected → jump to "matter setup" instead). Step 3: date range. Step 4: preview + send. State must survive Back navigation.

**Library responsibility.**
- `agenticWorkflow({ steps, onComplete })` declares an ordered list of `WorkflowStep` records keyed by id. Each step references a registered widget; `next` is `string` (unconditional), `null` (terminal), or `(state) => string | null` (branching).
- The factory validates at registration: non-empty steps, unique ids, string `next` targets resolve, identifier shapes — `AgenticWorkflowError` cites the malformed step.
- `<mvk-workflow-renderer>` mounts ONE step at a time via `*ngComponentOutlet` with a per-step child injector providing `COMPOSITION_SLOT = step.id`. Reuses the F1 `CompositionStore` so state aggregates across steps and survives Back for free.
- Terminal-step Submit runs `onComplete(snapshot, ctx)` — same domain handler as the equivalent one-shot tool. One handler, two surfaces (chat tool + wizard).

**Provisional registry note.** Per the r3 plan §9.3.3, F3 ships as `FormDef.workflow?` carried through `FormRegistry`. Promotion to a top-level `WorkflowRegistry` is an ARB decision when 3+ workflows demand it. The `agenticWorkflow({...})` call shape stays stable across either path.

Full walkthrough in the [interactive-workflows](./cookbook/interactive-workflows.md) cookbook.

---

### 14. Human-in-the-loop approval

> **Scenario.** A paralegal asks the agent to deliver a production set to opposing counsel. Delivery is irreversible, and a paralegal doesn't have authority. The agent should draft + queue, lead counsel reviews + signs off, every transition lands in the audit chain. PR-style review for agent-initiated mutations.

**Library responsibility.**
- `agenticApproval({ tool, required, approverRoles, diffRenderer, signoffMessage })` registers a policy keyed on tool name. The chat-shell's `executeClientTools` consults the registry per call: when `required(args, ctx)` returns true, the tool is **not executed** — an `Approval{pending}` is enqueued and a synthetic `{queued: true, approvalId}` result is returned with a `mvk-approval-card` widget reference so the chat renders the card inline.
- The card's diff renderer (a host-supplied widget; e.g. `production-summary-diff`) receives `APPROVAL_DIFF_INPUTS` via per-card injector and renders the **literal arg payload** that will execute on Approve — never an LLM-generated summary.
- Persona enforcement is at the call site (card + queue): a non-approver persona sees a "you cannot approve" message instead of buttons.
- `AGENTIC_APPROVAL_AUDIT_HOOK` injection token translates every transition into a `tool-approved` / `tool-rejected` audit event. Fire-and-forget contract — throwing hooks do NOT roll back the in-memory transition (per [ADR-009](./adr/0009-approval-intercept-and-audit-hook.md)).

**Wiring.**

```ts
env.get(ApprovalRegistry).register(
  agenticApproval({
    tool: 'exportProductionSet',
    required: (_args, ctx) => ctx.persona !== 'lead-counsel',
    approverRoles: ['lead-counsel'],
    diffRenderer: 'production-summary-diff',
    signoffMessage: (args) => `Approve delivery of ${args.productionId} to opposing counsel?`,
  }),
);
```

The eDiscovery demo also ships a `/approvals` queue page (`pendingForApprover(activePersona)`) and a sidebar nav badge for cross-session handoff. Full walkthrough in the [approval-flow](./cookbook/approval-flow.md) cookbook.

---

### 15. Long-running operations

> **Scenario.** "Run TAR classification on the un-tagged corpus" — that's 50,000 documents and ~12 minutes. Standard SSE timeouts kill the run. The user wants live progress, the ability to walk away, and a result they can revisit later.

**Library responsibility.**
- `agenticTool({ longRunning: true })` is an opt-in flag. The chat shell's `ToolContext` always carries `startOperation / reportProgress / completeOperation / failOperation` — tools that don't need them ignore them; tools that do call them route through `OperationRegistry`.
- Long-running tool handlers return immediately with `{ opId, components: [{ name: 'mvk-operation-progress', props: { opId } }] }`. A background loop calls `ctx.reportProgress(opId, { pct, phase, partialResult })` periodically, then `ctx.completeOperation(opId, result)` or `ctx.failOperation(opId, error)`.
- `<mvk-operation-progress>` subscribes to `OperationRegistry` for live updates. Same widget renders inline in the chat AND on the `/operations` page — one operation, one component, two surfaces.
- `AGENTIC_OPERATION_AUDIT_HOOK` mirrors every lifecycle transition (`operation-started` / `-progress` / `-finished` / `-failed`) into the audit chain.

**Wiring.**

```ts
agenticTool({
  name: 'runTARClassifier',
  longRunning: true,
  schema: z.object({ topic: z.string() }),
  handler: async ({ topic }, ctx) => {
    const opId = ctx.startOperation({ description: `TAR-classify "${topic}"`, estDurationMs: 12_000 });
    void runClassifierBackground(opId, ctx);     // ctx.reportProgress / completeOperation inside
    return { opId, components: [{ name: 'mvk-operation-progress', props: { opId } }] };
  },
});
```

Cancellation honours `ctx.signal` — when the user aborts the run, the background loop detects the abort on its next tick and calls `failOperation`. Full walkthrough — including cross-session durability via `PersistenceRegistry` — in the [long-running-operations](./cookbook/long-running-operations.md) cookbook.

---

### 16. Multi-modal input

> **Scenario.** A paralegal drops a deposition exhibit (PDF) into the chat: *"What custodian is this addressed to?"* Or pastes a screenshot. Or speaks an instruction. The agent should receive the content as typed multi-part input — not as some lossy text approximation.

**Library responsibility.**
- `MessageContent` union — `text` / `image` / `file` parts. Mirrors Anthropic / OpenAI / Gemini conventions. `AgenticMessage.content` is `string | readonly MessageContent[]` — backwards-compatible with every existing F1–F5 flow.
- `<mvk-chat-shell>` composer ships paperclip / drag-drop / paste-from-clipboard affordances out of the box. Pending attachments render as chips above the input; image previews use data URIs; remove buttons drop individual entries.
- Per-file MIME allow-list + size cap validation client-side (configurable via `acceptedMimeTypes` and `maxBytes` inputs on the chat shell). Rejection surfaces inline; nothing reaches the tray.
- `BackendCapabilities.multiModal?` advertises support. Backends without it: chat-ref logs `console.warn`, emits a fallback telemetry event, and synthesises a single text string (`[file: name]`, `[image: alt]`) so the LLM at least sees that attachments existed.

**Slice 1 status.** Microphone / `SpeechRecognition` (AC-F6-2) and the server-side upload route (`agUiUploadHandler`) for AV-scanning + signed-URI uploads land in slice 2. Slice 1 inlines bytes as data URIs — fine for demos and small files; production deployments will swap to server URIs at the same call site.

Full walkthrough — including HIPAA gating, cost telemetry, and privacy-on-data-URI considerations — in the [multi-modal-input](./cookbook/multi-modal-input.md) cookbook.

---

### 17. Persona-shaped workspace layouts (post-chat-surfaces P0)

> **Scenario.** A partner reviewing privilege wants three panels open at once — Documents, an AI assist sidebar, and the chat rail — without the chat dominating the screen. A reviewer in the same app wants a fullscreen review queue with the chat collapsed to an icon. A junior associate's first-run view is the original right-rail layout. Same Angular app, three different operators, three different surface shapes — and the LLM should be able to ask the host to switch the shape per turn ("open this in a workspace mode").

**Library responsibility.**

- `LayoutRegistry` is the seventh registry — promoted from internal use under [ADR-043](./adr/0043-layout-registry-promotion.md). It registers `LayoutDef` entries, each declaring a `mode` (`rail` / `split` / `workspace` / `assist-panel` / `fullscreen`), a set of named slots, and optional responsive breakpoints.
- `<mvk-workspace-layout>` renders any registered `LayoutDef`. Slots accept Angular content projection by `slot=` attribute; ResizeObserver-driven slot resizing is handled in CSS Grid.
- `provideLayoutPolicy({ default: 'split', perPersona: { partner: 'workspace', reviewer: 'fullscreen' } })` lets you set a host-wide default + per-persona overrides. The chat shell reads the policy through the `LAYOUT_POLICY` InjectionToken — no other library code knows about personas; the policy itself is what's persona-aware.
- The LLM can emit a `layout-render` event mid-turn; the chat shell Zod-validates the payload at the boundary and either swaps the layout or warns and falls back to the previous one.

```ts
inject(LayoutRegistry).register({
  name: 'review-workspace',
  mode: 'workspace',
  slots: [
    { id: 'primary', minSize: 400 },
    { id: 'assist',  minSize: 280, defaultSize: 320 },
    { id: 'chat',    minSize: 320, defaultSize: 360, collapsible: true },
  ],
});
```

Full walkthrough — including how the LLM's `layout-render` event flows through the chat shell and the migration story from the pre-promotion rail-only layout — in the [agent-directed-workspace-layouts](./cookbook/agent-directed-workspace-layouts.md) cookbook.

---

### 18. In-context agent affordances (post-chat-surfaces P1)

> **Scenario.** A reviewer sees a custodian row in a table and wants to ask *"Why is this custodian under hold?"* — without leaving the row, opening the chat rail, and re-typing context. A partner pressing ⌘K wants to invoke `releaseLegalHold` by name without scrolling the chat. A bulk-selection of 40 documents needs *one* "request review for selected" action, not 40 separate prompts.

**Library responsibility.**

Five dispatch-agnostic components — every one a typed `(action)` emitter the host wires to its dispatcher (so no component knows about routes / actions / mutators directly):

- **`<mvk-cmd-k-palette>`** — ⌘K / Ctrl+K palette resolving free-text → `IntentRegistry` matches → `ToolRegistry` fallback. Recent + pinned section, keyboard navigation, persona-filtered.
- **`<mvk-smart-cell>`** — a single-cell agent-computed value in a table. Names a tool to invoke; renders loading / result / error; persona scope filters at the cell level (no access → "no access" stub, not 403).
- **`<mvk-row-action-menu>`** — kebab menu populated from `IntentRegistry` filtered by `context: 'row'`. Resolves entries → tools / actions / routes.
- **`<mvk-bulk-toolbar>`** — selection-aware toolbar that materialises above a table when N rows are selected; intent entries with `context: 'bulk-selection'`.
- **`<mvk-assist-panel>`** — Cursor-pattern sidebar: structured affordances (intents + tool buttons + recent runs) over a free-text chat area; same `(action)` emitter pattern as the others.

```html
<mvk-bulk-toolbar
  [selection]="selectedDocIds()"
  context="document"
  (action)="onBulkAction($event)" />
```

Full walkthroughs in the [cmd-k-palette](./cookbook/cmd-k-palette.md), [smart-cell](./cookbook/smart-cell.md), [row-action-menu](./cookbook/row-action-menu.md), [bulk-toolbar](./cookbook/bulk-toolbar.md), and [assist-panel](./cookbook/assist-panel.md) cookbooks.

---

### 19. Proactive triggers + inbox (post-chat-surfaces P2)

> **Scenario.** An overdue legal-hold acknowledgement should ping the case manager without anyone typing in the chat. An ingest-complete queue event should fire `refreshMatter` for the affected case. Every fire should land in a tray + a full inbox route, with chain-hashed audit attributing the firing.

**Library responsibility.**

- `TriggerRegistry` — eighth registry ([ADR-045](./adr/0045-trigger-registry.md)). Holds `TriggerDef` entries: discriminated by `kind` (`cron` / `webhook` / `queue`) and dispatching to a discriminated `target` (`tool` / `action` / `notification` with a `compose(ctx)` callback returning a `NotificationDraft`).
- `provideTriggerRunner({...})` wires the browser-side cron runner — webhook + queue targets defer to the server-side runner (deferred to a future ADR-046). Every firing chain-hashes with `origin: 'trigger'` + the trigger's `runAs` persona for audit attribution.
- `<mvk-notification-tray>` — bell icon + unread badge + dropdown; signal-driven from a `NotificationRegistry` write that the trigger runner performs on the `notification` target kind.
- `<mvk-inbox>` — full-page route widget rendering the same notifications with filters, CTAs (route / action / tool buttons), bulk-mark-read.
- `<mvk-lifecycle-stages>` — multi-stage horizontal lifecycle widget for `Operation`-backed long-running flows (e.g. *Ingest → Process → Index → Review-ready*). Useful when a trigger fires a long-running tool and the inbox entry should show progress.

```ts
inject(TriggerRegistry).register({
  name: 'dailyAckSweep',
  kind: 'cron',
  spec: { kind: 'cron', expression: '@daily' },
  target: { kind: 'tool', tool: 'sweepHoldAcks', args: {} },
  runAs: 'caseManager',
});
```

Full walkthrough in the [proactive-triggers-and-inbox](./cookbook/proactive-triggers-and-inbox.md) cookbook.

---

### 20. User-built + conversational + live dashboards (post-chat-surfaces P3)

> **Scenario.** Legal ops want a "Matter health" dashboard: open holds count, recent emails, custodian timeline, ingest progress — all tiles, refreshing on demand or on a schedule, drillable to the underlying tool result. They want the LLM to be able to propose a dashboard ("show me production status across all open matters"), let them preview it, and save it.

**Library responsibility.**

- `DashboardRegistry` — ninth registry ([ADR-044](./adr/0044-dashboard-registry.md)). `DashboardDef` composes `TileDef[]` over a `LayoutRegistry`-named layout, optional `FilterDef[]` for cross-matter parameter threading, and `version` + `parentVersion` for revision history.
- `TileInvocation` is a discriminated union: `kind: 'tool'` (re-invokes the tool, chain-hashed), `kind: 'data'` (re-queries a `DataSourceRegistry` source — no audit), or `kind: 'static'` (literal props).
- `<mvk-dashboard-tile>` renders one tile. `<mvk-dashboard-canvas>` renders the whole dashboard. `<mvk-dashboard-preview>` is the editable preview shell adopters open when the LLM proposes a new dashboard.
- `TileResultCache` is a singleton cross-instance cache keyed by `tileCacheKey()` (stable-sorted JSON). `cacheTtlMs` per tile, `refreshOn: 'event'` for push-driven refresh, `drilldown: { route | tool | action }` for the click-through.
- Persona scope filters tiles automatically — unauthorised tiles render as "no-access" stubs, not 403s, not silent omissions.

```ts
inject(DashboardRegistry).register({
  name: 'matterHealth',
  title: 'Matter health',
  layout: 'two-col',
  tiles: [
    { id: 'open-holds', slot: 'primary', title: 'Open holds', component: 'countTile',
      invocation: { kind: 'tool', tool: 'countOpenHolds', args: { matterId: 'M-1' } },
      refreshOn: 'event', drilldown: { route: '/holds?status=open' } },
    /* …more tiles */
  ],
  version: 'v1',
});
```

Full walkthroughs in the [dashboards](./cookbook/dashboards.md) (registry + canvas), [conversational-dashboards](./cookbook/conversational-dashboards.md) (LLM proposes, host previews + commits), and [live-dashboards](./cookbook/live-dashboards.md) (cache + refresh + drilldown) cookbooks.

---

### 21. Workflow surfaces — review queue, timeline, CAL (post-chat-surfaces P4)

> **Scenario.** Workflows that aren't a chat-shell turn: a senior reviewer needs a queue routed by persona (partner sees only escalations; senior sees only QC) with explicit decisions appended to the audit chain. An investigator needs a timeline canvas to reconstruct who did what when, drillable into the underlying tool results. A data scientist needs a Continuous Active Learning training loop with bulk labelling + classifier-refresh round trips.

**Library responsibility.**

Three purpose-built widgets, each composing existing registries with workflow-specific UI semantics:

- **`<mvk-review-queue>`** (Workflow E) — multi-reviewer queue. Reads a tool-backed `WorkflowQueueItem[]` signal; emits `(decision)` events the host wires to whichever `agenticAction` represents an approve / reject / escalate. Audit chain entries shape: `tool-approved` / `tool-rejected` (same shape as F4 approvals).
- **`<mvk-timeline-canvas>`** (Workflow D) — investigation timeline. Renders a `TimelineEvent[]` signal as a horizontal canvas with severity coding, drill-in panels, and an LLM-driven *"summarise events between t1 and t2"* affordance.
- **`<mvk-cal-workbench>`** (Workflow C) — CAL training loop. Renders a batch of documents to label, captures decisions, fires the classifier-refresh tool, shows updated confidence on the next batch. Pairs with `ActionRegistry` for the train + commit + revert decisions.

All three are signal-backed, OnPush, dispatch-agnostic. The same `setScopePolicy` filter that hides tools from the LLM also hides queue items from reviewers they're not entitled to see.

Full walkthroughs in the [review-queue](./cookbook/review-queue.md), [timeline-canvas](./cookbook/timeline-canvas.md), and [cal-workbench](./cookbook/cal-workbench.md) cookbooks.

---

### 22. Versioned tool-call playbooks (post-chat-surfaces P5)

> **Scenario.** Legal ops want to apply *Initial Privilege Pass v3* across matters: a sequence of 7 tool calls in a specific order (scope → search → tag → cal-round → privilege-log → snapshot → export). Same playbook, different matters; same audit shape, different `matterId` arg. Editing it produces v4 with `parentVersion: v3`. Every step chain-hashes through audit with `origin: 'playbook'` + the step index — a single playbook run is one tamper-evident block in the chain.

**Library responsibility.**

- `PlaybookRegistry` — eighteenth registry. Holds `PlaybookDef` entries: `name`, `title`, `version`, `parentVersion?`, `description`, persona scope, and a `steps: PlaybookStep[]` array.
- `PlaybookStep` carries `id`, `tool`, `args`, plus two opt-in modifiers: `requiresApproval: true` halts the run with an Approve / Skip gate before invoking (use for irreversible operations), `continueOnError: true` keeps the run going past a failed step (overall ends `'failed'` regardless).
- `PlaybookRunner` is a `providedIn: 'root'` service. `start(def)` returns a `RunningPlaybook` handle exposing a signal-backed live state, a terminal-state promise, and `cancel()` / `approve()` / `skip()` methods.
- `<mvk-playbook-runner>` renders the live state — per-step status pill, inline error, Result disclosure, Approve / Skip / Cancel buttons surfacing on the right steps; dispatch-agnostic same as everything else.
- Persona-blocked tools (`ToolRegistry.get` returns `undefined`) record the step as failed with *"tool not visible to this persona"* — no silent-drop semantics.

```ts
const handle = inject(PlaybookRunner).start(initialPrivilegePassPlaybook);
effect(() => console.log(handle.state()));   // signal-backed live snapshot
await handle.done;                            // terminal state
```

Full walkthrough — including cross-matter parameterisation, the eight-registries-one-workflow composition shape, and what's NOT in scope (conditional branching, parallel fan-out, visual builder, cross-tenant) — in the [playbooks](./cookbook/playbooks.md) cookbook.

---

### 23. Wire the catalog platform

> **Scenario.** Your runtime app already works embedded — tools register in code, widgets render inline, MFE remotes load from a JSON file. Now an operator asks: *"Where do I see what tools the running apps actually expose? Why did toggling `releaseLegalHold` to `disabled` in the ops console do nothing? Why is the Usage page always empty?"* You need the runtime to integrate with the [Maverick catalog server](../platform/agentic-catalog-server/) — but you don't want to wire 4–5 separate providers and thread the same three config values through each.

**Library responsibility.**

`provideAgenticPlatform({...})` ([ADR-031](./adr/0031-provide-agentic-platform.md)) is a **single composite provider** that wires every catalog adapter through one shared `catalogUrl` / `tenantId` / `getToken`. Each integration is opt-in via its own per-feature options object; pass `false` to skip, omit the key to skip by default. Closes Gaps 4 / 1 / 3 / 2 from the [2026-05-10 platform audit](./audit/2026-05-10-platform-audit.md).

| Feature switch | What it does | ADR |
|---|---|---|
| `personaResolver` | OIDC user → runtime persona via `POST /role-mappings/resolve` | [ADR-016](./adr/0016-iam-role-mapping.md) |
| `mfeRegistry` | Federated MFE manifest discovery via `GET /mfes` | [ADR-003](./adr/0003-pluggable-mfe-registry-source.md) |
| `capabilityRegistrar` | On boot, POST every registered tool/widget to the catalog. Idempotent via `(tenant_id, kind, name)` UNIQUE constraint — repeat boots see 409 per entry, treated as success. | [ADR-032](./adr/0032-catalog-capability-registrar.md) |
| `capabilityAuthorizer` | Polls `?lifecycle=disabled`; installs a composing scope policy on `ToolRegistry` + `ComponentRegistry` so disabled entries vanish from `list()` / `get()` reads. | [ADR-033](./adr/0033-catalog-capability-authorizer.md) |
| `usageMetering` | Wraps `AGENTIC_TELEMETRY_SINK` so tool call / widget render / federation load events become `POST /v1/catalogs/{tenant}/usage` posts (batched, fire-and-forget). | [ADR-034](./adr/0034-catalog-usage-metering.md) |

**Wiring.**

```ts
// src/app/app.config.ts
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import {
  provideAgenticUi,
  provideAgenticPlatform,
  provideAgUiBackend,
} from '@infra-tools/agentic-ui';

const CATALOG_URL = 'https://catalog.example.com';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideAgenticUi({ tools: [...], widgets: [...] }),
    provideAgUiBackend({ url: '/api/agents/gemini/run' }),
    provideAgenticPlatform({
      catalogUrl: CATALOG_URL,
      tenantId: 'acme',                         // or () => readTenantFromSubdomain()
      getToken: () => oidc.getAccessToken(),    // null/undefined OK for AUTH_MODE=disabled
      personaResolver:      { defaultPersona: 'paralegal' },
      mfeRegistry:          { refreshIntervalMs: 30_000 },
      capabilityRegistrar:  {},      // defaults: lifecycle 'published', host-only
      capabilityAuthorizer: {},      // defaults: 30s poll, default-allow on fetch fail
      usageMetering:        {},      // defaults: 5s flush, 100-event batch
    }),
  ],
};
```

**Or scaffold it.** From the [`mvk` CLI](../platform/mvk-cli/):

```bash
mvk login --catalog-url https://catalog.example.com --token $TOKEN
mvk new app demo --with-platform --tenant acme
# Generated src/app/app.config.ts is pre-wired with provideAgenticPlatform.
```

**What changes for operators.**

- The capabilities page in the ops console populates from the live registrar (no more hand-curated [`ADR-025` seed](./adr/0025-ediscovery-demo-seed.md) drift).
- Toggling a capability to `disabled` in the ops console makes it disappear from the running app's chat shell within ~30s — no rebuild, no app restart.
- The Usage page populates with real workload data; per-tenant quota policy decisions get a real signal to act on.

**What changes for developers.**

- `toolRegistry.register(...)` still works exactly as before. Every feature is opt-in; apps that don't call `provideAgenticPlatform` see zero behaviour change. Embedded-first stays embedded-first.
- Hosts with their own telemetry sink wire it via `usageMetering: { delegate: myCustomSink }` so existing telemetry continues to flow alongside catalog metering.
- Persona policies the host installs (e.g. `activeScopePolicy(persona)`) compose with the authorizer — the authorizer reads the existing policy via `RegistryBase.currentScopePolicy()` and AND's the catalog's deny-list with it. Both gates fire.

**Default-allow + degrade-gracefully.** The authorizer's `onInitialFetchFailure: 'allow'` default means a catalog outage doesn't break the consumer app — capabilities stay visible until the next 30s tick lands. Apps that demand strict closed-allowlist semantics (compliance-heavy deployments where stale-disabled is worse than offline) opt in via `onInitialFetchFailure: 'deny'`.

---

### 24. External surface — embed the shell as a Teams Tab

> **Scenario.** Your operators live in Microsoft Teams. Asking them to open a separate browser tab for the agentic UI is friction. You want the same Angular app — same tools, same audit chain — running inside a Teams Tab next to their channel chat.

**Library responsibility.**
- `provideTeamsContext({ loadContext, fallback? })` ([ADR-041](./adr/0041-teams-copilot-external-surfaces.md) D4) bridges `microsoftTeams.app.getContext()` into a `TEAMS_CONTEXT` signal. Adopters read it for tenant id, UPN, theme, locale.
- Lib carries **no** runtime dependency on `@microsoft/teams-js`. Adopters lazy-import the SDK themselves so non-Teams adopters pay nothing.
- Teams context plumbs into the existing IAM persona resolver (ADR-016) — claims-to-persona mapping the catalog already supports.

**Wiring.**

```ts
// app.config.ts
provideTeamsContext({
  loadContext: async () => {
    const teams = await import('@microsoft/teams-js');
    await teams.app.initialize();
    const c = await teams.app.getContext();
    return {
      tenantId: c.user?.tenant?.id ?? '',
      userPrincipalName: c.user?.userPrincipalName ?? null,
      theme: c.app?.theme ?? 'default',
      locale: c.app?.locale ?? 'en-US',
    };
  },
  fallback: { tenantId: 'demo', userPrincipalName: null, theme: 'default', locale: 'en-US' },
});
```

The eDiscovery demo ships a Teams manifest scaffold at `examples/demo-ediscovery-shell/teams/`. End-to-end walkthrough in [the Teams Tab cookbook](./cookbook/teams-tab-embed.md).

---

### 25. External surface — Teams chat-native via Bot Framework

> **Scenario.** Operators don't just want the app inside Teams — they want to **converse with the agent in Teams chat** (channel / DM / group). Tool results render as Adaptive Cards in the conversation; rich UIs deep-link back to the Teams Tab.

**Library responsibility.**
- `@infra-tools/agentic-ui-teams-bot` wraps the Bot Framework webhook protocol: JWT verify against Microsoft's Bot Connector keys, activity parse, AAD client-credentials bearer for outbound replies, Adaptive Card response builder.
- New `adaptiveCard?: object` field on `ToolResultRenderHints` ([ADR-041](./adr/0041-teams-copilot-external-surfaces.md) D2) is the highest-fidelity render in Teams; tools without it fall back to the generic `widgetFallbackCard` derived from their `components` array.

**Wiring.**

```ts
import express from 'express';
import { createTeamsBotMiddleware, type TeamsBotHandler } from '@infra-tools/agentic-ui-teams-bot';

const handler: TeamsBotHandler = async function*({ activity, identity }) {
  const principal = await mapTeamsToCatalog(identity);
  for await (const ev of yourAgent.run({ messages: [{ role: 'user', content: activity.text! }], principal })) {
    if (ev.type === 'TOOL_CALL_RESULT' && ev.result?.adaptiveCard) {
      yield { type: 'adaptive-card', card: ev.result.adaptiveCard };
    } else if (ev.type === 'TEXT_MESSAGE_CONTENT') {
      yield { type: 'text', text: ev.delta };
    }
  }
};

const app = express();
app.post('/api/messages', express.json(), createTeamsBotMiddleware({
  credentials: { appId: process.env.BOT_APP_ID!, appPassword: process.env.BOT_APP_PASSWORD! },
  handler,
}));
```

Fidelity matrix: F4 approvals + F5 long-running operations render natively in Teams chat; F1 composition forms and F3 workflows degrade to AC inputs or deep-link to the Tab. End-to-end walkthrough in [the Teams Bot cookbook](./cookbook/teams-bot-adaptive-cards.md).

---

### 26. External surface — GitHub Copilot Extension

> **Scenario.** Your developers and analysts already live in GitHub Copilot Chat (VS Code, JetBrains, github.com). You want them to invoke the catalog's tools from there — `@maverick-ediscovery place a legal hold for Project Phoenix`.

**Library responsibility.**
- `@infra-tools/agentic-ui-copilot-skill` is a server-side library that wraps the [GitHub Copilot Extensions](https://docs.github.com/copilot/building-copilot-extensions) webhook protocol: GitHub signed-request verification, body parse, identity extraction, OpenAI-shaped SSE response streaming.
- Same `SkillHandler` shape as the Teams Bot adapter — your existing agent loop plugs in unchanged.

**Wiring.**

```ts
import express from 'express';
import { createCopilotSkillMiddleware, type SkillHandler } from '@infra-tools/agentic-ui-copilot-skill';

const handler: SkillHandler = async function*({ body, identity }) {
  const principal = await mapGitHubToCatalog(identity);
  for await (const ev of yourAgent.run({ messages: body.messages, principal })) {
    if (ev.type === 'TEXT_MESSAGE_CONTENT') yield { type: 'text-delta', delta: ev.delta };
    // ... tool-call / tool-result / finish translation
  }
};

const app = express();
app.post('/copilot/skill',
  express.raw({ type: 'application/json' }),     // raw body required for signature verify
  createCopilotSkillMiddleware({ handler }),
);
```

Two-week vertical slice covering the protocol layer + the GitHub App registration. End-to-end walkthrough in [the GitHub Copilot Extension cookbook](./cookbook/github-copilot-extension.md).

---

### 27. External surface — Microsoft Copilot Studio Connector

> **Scenario.** Your enterprise runs on Microsoft 365 Copilot — across Word, Outlook, Teams, and the Copilot web surface. You want every catalog tool callable from Copilot Studio's NL routing without the user thinking about which app they're in.

**Library responsibility.**
- `@infra-tools/agentic-ui-copilot-studio-connector` ([ADR-042](./adr/0042-copilot-studio-connector.md)) translates Zod tool schemas into a Power Platform-importable Connector OpenAPI manifest at build time, then dispatches inbound action calls at runtime.
- `zodToOpenApi(schema)` covers the subset of Zod the catalog actually uses (primitives + refinements + format hints); unsupported types fall back to permissive `additionalProperties: true` with server-side re-validation as the safety net.
- `verifyConnectorJwt` validates the inbound Azure AD v2.0 bearer (audience + tenant whitelist + JWKS).
- Per-persona Connector publishing — junior staff don't see export tools.

**Wiring (build time).**

```ts
// Build a Connector OpenAPI doc from your Zod tool schemas.
import { buildConnectorManifest } from '@infra-tools/agentic-ui-copilot-studio-connector';
writeFileSync('dist/connector.json', JSON.stringify(buildConnectorManifest({
  title: 'Maverick eDiscovery',
  description: 'Catalog tools for M365 Copilot.',
  version: '1.0.0',
  host: 'agent.example.com',
  aadAppId: process.env.BOT_APP_ID!,
  aadTenantId: process.env.AAD_TENANT_ID,
  tools: catalogToolList,
})));
```

**Wiring (runtime).**

```ts
import express from 'express';
import { createConnectorMiddleware, type ConnectorActionHandler } from '@infra-tools/agentic-ui-copilot-studio-connector';

const handlers = new Map<string, ConnectorActionHandler>();
handlers.set('placeLegalHold', async ({ args, identity }) => {
  const principal = await mapAadToCatalog(identity);
  const hold = await yourAgent.dispatch('placeLegalHold', args, principal);
  return { message: `Hold ${hold.id} issued.`, adaptiveCard: hold.card, data: { holdId: hold.id } };
});

app.post('/api/copilot-studio/actions/:toolName',
  express.json(),
  createConnectorMiddleware({
    handlers,
    credentials: { expectedAudience: process.env.BOT_APP_ID!, allowedTenants: [process.env.AAD_TENANT_ID!] },
  }),
);
```

Import `dist/connector.json` into Power Platform → publish to Copilot Studio → done. End-to-end walkthrough including Azure AD app registration and Connector publish in [the Copilot Studio cookbook](./cookbook/copilot-studio-connector.md).

---

> **Note on GitHub Copilot Workspace.** Path 2b of the [Teams + Copilot integration plan](./plans/teams-copilot-integration-plan.md) covers a custom Workspace agent. **Deferred** as of 2026-05 — Workspace's extensibility API is still maturing and the Issues-tied surface doesn't map cleanly to eDiscovery flows. Revisit when GitHub stabilises the public agent contract.

---

## End-to-end coverage — video walkthroughs

Every use-case scenario in the eDiscovery flagship has a deterministic Playwright spec under [`e2e/specs/`](../e2e/specs/). The post-chat-surfaces tour spec ([`11-post-chat-surfaces.spec.ts`](../e2e/specs/11-post-chat-surfaces.spec.ts)) runs the §17–§22 pillars **without a Gemini key** — every assertion is against host-side registry state and dispatch-agnostic widgets, no chat turn — and records video for every test (`test.use({ video: 'on' })`).

### What it captures

| Spec test | Use case § | What the video shows |
|---|---|---|
| `§17 Workspace layouts — shellMode per route + per-persona density` | 17 | Chat shell mode flipping `rail` → `hidden` (Audit) → `pill` (Holds) → `rail` (Inbox) as the user clicks through the sidebar |
| `§18 In-context affordances — smart-cell + row-action-menu + bulk-toolbar` | 18 | Documents page AI-flag column + kebab menu opening + bulk toolbar materializing on row-select |
| `§19 Proactive triggers + inbox — seeded notifications visible` | 19 | `/inbox` route + header bell tray with the seeded notifications |
| `§20 Dashboards — 3 host + 3 MFE-contributed visible` | 20 | `/dashboards` picker showing **6 dashboards** total (3 from host + 3 federated remotes via `defineCapabilityModule({ dashboards })`) |
| `§21 Workflow surfaces — review-queue, timeline, cal` | 21 | `/review-queue`, `/timeline`, `/cal` routes loading their workflow widgets |
| `§22 Playbooks — picker + start run + chain-hashed steps` | 22 | `/playbooks` picker + clicking Start run + `<mvk-playbook-runner>` rendering the live state |
| `Custodians — assist-panel + interview-prep + lifecycle-stages` | 18 + WfF | `<mvk-assist-panel>` + the three-phase interview-prep surface on a selected custodian |
| `Holds — lifecycle-stages widget rendered` | WfA | The Hold lifecycle widget rendering Issue → Acknowledge → Track → Release |
| `Audit — chain-hash visualization renders + jump-to-entry works` | Audit | The hash-block strip + the click-to-jump-and-flash interaction |

### How to run

```bash
# 1. Start the shell + 3 MFE remotes locally (separate terminals)
ng serve demo-ediscovery-shell    --port 4300
ng serve demo-ediscovery-review   --port 4302
ng serve demo-ediscovery-production --port 4303
ng serve demo-ediscovery-search   --port 4304

# 2. Run the post-chat-surfaces spec (no agent server needed —
#    this spec is LLM-free)
cd e2e
npx playwright test specs/11-post-chat-surfaces.spec.ts
```

Outputs land in [`e2e/results/test-results/<spec>-<test>-chromium/`](../e2e/results/) — one `video.webm` per test. The HTML report links to each:

```bash
npx playwright show-report e2e/results
```

### CI

Set `CI=true` and Playwright spawns the four `ng serve` commands automatically (see [`e2e/playwright.config.ts`](../e2e/playwright.config.ts) `webServer:` block). No agent server is launched for this spec because it has no LLM dependency.

### Why no LLM key

The post-chat-surfaces design philosophy is that **the chat is one consumer of the registries, not the agent's only home**. The §17–§22 surfaces all read from `TriggerRegistry` / `DashboardRegistry` / `PlaybookRegistry` / `IntentRegistry` and emit through `(action)` / `(selected)` outputs — the host wires the dispatch. The spec exercises every wiring without ever calling the LLM. That's the architectural property the videos make visible: the agent surfaces work, governance and all, without a chat turn.

---

## Where to go next

- Look at [`examples/demo-remote-bookings/src/app/capability.ts`](../examples/demo-remote-bookings/src/app/capability.ts) to see how the remote contributes tools/widgets.
- Look at [`examples/demo-shell/src/app/app.config.ts`](../examples/demo-shell/src/app/app.config.ts) to see how the host loads remotes at boot.
- Read the cookbook:
  - [Federate an MFE](./cookbook/federate-an-mfe.md)
  - [Swap the backend](./cookbook/swap-backend.md)
  - [Observability](./cookbook/observability.md)
- Wire your app to a catalog server: [ADR-031](./adr/0031-provide-agentic-platform.md) walks through `provideAgenticPlatform` end-to-end. The [2026-05-10 platform audit](./audit/2026-05-10-platform-audit.md) explains *why* each of the four feature switches exists and what was missing before.
- Generate your own tool / widget / backend with the schematics:
  ```bash
  npx ng g @infra-tools/agentic-ui:tool myTool --project=demo-monolith
  npx ng g @infra-tools/agentic-ui:widget MyWidget --project=demo-monolith
  npx ng g @infra-tools/agentic-ui:backend AcmeBackend --project=demo-monolith
  ```

If anything in this guide doesn't behave as documented, please open an issue with:
- The output of `node --version && npm --version`
- The full Console output from the browser
- The terminal output from each of the three processes around the failure point
