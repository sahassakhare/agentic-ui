# Concepts & Taxonomy — `@infra-tools/agentic-ui`

> **Read this before** `DEVELOPER_GUIDE.md`. The library introduces ~30 named primitives. Many sound similar (Tool vs Action vs Intent; Widget vs Dashboard vs Layout). This doc defines each one, explains *why* it exists separately, and gives a "when to use what" matrix.
> **Audience**: any developer or architect getting up to speed.

---

## Table of contents

- [How registration and consumption work](#how-registration-and-consumption-work) — the flow that ties every primitive together
- [Layer 1 — Core primitives](#layer-1--core-primitives) (Chat shell · Registry · Tool · Widget · Backend · Agent server · ServerAgent)
- [Layer 2 — Capability primitives](#layer-2--capability-primitives) (Form · Workflow · Approval · Operation · Multi-modal · DataSource)
- [Layer 3 — Federation primitives](#layer-3--federation-primitives) (CapabilityModule · MFE remote · Host · `defineCapabilityModule` · `removeBySource` · Source tag)
- [Layer 4 — Coordination primitives](#layer-4--coordination-primitives) (Action · Intent · Persistence adapter · Validator)
- [Layer 5 — Post-chat surfaces](#layer-5--post-chat-surfaces) (Layout · SlotMap · LayoutResolver · Trigger · Dashboard · Playbook)
- [Layer 6 — Platform primitives](#layer-6--platform-primitives) (Persona · Scope policy · Telemetry sink · Catalog · Capability registrar / authorizer · Usage metering)
- [Layer 7 — Wire primitives](#layer-7--wire-primitives) (`AgenticEvent` · `AgenticMessage` · `MessageContent` · `ToolDef` · `ComponentDef` · `BackendCapabilities`)
- [Decision matrix — "When to use what"](#decision-matrix--when-to-use-what)
- [Glossary](#glossary) (alphabetical lookup)

---

## How registration and consumption work

The mental model is a **registration → storage → consumption** triangle. The primitives in Layer 1+ are the *what*; this section is the *how they connect*.

### Three roles, every entry plays them

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Author    │ Use a DSL factory: agenticTool({…}),                │
│               │ agenticWidget({…}), agenticForm({…}), etc.          │
│               │ Each produces a typed `Def` object (ToolDef,        │
│               │ ComponentDef, FormDef, …). In memory only — not     │
│               │ visible to anything yet.                            │
└──────────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────────┐
│  2. Register  │ Pass the Def to provideAgenticUi({tools: […],       │
│               │ widgets: […], forms: […], approvals: […]}) at boot, │
│               │ OR call registry.register(def) imperatively, OR     │
│               │ contribute via a federated CapabilityModule (the    │
│               │ remote calls register for you).                     │
│               │                                                     │
│               │ At this moment the Def lands in exactly one         │
│               │ registry — the typed catalog for its kind.          │
└──────────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────────┐
│  3. Consume   │ A runtime surface reads the registry — usually via  │
│               │ the registry's signal. Chat shell reads             │
│               │ ToolRegistry.signal() to advertise tools to the     │
│               │ LLM; widget container reads ComponentRegistry to    │
│               │ resolve widget names from agent events; form        │
│               │ renderer reads FormRegistry; etc.                   │
└──────────────────────────────────────────────────────────────────────┘
```

The same triangle applies to every primitive. Once you internalize it, the 18 registries stop being scary — they're 18 identical catalogs holding different `Def` types.

### Who registers what

Each DSL factory produces a typed `Def` that lands in exactly one registry.

| You author | DSL factory | Produces | Lands in registry |
|---|---|---|---|
| A tool | `agenticTool({…})` | `ToolDef` | `ToolRegistry` |
| A widget / component | `agenticWidget({…})` | `ComponentDef` | `ComponentRegistry` |
| A form | `agenticForm({…})` | `FormDef` | `FormRegistry` |
| A workflow | `agenticWorkflow({…})` | `WorkflowDef` | (passed inline to the workflow renderer; no global registry) |
| An approval policy | `agenticApproval({…})` | `ApprovalPolicy` | `ApprovalRegistry` |
| A data source | `agenticDataSource({…})` | `DataSourceDef` | `DataSourceRegistry` |
| An action | `agenticAction({…})` | `ActionDef` | `ActionRegistry` |
| An intent | `agenticIntent({…})` | `IntentDef` | `IntentRegistry` |
| A trigger | `agenticTrigger({…})` | `TriggerDef` | `TriggerRegistry` |
| A dashboard | `agenticDashboard({…})` | `DashboardDef` | `DashboardRegistry` |
| A playbook | `agenticPlaybook({…})` | `PlaybookDef` | `PlaybookRegistry` |
| A capability bundle | `defineCapabilityModule({tools, widgets, forms, …})` | `CapabilityModule` (a *bundle*) | `CapabilityRegistry` AND fans out into every inner registry on `apply()` |

**Capability is the meta-primitive.** It's a bundle that registers **other** kinds of entries when applied. Federation uses it because remote MFEs need to declare and tear down many entries together. A capability that contains five tools + three widgets + one form lands those nine entries in three registries (ToolRegistry, ComponentRegistry, FormRegistry) plus one entry in CapabilityRegistry (the descriptor). All nine inner entries get tagged with the same `source: 'remote:<name>'`, so a single `removeBySource(…)` tears them all down symmetrically.

### Who consumes what

What the app — your `<mvk-chat-shell>`, your widgets, your orchestrator — actually reads at runtime:

| Consumer | Reads from |
|---|---|
| `<mvk-chat-shell>` | `ToolRegistry` (advertises to LLM) + `ComponentRegistry` (renders widgets the agent emits) + `CapabilityRegistry` (the matter-coordinator summary in the rail) |
| Orchestrator (`runUntilSettled`) | `ToolRegistry` (dispatches client-side tool calls) + active `AgenticBackend` (streams events) |
| `<mvk-widget-container>` | `ComponentRegistry` (resolves widget names from agent events) + `DataSourceRegistry` (validates widget data-source deps before mount) |
| `<mvk-form-renderer>` | `FormRegistry` (resolves form names) + `ValidationRegistry` (validates submitted input) |
| `<mvk-workflow-renderer>` | (no global registry — workflow defs are passed inline) |
| `<mvk-approval-card>` | `ApprovalRegistry` (reads the pending approval; dispatches approve/reject) |
| `<mvk-operation-progress>` | `OperationRegistry` (reads the live `OperationState` signal) |
| `<mvk-cmd-k-palette>` | `IntentRegistry` (matches the user's text) + `ActionRegistry` (executes the chosen action) |
| `<mvk-smart-cell>` · `<mvk-row-action-menu>` · `<mvk-bulk-toolbar>` · `<mvk-assist-panel>` | `ActionRegistry` (dispatch) + `IntentRegistry` (NL → action routing) |
| `<mvk-notification-tray>` + `<mvk-inbox>` | `TriggerRegistry` (proactive notifications + the matching tool calls) |
| `<mvk-dashboard-canvas>` + `<mvk-dashboard-tile>` + `<mvk-dashboard-preview>` | `DashboardRegistry` (the composition) + `ToolRegistry` (each tile's invocation) + `DataSourceRegistry` (live-data tiles) |
| `<mvk-playbook-runner>` | `PlaybookRegistry` (steps) + `ToolRegistry` (per-step tool dispatches) + `ApprovalRegistry` (per-step approve gates) |
| `<mvk-workspace-layout>` | `LayoutRegistry` (slot defs) + `ComponentRegistry` (slot widgets) + (optional) `LayoutResolver` for the 11-source precedence engine |
| `<mvk-review-queue>` · `<mvk-timeline-canvas>` · `<mvk-cal-workbench>` | `ToolRegistry` (state-mutating actions) + `ComponentRegistry` (row widgets) |
| MCP server (`createMcpServer`) | (no Angular DI on the server side — takes `ToolDef[]` directly as a constructor argument) |
| Teams bot / M365 Agents / Copilot Skill / Copilot Studio Connector | (server-side middleware — your `Handler` callback dispatches against your own tool catalog; the lib's registries don't reach the Node server-side unless you explicitly inject them) |

### Three concrete flows (the diagrams)

**Flow 1 — Tool registration + consumption** (the simplest case):

```
                  YOU                            LIB                           RUNTIME
┌──────────────────────────────────┐   ┌────────────────────────┐   ┌────────────────────────────┐
│ agenticTool({                    │   │                        │   │  <mvk-chat-shell>          │
│   name: 'bookFlight',            │──▶│      ToolDef           │   │    .tools()                │
│   description: '…',              │   │     (in memory)        │   │   .signal()                │
│   schema: z.object({…}),         │   │                        │   │       ↓                    │
│   handler: async () => {…},      │   └───────────┬────────────┘   │  - Sends list to LLM       │
│ })                               │               │                │  - LLM picks 'bookFlight'  │
└──────────────────────────────────┘               │                │  - Orchestrator calls      │
                                                   ▼                │     the handler            │
┌──────────────────────────────────┐   ┌────────────────────────┐   │  - Handler returns         │
│ provideAgenticUi({               │──▶│   ToolRegistry         │──▶│     {components: [...]}    │
│   tools: [bookFlightTool, …],    │   │   .register(def)       │   │  - Widget mounts (Flow 2)  │
│   widgets: [...]                 │   │                        │   │                            │
│ })                               │   └────────────────────────┘   └────────────────────────────┘
└──────────────────────────────────┘
```

**Flow 2 — Widget registration + consumption** (the LLM picks the visual):

```
                  YOU                            LIB                           RUNTIME
┌──────────────────────────────────┐   ┌────────────────────────┐   ┌────────────────────────────┐
│ @Component({...}) class …        │   │                        │   │  Tool returns              │
│ agenticWidget({                  │──▶│      ComponentDef      │   │  {components: [{           │
│   name: 'flightCard',            │   │      (in memory)       │   │    name: 'flightCard',     │
│   component: FlightCardComponent,│   │                        │   │    props: {…} }]}          │
│   propsSchema: z.object({…})     │   └───────────┬────────────┘   │            ↓               │
│ })                               │               │                │  <mvk-chat-shell> emits a  │
└──────────────────────────────────┘               │                │   widget-render event      │
                                                   ▼                │            ↓               │
┌──────────────────────────────────┐   ┌────────────────────────┐   │  ComponentRegistry         │
│ provideAgenticUi({               │──▶│  ComponentRegistry     │──▶│  .get('flightCard')        │
│   widgets: [flightCardWidget,…], │   │  .register(def)        │   │            ↓               │
│ })                               │   │                        │   │  *ngComponentOutlet mounts │
└──────────────────────────────────┘   └────────────────────────┘   │  <app-flight-card>         │
                                                                    └────────────────────────────┘
```

**Flow 3 — Capability bundle (federation)** — multiple primitives registered together:

```
              REMOTE TEAM                          NATIVE FEDERATION                     HOST
┌──────────────────────────────────┐   ┌────────────────────────────────┐   ┌──────────────────────────┐
│ // remote/src/Capability.ts      │   │  remoteEntry.js (bundled)      │   │  loadRemoteCapabilities  │
│                                  │   │                                │   │  ({remote, loader})      │
│ defineCapabilityModule({         │──▶│   CapabilityModule             │──▶│           ↓              │
│   source: 'remote:bookings',     │   │   { source: …, version: …,     │   │  capability.apply({      │
│   version: '1.0.0',              │   │     tools: [bookFlightTool],   │   │    tools: ToolRegistry,  │
│   tools: [bookFlightTool],       │   │     widgets: [flightCardW…], } │   │    components: …,        │
│   widgets: [flightCardWidget],   │   │                                │   │    capabilities: …       │
│   forms: [intakeForm],           │   │   .apply(hostRegistries)       │   │  })                      │
│ })                               │   │   .dispose()                   │   │           ↓              │
│                                  │   │                                │   │   ToolRegistry +         │
│ export default capability;       │   │                                │   │   ComponentRegistry +    │
└──────────────────────────────────┘   └────────────────────────────────┘   │   FormRegistry +         │
                                                                            │   ... grow with the      │
                                                                            │   remote's contributions │
                                                                            │   (all tagged source:    │
                                                                            │   'remote:bookings')     │
                                                                            └──────────────────────────┘

  Unload — host calls loadedRemote.dispose() → removeBySource('remote:bookings') runs across
  every registry; entries vanish; the LLM no longer sees the remote's tools; symmetric teardown.
```

### Putting it together — the boot-time data flow

```
                ┌─────────────────────────────────────────────────────────┐
                │           app.config.ts (boot time)                      │
                │  provideAgenticUi({                                      │
                │    tools:     [bookFlightTool, ...],                     │
                │    widgets:   [flightCardWidget, ...],                   │
                │    forms:     [custodianIntakeForm, ...],                │
                │    approvals: [releaseHoldApproval, ...],                │
                │    dataSources: [userDirectoryDataSource, ...],          │
                │  })                                                      │
                └─────────────────────────────┬────────────────────────────┘
                                              │ Angular DI fan-out at boot
       ┌────────────┬───────────┬────────────┼───────────┬───────────┬──────────────┐
       ▼            ▼           ▼            ▼           ▼           ▼              ▼
   Tool       Component      Form       Approval   Operation    DataSource  ... 12 more
   Registry   Registry      Registry    Registry   Registry     Registry       registries
       │            │           │            │           │           │              │
       │            │           │            │           │           │              │
       │ also fed   │ also from │ also from  │ also from │ from      │ from app +   │
       │ by:        │ remotes,  │ remotes    │ remotes   │ longRunning│ remotes      │
       │ remotes,   │ ng g      │            │           │ tools     │              │
       │ ng g tool  │ widget    │            │           │           │              │
       ▼            ▼           ▼            ▼           ▼           ▼              ▼
              Consumer signals (read uniformly):  registry.signal()
                                       │
                                       ▼
       ┌──────────────────────────────────────────────────────────────────────┐
       │ Runtime consumers (above table): chat shell, widget container,       │
       │ form renderer, approval card, operation progress, dashboard canvas,  │
       │ playbook runner, command palette, smart cells, notification tray,    │
       │ inbox, lifecycle stages, review queue, timeline canvas, …            │
       └──────────────────────────────────────────────────────────────────────┘
```

**Three big takeaways from this picture:**

1. **Registration is multi-source.** Host wires entries via `provideAgenticUi`; the scaffolding generators (`ng g tool`, `ng g widget`) generate files that register into the same flow; federated remotes register via `loadRemoteCapabilities` post-boot. Every source funnels into the same registry; the source is tagged so teardown is clean.
2. **Consumption is via signals.** The lib's runtime UI is built on `signal()` / `computed()`. A consumer that reads `toolRegistry.signal()` re-renders automatically when the list changes — register a new tool from a federated remote, the chat shell sees it next render, no manual refresh.
3. **The 18 registries are 18 identical catalogs.** Same `register / list / get / signal / removeBySource / setScopePolicy` API across all of them. Adding a 19th for your own domain concept is ~30 LOC of base-class extension.

---

## Layer 1 — Core primitives

These are always required. If your app uses the library, it uses these.

### Chat shell — `<mvk-chat-shell>`

The visible primitive. A single Angular standalone component you drop into a route's template; renders the composer, the transcript, tool-call lines, mounted widgets, persona strip, and the abort button. Reads from every registry; doesn't own state — you can mount and unmount it freely.

**You don't subclass it.** You configure it via the `injectAgenticChat({ … })` factory (used internally) and the providers your `app.config.ts` registers.

### Registry — `RegistryBase<TDef>`

A DI-backed, signal-driven catalog with uniform semantics across the lib's 18 specific subclasses. Every registry exposes the same API surface:

```ts
register(entry: TDef): void
list(): readonly TDef[]
get(name: string): TDef | undefined
signal(): Signal<readonly TDef[]>
removeBySource(source: string): void
setScopePolicy(predicate): void   // filter-on-read
```

Conflict policies (set per-registry): `replace` (default), `throw`, `first-wins`, `namespace`. Federation symmetry across all subclasses; adding your own registry for a domain concept is ~30 LOC.

The 18 registries are grouped:
- **Core** (5): `ToolRegistry`, `ComponentRegistry`, `CapabilityRegistry`, `BackendRegistry`, `MfeRegistry`
- **Extended** (9): `ActionRegistry`, `IntentRegistry`, `FormRegistry`, `DataSourceRegistry`, `ApprovalRegistry`, `OperationRegistry`, `TriggerRegistry`, `DashboardRegistry`, `PlaybookRegistry`
- **Seams** (4): `ValidationRegistry`, `PersistenceRegistry`, `LayoutRegistry`, `SchemaTransformerRegistry`

### Tool — `ToolDef` (registered in `ToolRegistry`)

A typed, LLM-callable handler. You write it; the LLM picks which one to invoke based on the user's prompt and the tool's Zod-typed argument schema.

```ts
agenticTool({
  name: 'searchDocuments',
  description: 'Search documents in the active matter by query, custodians, or tags.',
  schema: z.object({ query: z.string(), tags: z.array(z.string()).optional() }),
  executeIn: 'host',         // or 'server'
  handler: async (args, ctx) => ({ count: 42, documents: […] }),
})
```

**Returns can include `components: [{name, props}]`** — that's how a tool result mounts a widget on the transcript. The handler runs whenever the LLM picks the tool; you don't decide.

### Widget (a.k.a. Component) — `ComponentDef` (registered in `ComponentRegistry`)

A standalone Angular component the LLM renders **by name**. The agent emits a `widget-render` event (directly from the server) or a tool returns `{ components: […] }`; the chat shell resolves the name through `ComponentRegistry`, validates props against the registered Zod schema, and mounts via `*ngComponentOutlet`.

```ts
agenticWidget({
  name: 'flightCard',
  component: FlightCardComponent,         // the Angular class
  propsSchema: z.object({ from: z.string(), to: z.string(), price: z.number() }),
})
```

Widgets are "components" inside Angular but "widgets" in the library's vocabulary because the LLM picks them, not the developer. **The terms are synonyms in this codebase.**

### Backend — `AgenticBackend`

Wire-protocol adapter. The library ships three: AG-UI (`provideAgUiBackend`), Hashbrown (`provideHashbrownBackend`), A2UI (`provideA2uiBackend`). Each translates between the library's canonical `AgenticEvent` stream and whatever the agent server speaks. Pluggable at config time; swappable at runtime via `BackendRegistry.setActive(id)`.

See [ADR-048](./adr/0048-backend-adapter-parity-contract.md) for the parity contract every adapter conforms to.

### Agent server

Your HTTP endpoint. Receives `{messages, tools, state}`; calls an LLM; streams events back. The lib doesn't ship an LLM — it ships:

- The wire contract (`AgenticEvent` union, route handler factory)
- A scaffold (`ng g @infra-tools/agentic-ui:agent-server`)
- A reference (`examples/demo-server`, `examples/demo-ediscovery-server`)

You write the server, in whatever framework (Hono, Express, Fastify, …) and stack (Node, Bun, Deno, …) you want, against any LLM (Gemini, OpenAI, Anthropic, Bedrock, Mastra, LangGraph, …).

### `ServerAgent` (interface)

Shape your server-side agent class implements. From [`@infra-tools/agentic-ui-server`](../projects/agentic-ui-server):

```ts
interface ServerAgent {
  run(input: AgenticRunInput): AsyncIterable<AgenticEvent>;
}
```

One implementation per agent (EchoAgent, GeminiAgent, OrchestratorAgent, …). Multiple implementations mounted in one server is normal — see `examples/demo-server` (six agents under one process).

---

## Layer 2 — Capability primitives

Opt-in per feature. Each is a `RegistryBase` subclass + a `DSL factory` for declarative authoring.

### Form (F1) — `FormDef` (in `FormRegistry`)

Schema-driven form widget. The agent can mount one inline in the chat panel by emitting a `formCard` widget event with a registered form name. The form renderer validates input client-side with Zod; on submit, calls a handler that ALSO doubles as a tool (same code runs whether the user types the prompt or fills the form).

Two flavors:
- **Predefined catalog**: you author the form schema; LLM picks which one to mount
- **Agent-generated**: LLM emits the entire form schema at runtime (F1*)

### Workflow (F3) — multi-step agent-driven flow

Sequence of widgets, one per step, with conditional `next` branches on aggregated state. `Back` preserves prior values; the terminal `Submit` runs the same domain handler as the equivalent one-shot tool. Use for guided intake (legal-hold placement wizard, customer onboarding, …).

```ts
agenticWorkflow({
  steps: […],
  onComplete: async (aggregated) => […],
})
```

### Approval (F4 — HITL) — `ApprovalPolicy` (in `ApprovalRegistry`)

Drape an `agenticApproval({…})` over any tool. The chat shell intercepts the LLM's call, queues an approval, and either renders an inline approval card OR a `/approvals` route entry. Persona-gated; cross-session safe; every transition appends to the audit chain.

Use for irreversible actions (release-hold, finalize-production, send-customer-email, …).

### Operation (F5 — long-running) — `OperationDef` (in `OperationRegistry`)

Tools marked `longRunning: true` return immediately with an `opId`; progress streams live via `ctx.reportProgress(opId, {pct, phase})`. Lifecycle states (started → progress → finished | failed) participate in the audit chain.

Use for jobs that take >5s (TAR classifier, bulk redaction, vector indexing, …).

### Multi-modal (F6) — `MessageContent` union

The user's message can be a `string` (legacy) or `MessageContent[]` (text + image + file parts). The composer surfaces paperclip / drag-drop / paste-image affordances. Backends advertising `BackendCapabilities.multiModal: true` consume the parts directly; backends without it fall back to a text-only synthesis (`[image: alt]` / `[file: name]` markers).

### DataSource — `DataSourceDef` (in `DataSourceRegistry`)

Typed pluggable data adapter. Widgets declare `dataSources: ['users']` and the mount-time validator verifies registration before instantiating. Adapter implementations: in-process, REST, GraphQL, federated remote. Swap implementations without changing widget code.

Use when a widget needs live data the agent didn't fetch (e.g., user info from your auth system, real-time prices, …).

---

## Layer 3 — Federation primitives

Skip these if you ship a single Angular app. Required when multiple teams contribute to one shell.

### CapabilityModule — what a remote ships

A bundle declaring what an MFE remote contributes to the host: tools + widgets + actions + forms + triggers + dashboards + playbooks. The host loads it; the host's registries grow. Unloading reaps every entry via `removeBySource`.

### MFE remote

An Angular app that exposes its capabilities to a host via Native Federation or Module Federation. Often *also* a standalone app that mounts the same widgets in a non-chat UI — single codebase, two surfaces. See [cookbook/domain-mfe-standalone-and-federated.md](./cookbook/domain-mfe-standalone-and-federated.md).

### Host

The Angular shell that loads remotes at runtime. One shell, many remotes. Discovery via `MfeRegistrySource` (static JSON, REST, Spring Boot catalog, …).

### `defineCapabilityModule({ source, version, tools, widgets, … })`

Declarative factory in the remote's `./Capability.ts`. Returns the apply/dispose pair the host invokes.

```ts
export const capability = defineCapabilityModule({
  source: 'remote:bookings',     // identifies entries for removeBySource
  version: '1.0.0',
  tools: [bookFlightTool],
  widgets: [flightCardWidget],
});
```

### `removeBySource(sourceTag)` — federation-symmetric teardown

Every registry implements it. On remote unload, `loadRemoteCapabilities` calls `removeBySource('remote:bookings')` across all 18 registries in one pass — no orphan entries.

### Source tag

A string identifying who-registered-what. Tools authored in the host get `source: 'host'`; tools from `loadRemoteCapabilities` get `source: 'remote:<name>'`. Drives the conflict policy + teardown.

---

## Layer 4 — Coordination primitives

These exist because not every interaction is a tool call. The lib has primitives for "the UI dispatched an action that doesn't need an LLM round-trip" (Action), "the user said something that maps to a known tool without consulting the LLM" (Intent), "the registry needs to validate something" (Validator), and "the registry needs to persist something" (Persistence).

### Action — `ActionDef` (in `ActionRegistry`)

NgRx-style command. Triggered by:
- A UI affordance (row menu, bulk toolbar, ⌘K palette entry, smart-cell click, …)
- An agent emitting a `ui-action` event (A2UI capability)

The action's `effect` runs locally — no LLM in the loop. Use for navigation, store mutations, form fills, modal open/close.

**Action vs Tool**: a Tool is LLM-callable (sent across the wire on every prompt); an Action is LOCAL (never sent to the LLM). If the LLM should decide whether to fire it, it's a Tool. If a button fires it, it's an Action.

### Intent — `IntentDef` (in `IntentRegistry`)

Natural-language string → action / tool dispatch. Use for *short-circuit* matches: if the user types "open the approvals page," you don't need an LLM round-trip to know what they meant. Intents are pre-LLM matches; uncovered prompts flow to the LLM as normal.

**Intent vs Action**: an Intent ROUTES; an Action EXECUTES. The Intent registry decides "this looks like an action dispatch"; the Action registry actually runs it.

### Persistence adapter — registered in `PersistenceRegistry`

Storage backend. Three built-in: `memory` (SSR/tests), `webStorage` (`localStorage` / `sessionStorage`), `indexedDb` (multi-MB capacity). Plus a `httpPersistenceStore` factory for server-backed tiers.

Use when a registry needs to survive a page reload (user-saved layouts, draft form values, conversation history, …).

### Validator — registered in `ValidationRegistry`

Pluggable schema validator. Default ships Zod; adopters compose Ajv / Joi / custom alongside. Used by the form renderer, the action dispatcher, and any custom registry consumer that wants typed validation.

---

## Layer 5 — Post-chat surfaces

The agent reaches beyond the chat rail. Each surface is a registry + a renderer.

### Layout — `LayoutDef` (in `LayoutRegistry`) + `SlotMap` (event payload)

Slot-based composition. A layout has named slots (`primary`, `sidebar`, `footer`, …); each slot resolves to a registered component. The LLM can emit a `layout-render` event with a SlotMap; the host mounts `<mvk-workspace-layout>` and renders accordingly.

### `LayoutResolver` — 11-source precedence engine

Combines layout inputs from multiple sources (agent, route, persona, matter-phase, selection, user-saved, time-of-day, …) into a single `ResolvedLayout`. Pure `computed()` over signals; recomputes when any input fires. See [ADR-046](./adr/0046-layered-layout-engine.md).

### Trigger — `TriggerDef` (in `TriggerRegistry`)

Cron / webhook / queue-fired tool call **without a user prompt**. Lands in the notification tray + the inbox route. Use for scheduled jobs, "you have a new approval pending," SLA-breach alerts, …

### Dashboard — `DashboardDef` (in `DashboardRegistry`)

Composition of tiles. Each tile's content comes from a tool invocation (re-invoked against `ToolRegistry`) or a data-source query or static props. LLM can propose dashboards via `proposeDashboard`. `TileResultCache` shares results across instances; persona-blocked tiles render as no-access stubs (not 403s).

### Playbook — `PlaybookDef` (in `PlaybookRegistry`)

Named, versioned, persona-scoped tool-call sequence. Runtime fires the steps sequentially with `origin: 'playbook'` chain-hashed audit. Per-step `requiresApproval` halts on an approve/skip gate; `continueOnError` lets the run survive a failed step. Signal-backed `RunningPlaybook` handle exposes live state + cancel.

---

## Layer 6 — Platform primitives

These wire the lib to a *catalog server* — central capability discovery + governance. Optional. Skip if your app stands alone.

### Persona

The active user's role (`paralegal`, `lead-counsel`, `partner`, …). Resolved via `AGENTIC_ACTIVE_PERSONA` (an Angular `Signal<string>` token). Drives scope policies, audit attribution, approval routing.

### Scope policy — `RegistryBase.setScopePolicy(predicate)`

Filter-on-read predicate. Applied uniformly across every registry: when the LLM lists tools, when the form renderer resolves forms, when the widget container resolves components. Returns true to surface the entry; false to hide it. The LLM literally cannot see hidden tools.

### Telemetry sink — `AgenticTelemetrySink`

Emits structured spans + events at every hot path: `agentic.run.start/end`, `agentic.tool_call.start/end`, `agentic.widget.render`, `agentic.federation.load.*`, `agentic.registry.*`, `agentic.platform.*`, `agentic.run.malformed_event`. Three flavors:
- `NoopTelemetrySink` (default — zero deps)
- `ConsoleTelemetrySink` (dev — `provideAgenticTelemetryConsole()`)
- `OtelTelemetrySink` (production — `provideAgenticTelemetry({ kind: 'otel', providers })`)

### Catalog

The cross-app capability discovery service. `@infra-tools/agentic-catalog-server` is the reference Spring-Boot implementation. Exposes `/capabilities`, `/personas`, `/mfes`, `/usage`, `/policy/decide` endpoints.

### Capability registrar

Auto-POSTs every locally-registered tool / widget to the catalog at app boot. Closes the "the catalog is decorative" gap. Idempotent via `(tenant, kind, name)` UNIQUE constraint.

### Capability authorizer

Catalog-driven deny-list composed onto the registry's scope policy. `lifecycle: 'disabled'` toggles on the catalog hide entries from `ToolRegistry` / `ComponentRegistry` reads. Closes "the ops console disable button is decorative."

### Usage metering

Wraps `AGENTIC_TELEMETRY_SINK` so tool-call / widget-render / federation-load events become catalog usage POSTs. Batched flush; `delegate` preserves the host's existing sink.

---

## Layer 7 — Wire primitives

The types crossing process boundaries. You don't usually author these directly — they're emitted by backends, consumed by the chat shell. But every developer eventually reads one of these to debug a wire-shape mismatch.

### `AgenticEvent` (discriminated union)

The wire-event shape every backend yields. 16 variants:

```
run-started · run-finished · run-error ·
text-delta · text-end ·
tool-call-start · tool-call-args · tool-call-end · tool-call-result ·
widget-render · layout-render · ui-action ·
operation-started · operation-progress · operation-finished · operation-failed
```

Zod-validated at the orchestrator boundary via `agenticEventSchema` ([slice L3](./plans/library-hardening-plan.md)). Malformed events emit `agentic.run.malformed_event` telemetry and drop, never crash.

### `AgenticMessage`

```ts
{ id, role: 'user' | 'assistant' | 'system' | 'tool',
  content: string | MessageContent[],
  toolCalls: AgenticToolCall[],
  widgets: AgenticWidgetInstance[] }
```

The library's internal message shape. Each backend's converter translates to/from its wire format (or, in Hashbrown / A2UI's case, posts it directly since their wire is server-defined).

### `MessageContent` (multi-modal F6)

Discriminated union: `{kind: 'text'} | {kind: 'image'} | {kind: 'file'}`. See [Multi-modal](#multi-modal-f6--messagecontent-union).

### `ToolDef`

What `ToolRegistry` stores:

```ts
{ name, description, schema, handler, executeIn?, longRunning?,
  source?, scopes?, parametersSchema (derived from schema), … }
```

### `ComponentDef`

What `ComponentRegistry` stores:

```ts
{ name, component (Angular class), propsSchema, dataSources?, source? }
```

### `BackendCapabilities`

Per-adapter flags:

```ts
{ streaming, clientTools, generativeUi, uiActions, multiModal? }
```

Drives capability-gated conformance checks. An adapter advertising `multiModal: true` must actually accept multi-part content; the conformance harness enforces.

---

## Decision matrix — "When to use what"

Eight common ambiguities the lib's primitives create.

### Tool vs Action vs Intent

| You want… | Use | Why |
|---|---|---|
| The LLM to decide whether to invoke it | **Tool** | Tools are sent to the LLM on every prompt; the model reasons over their schemas |
| A button to invoke it | **Action** | Actions run locally without LLM round-trip |
| The user's phrasing to short-circuit to a known action without the LLM | **Intent** | Intents pre-match prompts; uncovered prompts still flow to the LLM |
| Both a button AND LLM access | **Tool** + **Action** that calls the tool's handler directly | One handler, two entry points |

### Tool vs Form vs Workflow

| Scenario | Use |
|---|---|
| One-shot operation, the LLM provides all args | **Tool** |
| Need structured collection from a user (form + validation) | **Form** (F1) |
| Multi-step guided collection with conditional branches | **Workflow** (F3) |

All three end in a handler. Form's handler IS a tool's handler — same code; the form mounts when the LLM picks "the form needs to be filled" instead of "I have all the args."

### Tool vs Trigger

| Scenario | Use |
|---|---|
| Fires on a user prompt | **Tool** (the LLM picks it) |
| Fires on cron / webhook / queue without a prompt | **Trigger** |
| Fires on cron AND can ALSO be invoked by the user | Both — trigger calls the tool's handler |

### Widget vs Dashboard vs Layout

| You want… | Use |
|---|---|
| A single visual element rendered alongside a tool's text result | **Widget** |
| A composition of tiles (live data + tool re-invocations) on a dedicated page | **Dashboard** |
| A slot-based persona-shaped view (e.g. document preview + tag panel + chain of custody) | **Layout** |

All three resolve to widgets at the leaves. Dashboard is a special widget that mounts other widgets in tiles. Layout is a slot map of widgets at named positions.

### Approval vs Persona scope vs Catalog authorizer

| You want… | Use |
|---|---|
| Hide tools from the LLM based on user role | **Persona scope policy** (filter-on-read) |
| Require a senior reviewer to sign off before an action runs | **Approval** (HITL) |
| Toggle tools off centrally via an ops console without redeploying | **Catalog authorizer** (deny-list from catalog) |
| Fine-grained allow/deny per request using OPA policy | **`@infra-tools/agentic-ui-opa-authorizer`** |

These compose. A tool can have a persona scope AND an approval AND a catalog authorizer all gating it.

### DataSource vs Tool

| Scenario | Use |
|---|---|
| The LLM needs to fetch data to reason | **Tool** (LLM invokes; result becomes context) |
| A widget needs to fetch data to render | **DataSource** (widget instantiates; no LLM round-trip; saves tokens) |

DataSources are widget-level fetch seams. Tools are LLM-level fetch seams. Same backend can power both.

### Backend vs Agent server vs ServerAgent

| Concept | Lives where | What it does |
|---|---|---|
| **Backend** | Client-side (browser) | Translates between `AgenticEvent` stream and a specific wire protocol (AG-UI / Hashbrown / A2UI) |
| **Agent server** | Server-side (Node, Bun, Deno) | HTTP service that receives `{messages, tools, state}`, calls an LLM, streams events |
| **ServerAgent** | Server-side (interface) | The reasoning loop inside an agent server. One agent server can host multiple ServerAgent implementations (EchoAgent, GeminiAgent, OrchestratorAgent, …) |

### `provideAgenticPlatform` vs hand-rolled IAM / MFE / telemetry

| You have… | Use |
|---|---|
| A standalone app, no central catalog | Skip `provideAgenticPlatform`; wire `provideAgenticTelemetry` directly |
| Multiple apps sharing capabilities + a central ops view | Wire the platform provider; turn on the features you need |
| A mix (some apps centralized, some standalone) | Wire the platform provider in the centralized ones; the seam is per-feature opt-in |

---

## Glossary (alphabetical)

| Term | Layer | One-liner |
|---|---|---|
| `Action` / `ActionDef` | 4 | NgRx-style local command; no LLM round-trip |
| `agenticApproval` | 2 | DSL factory for HITL policies |
| `agenticDataSource` | 2 | DSL factory for typed data adapters |
| `AgenticBackend` | 1 | Interface every wire adapter implements |
| `AgenticEvent` | 7 | Discriminated union; the wire-event type |
| `AgenticMessage` | 7 | Canonical message shape (user / assistant / system / tool) |
| `agenticForm` | 2 | DSL factory for form widgets |
| `agenticTool` | 1 | DSL factory for tool handlers |
| `agenticWidget` | 1 | DSL factory for component registrations |
| `agenticWorkflow` | 2 | DSL factory for multi-step flows |
| `AGENTIC_ACTIVE_PERSONA` | 6 | InjectionToken; signal carrying the active persona id |
| `AGENTIC_TELEMETRY_SINK` | 6 | InjectionToken; the telemetry sink the lib emits to |
| `ApprovalPolicy` / `ApprovalRegistry` | 2 | HITL gate on a tool; queued approval surface |
| `BackendCapabilities` | 7 | Per-adapter flags (streaming, clientTools, generativeUi, …) |
| `BackendRegistry` | 1 | Catalog of `AgenticBackend` adapters; `setActive` swaps |
| `Capability` | 3 | What a remote ships: bundled tools + widgets + … |
| `CapabilityModule` | 3 | The exported `./Capability.ts` from an MFE remote |
| `Catalog` | 6 | Cross-app capability + persona discovery service |
| `ChatShellComponent` (`<mvk-chat-shell>`) | 1 | The visible chat surface |
| `ComponentRegistry` | 1 | Catalog of widgets; resolves agent-emitted names |
| `ConformanceSuite` / `runConformance` | 1 | Backend test harness; capability-gated checks |
| `Dashboard` / `DashboardRegistry` | 5 | Composition of tiles; LLM can propose layouts |
| `DataSource` / `DataSourceRegistry` | 2 | Typed pluggable data adapter |
| `defineCapabilityModule` | 3 | Federation-symmetric capability declaration |
| `Federation` | 3 | Loading MFE remotes at runtime into the host |
| `FakeAgenticBackend` | 1 (test) | Deterministic backend test double |
| `Form` / `FormRegistry` | 2 | Schema-driven inline form widget |
| `Host` | 3 | The Angular shell that loads remotes |
| `InMemoryTelemetrySink` | 6 (test) | Recording sink for spec assertions |
| `injectAgenticChat` | 1 | Hook used internally by `<mvk-chat-shell>`; can be used standalone |
| `Intent` / `IntentRegistry` | 4 | Pre-LLM phrasing match → action / tool dispatch |
| `Layout` / `LayoutRegistry` | 5 | Slot-based composition |
| `LayoutResolver` | 5 | 11-source precedence engine for the SlotMap |
| `loadRemoteCapabilities` | 3 | Host-side loader for an MFE remote |
| `MessageContent` | 7 | Multi-modal content union (text / image / file) |
| `MfeRegistry` / `MfeRegistrySource` | 3 | Discovery of available MFE remotes |
| `Operation` / `OperationRegistry` | 2 | Long-running tool execution with progress streaming |
| `parseAgenticEventStrict` | 7 | Shared NDJSON event parser with Zod validation |
| `Persistence adapter` / `PersistenceRegistry` | 4 | Pluggable storage backend |
| `Persona` | 6 | The active user's role; drives scope policies |
| `Playbook` / `PlaybookRegistry` | 5 | Versioned, chain-hashed tool-call sequence |
| `provideAgenticPlatform` | 6 | One-call wire-up of catalog integrations |
| `provideAgenticUi` | 1 | Core lib provider; registers tools + widgets |
| `provideAgUiBackend` / `provideHashbrownBackend` / `provideA2uiBackend` | 1 | Backend adapter providers |
| `Registry` / `RegistryBase` | 1 | Base class of every catalog in the lib |
| `removeBySource` | 3 | Federation-symmetric teardown across registries |
| `Scope policy` | 6 | Filter-on-read predicate per registry |
| `serializeToolsForWire` | 7 | Shared tool → JSON-Schema converter |
| `ServerAgent` | 1 | Server-side reasoning-loop interface |
| `SlotMap` | 5 | Layout payload: slot name → component + props |
| `Source tag` | 3 | String identifying who-registered-what for teardown |
| `Telemetry sink` | 6 | Where the lib emits structured events |
| `Tool` / `ToolDef` / `ToolRegistry` | 1 | LLM-callable typed handler |
| `Trigger` / `TriggerRegistry` | 5 | Cron / webhook / queue-fired tool call without user prompt |
| `UiActionDispatcher` | 1 (a2ui) | A2UI-channel action dispatcher (now thread-id-aware per ADR-048) |
| `Usage metering` | 6 | Per-tenant tool-call / widget-render / federation-load POSTs |
| `ValidationRegistry` | 4 | Pluggable Zod / Ajv / Joi / custom validators |
| `Widget` | 1 | Synonym for "component" in this lib's vocabulary |
| `Workflow` / `agenticWorkflow` | 2 | Multi-step guided flow with conditional branches |

---

## Where to go next

- **First time building?** [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md) — the sequenced 19-step journey.
- **Looking up a specific recipe?** [`cookbook/`](./cookbook/) — 46 topic-focused entries.
- **Designing for federation?** [ADR-005](./adr/0005-single-primary-entry.md) (single primary entry), [ADR-014](./adr/0014-host-version-compatibility.md) (host-version check), [cookbook/federate-an-mfe.md](./cookbook/federate-an-mfe.md).
- **Designing for governance / multi-tenancy?** [`audit/2026-05-10-platform-audit.md`](./audit/2026-05-10-platform-audit.md), [ADR-008](./adr/0008-registry-scope-policy.md), [ADR-033](./adr/0033-catalog-capability-authorizer.md).
