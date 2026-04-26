# `@maverick/agentic-ui` — Reusable Agentic UI Library + Schematics for Angular (with MFE)

> **Plan location.** Canonical path: `PLAN.md` at the repo root. A symlink at `~/.claude/plans/refer-the-architecture-and-glistening-curry.md` points here, so Claude's plan-mode edits and direct edits to `PLAN.md` stay in sync automatically.

## Context

The working directory `/Users/sahassakhare/my projects/ag_ui_maverick` is empty (greenfield). The intent is to design — and then build — a publishable Angular library plus an Angular schematics collection that turns any Angular 21 app into an *agentic UI host* in one command, with first-class support for microfrontends and pluggable backends for **AG-UI**, **Hashbrown UI**, and **A2UI**.

The architecture is informed by:
- The angularachitects.io article *"Understanding AG-UI: The Standard for Agentic User Interfaces"* — AG-UI is a transport-agnostic, message-based protocol with lifecycle / text / tool-call event classes (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`), supporting streaming via SSE, and distinguishing server-side tools from client-side tools and "generative UI" (LLM emits JSON specifying which registered components to render).
- The reference implementation [`angular-architects/flights42`](https://github.com/angular-architects/flights42/tree/agentic), an Angular 21 + Mastra workspace whose `libs/ag-ui-client` (factory `agUiResource()` using Angular's `resource()` + signals, `<widget-container>` with `*ngComponentOutlet`, generative-UI `show-component` tool with Zod discriminated unions, runUntilSettled loop) and `libs/ag-ui-server` (extended Mastra agent → AG-UI events, SSE route) demonstrate the building blocks but are *single-app, in-repo* — not reusable.
- The user's existing sibling project `mfe-registry-platform` (Java/Spring Boot service for MFE deployment registration), which the new library will integrate with via a pluggable adapter alongside a simpler static-JSON adapter.

**Decisions confirmed up front (from the user):**
- Workspace: **Angular CLI multi-project** (no Nx).
- MFE registry: **support both** the existing Spring Boot service and a static-JSON registry via a pluggable `MfeRegistrySource` interface.
- Scope: **full A2UI and Module Federation parity from M3 onward** — Native Federation is the default, but webpack Module Federation is a peer path, not deferred.

---

## 1. Goals and Non-Goals

**Goals**
- Ship a publishable npm package family + `ng add` story that turns any Angular 21 app into an agentic UI host in one command.
- Define a single `AgenticBackend` abstraction so the same chat shell, registries, and widget container work against AG-UI, Hashbrown, or A2UI without re-authoring UI code.
- Make tools and generative-UI components MFE-native: a remote contributes capabilities at load time and the host's in-flight chat picks them up next turn.
- Provide a complete schematics collection covering app bootstrap, tool, widget, backend adapter, MFE capability module, and an optional agent server.
- Support **both** Native Federation (esbuild canonical) and webpack Module Federation as first-class peer paths from M3.
- Ship a **layered registry system** — five core registries the chat shell depends on, four extended registries (Action, Intent, Form, Data Source) for full agent-driven UI, and four extension seams (Validation, Persistence, Layout, Schema Transformer) — all sharing one uniform `Registry<TDef>` shape so MFE teardown, signal subscription, and testing are identical across registries.
- Treat **observability as first-class** via OpenTelemetry: a single trace covers `chat shell → backend adapter → SSE route → agent → LLM → tool execution`, with W3C trace-context propagated across the SSE boundary. Telemetry emit points are baked in from M1 behind a no-op default; the OTel-backed sink ships in `@maverick/agentic-ui/otel` so apps that don't need it pay zero bundle cost.
- Standalone-API only (no NgModules), signals-first, esbuild-compatible, strict TS.

**Non-Goals**
- Re-implementing `@ag-ui/client`, Hashbrown core, or any LLM SDK — the library composes them.
- Hosting a registry service ourselves; we integrate with the user's `mfe-registry-platform` and offer a static-JSON alternative.
- General-purpose chat UI; the chat shell is opinionated for tool-call + generative-UI flows.
- A full agent-server framework; only thin Mastra/Express scaffolds are generated.

---

## Architecture at a Glance

End-to-end view of the system: UI components → registries → backend adapters → federation → remotes; plus the agent server and the external MFE registry.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                          ANGULAR HOST APPLICATION  (browser)                          │
│                                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     UI LAYER  (standalone Angular components)                    │  │
│  │                                                                                  │  │
│  │   <maverick-chat-shell>     <maverick-widget-container>     <maverick-form-      │  │
│  │   transcript · input ·      *ngComponentOutlet renders     renderer>             │  │
│  │   backend-switch UI         components by name             schema-driven (M4)    │  │
│  │           │                          ▲                              ▲            │  │
│  │           │ injectAgenticChat()      │ resolves from                │            │  │
│  │           ▼                          │ ComponentRegistry            │            │  │
│  │  ┌────────────────────────────────────────────────────────────────────────────┐ │  │
│  │  │              AGENTIC CORE  (Angular 21 resource() + signals)              │ │  │
│  │  │  runUntilSettled loop · message stream · abort · turn orchestration        │ │  │
│  │  └────────────────────────────────────────────────────────────────────────────┘ │  │
│  └────────────┬────────────────────────────────────────────────────────────────────┘  │
│               │ reads / writes via uniform Registry<TDef>                              │
│  ┌────────────┴────────────────────────────────────────────────────────────────────┐  │
│  │                  REGISTRY LAYER  (13 root injectables, signal-backed)           │  │
│  │                                                                                  │  │
│  │  CORE  (M1–M3) — chat shell depends on these                                     │  │
│  │   ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐            │  │
│  │   │  Tool    │ │Component │ │ Capability │ │ Backend  │ │   MFE    │            │  │
│  │   │ Registry │ │ Registry │ │  Registry  │ │ Registry │ │ Registry │            │  │
│  │   └──────────┘ └──────────┘ └────────────┘ └──────────┘ └──────────┘            │  │
│  │                                                                                  │  │
│  │  EXTENDED  (M4–M5) — full agent-driven UI                                        │  │
│  │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐                       │  │
│  │   │  Action  │ │  Intent  │ │   Form   │ │  DataSource  │                       │  │
│  │   │ Registry │ │ Registry │ │ Registry │ │   Registry   │                       │  │
│  │   └──────────┘ └──────────┘ └──────────┘ └──────────────┘                       │  │
│  │                                                                                  │  │
│  │  SEAMS  (M4–M5) — interface + thin default; consumer plugs in                    │  │
│  │   ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────────┐                 │  │
│  │   │Validation│ │Persistence │ │  Layout  │ │SchemaTransformer │                 │  │
│  │   │ Registry │ │ Registry   │ │ Registry │ │    Registry      │                 │  │
│  │   └──────────┘ └────────────┘ └──────────┘ └──────────────────┘                 │  │
│  └─────────────────────────────────────────────────────────────────────────────────┘  │
│               │ AgenticBackend.run(input)  →  AsyncIterable<AgenticEvent>              │
│               ▼                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│  │                          BACKEND ADAPTER LAYER                                   │  │
│  │                                                                                  │  │
│  │   ┌─────────────────┐    ┌──────────────────┐    ┌────────────────┐             │  │
│  │   │  AgUiBackend    │    │ HashbrownBackend │    │  A2uiBackend   │             │  │
│  │   │  (@ag-ui/client │    │ (@hashbrunch/    │    │  (ui-action    │             │  │
│  │   │   HttpAgent SSE)│    │   core stream)   │    │   dispatcher)  │             │  │
│  │   └────────┬────────┘    └────────┬─────────┘    └────────┬───────┘             │  │
│  └────────────┼──────────────────────┼───────────────────────┼─────────────────────┘  │
│               │                      │                       │                         │
│  ╔════════════╪══════════════════════╪═══════════════════════╪═════════════════════╗  │
│  ║                          FEDERATION RUNTIME                                      ║  │
│  ║   Native Federation  (esbuild · @angular-architects/native-federation)           ║  │
│  ║                              OR                                                  ║  │
│  ║   Module Federation  (webpack · @module-federation/runtime)                      ║  │
│  ║   loadRemoteCapabilities() — pushes into Tool/Component/Action/Form registries   ║  │
│  ╚══════════════════╤══════════════════════════╤═══════════════════════════════════╝  │
│                     │                          │                                        │
│        ┌────────────▼─────────────┐ ┌──────────▼───────────────┐                       │
│        │  Remote MFE A: bookings  │ │ Remote MFE B: loyalty    │                       │
│        │  CapabilityModule        │ │ CapabilityModule         │                       │
│        │   · tools, widgets,      │ │  · tools, forms, actions │                       │
│        │     actions              │ │  · capabilities.json     │                       │
│        │   · capabilities.json    │ │                          │                       │
│        └──────────────────────────┘ └──────────────────────────┘                       │
└────────────────────────────┬───────────────────────────────────┬───────────────────────┘
                             │ HTTP / SSE                        │ HTTP discovery
                             ▼                                   ▼
┌────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│        AGENT SERVER  (Node.js)         │   │       MFE REGISTRY  (external)           │
│        @maverick/agentic-ui-server     │   │       via MfeRegistrySource adapter      │
│                                        │   │                                          │
│   /api/ag-ui  ── SSE route             │   │   ┌────────────────────────────────┐    │
│       │   validates threadId / runId / │   │   │ Spring Boot service            │    │
│       │   messages, returns event      │   │   │ (mfe-registry-platform)        │    │
│       │   stream                       │   │   │  · POST /mfes  (from CI)       │    │
│       ▼                                │   │   │  · GET  /mfes?env=...          │    │
│   ExtendedMastraAgent                  │   │   │  · SSE  /mfes/watch (M5)       │    │
│   (Mastra fullStream → AG-UI events)   │   │   └────────────────────────────────┘    │
│       │                                │   │                  OR                      │
│       ▼                                │   │   ┌────────────────────────────────┐    │
│   Mastra Tools (server-side):          │   │   │ Static JSON registry           │    │
│   · bookFlight · cancelFlight · ...    │   │   │ (CDN-hosted manifest)          │    │
│       │                                │   │   └────────────────────────────────┘    │
│       ▼                                │   │                                          │
│   LLM Provider (OpenAI · Anthropic ·   │   │   provideSpringBootMfeRegistry()         │
│   Google) ── streaming                 │   │   provideStaticJsonMfeRegistry()         │
└────────────────────────────────────────┘   └──────────────────────────────────────────┘
```

**Read top-to-bottom:** the chat shell talks to the registry layer through the agentic core; the core talks to whichever `AgenticBackend` is active; the backend either streams from the agent server (AG-UI / Hashbrown) or dispatches `ui-action` events through the registry layer (A2UI). Federation runtime — Native or Module — is *orthogonal*: it loads MFE remotes into the same browser realm so their `CapabilityModule` can push into the registries directly. The agent server and the MFE registry are external services with documented contracts; the library composes them but does not host them.

**Key invariants visible in the diagram:**
- Only the registry layer is shared state. The chat shell, backend adapters, federation runtime, and remotes never communicate sideways — they all go through registries. This is what makes registries the single MFE-aware teardown surface.
- The agent server and the MFE registry are independent: a deployment can ship one without the other (e.g., a non-MFE single-app demo has an agent server but no registry; a fully federated MFE host always has both).
- `AgenticBackend.capabilities` flags are checked by the chat shell to feature-detect: `clientTools=false` hides the tools sidebar, `generativeUi=false` hides the widget rail, `uiActions=false` skips the A2UI dispatcher wiring.
- An **observability plane** crosscuts every layer: every box in the diagram pushes events into `AgenticTelemetrySink`. With `@maverick/agentic-ui/otel` enabled, this becomes OpenTelemetry spans / metrics / logs, with W3C `traceparent` propagated across the SSE boundary so a single trace covers `chat shell → backend adapter → SSE route → Mastra agent → LLM → tool execution`. Detail in §6.5.

---

## 2. Workspace Layout (Angular CLI multi-project)

Single `angular.json` workspace, projects under `projects/`. Libraries are built with `ng-packagr` and use per-folder `ng-package.json` files for secondary entry points (the canonical Angular CLI mechanism — no Nx required).

```
ag_ui_maverick/
  angular.json                                # single CLI workspace, multiple projects
  package.json                                # workspace deps + scripts
  tsconfig.base.json
  projects/
    agentic-ui/                               # @maverick/agentic-ui (publishable)
      ng-package.json                         # primary entry
      src/lib/                                # providers, registries, chat shell
      ag-ui/                                  # secondary entry — has its own ng-package.json
      hashbrown/                              # secondary entry
      a2ui/                                   # secondary entry
      mfe/                                    # secondary entry
      mfe-module-federation/                  # secondary entry (webpack MF runtime path)
      testing/                                # secondary entry — fakes & harnesses
    agentic-ui-schematics/                    # @maverick/agentic-ui-schematics (publishable)
      collection.json
      ng-add/, chat-shell/, tool/, widget/, backend/, mfe-capability/, agent-server/
    agentic-ui-server/                        # @maverick/agentic-ui-server (Node, publishable)
      src/                                    # AG-UI SSE route factory, Mastra glue, memory store
    demo-monolith/                            # application — flights42 parity, no MFE
    demo-shell/                               # application — Native Federation host
    demo-shell-mf/                            # application — webpack Module Federation host
    demo-remote-bookings/                     # application — remote MFE contributing tools + widgets
    demo-remote-loyalty/                      # application — second remote MFE
    demo-server/                              # application (Node) — Mastra agent server with AG-UI route
  e2e/                                        # Playwright across host + remotes
  scripts/                                    # build-all, publish, federation manifest gen
  docs/
    adr/                                      # architecture decisions
    cookbook/                                 # how-to guides
```

**Notes on Angular CLI mechanics:**
- Secondary entry points use the standard `ng-packagr` convention: a child folder with its own `ng-package.json` and `src/public-api.ts`. They are imported as `@maverick/agentic-ui/ag-ui`, `@maverick/agentic-ui/hashbrown`, etc.
- The schematics collection ships as a separate package (`@maverick/agentic-ui-schematics`) so consumers can use just the runtime library without pulling schematic-only deps. `ng add @maverick/agentic-ui` resolves to the schematics package's `ng-add`.
- Federation is wired per-app via `@angular-architects/native-federation` (esbuild) or `@angular-architects/module-federation` (webpack); both are app-side concerns, not library concerns.

---

## 3. Library Package Design

**Primary package**: `@maverick/agentic-ui` — peer-dep on `@angular/core@^21`, `zod`. Optional peers: `@ag-ui/client`, `@hashbrunch/core` (or whatever Hashbrown's canonical scope is), `@module-federation/runtime`.

**Entry points and key public API:**

| Entry | Symbols |
| --- | --- |
| `@maverick/agentic-ui` | `provideAgenticUi(config)`, `injectAgenticChat()`, `<maverick-chat-shell>`, `<maverick-widget-container>`, `agenticTool()`, `agenticWidget()`, `agenticAction()`, `agenticIntent()`, `agenticForm()`, `agenticDataSource()`, `AgenticBackend`, base `Registry<TDef>`, plus the registries: `ToolRegistry`, `ComponentRegistry` (alias `WidgetRegistry`), `CapabilityRegistry`, `BackendRegistry`, `ActionRegistry`, `IntentRegistry`, `FormRegistry`, `DataSourceRegistry`, `ValidationRegistry`, `PersistenceRegistry`, `LayoutRegistry`, `SchemaTransformerRegistry` |
| `/ag-ui` | `provideAgUiBackend(opts)`, `AgUiBackend` |
| `/hashbrown` | `provideHashbrownBackend(opts)`, `HashbrownBackend` |
| `/a2ui` | `provideA2uiBackend(opts)`, `A2uiBackend`, `'ui-action'` event surface |
| `/mfe` | `provideMfeCapabilities()`, `defineCapabilityModule()`, `loadRemoteCapabilities()`, `MfeRegistryClient`, `MfeRegistrySource`, `provideSpringBootMfeRegistry()`, `provideStaticJsonMfeRegistry()`, manifest types |
| `/mfe-module-federation` | `loadRemoteCapabilitiesMF()` — webpack MF runtime variant of the same API |
| `/otel` | `provideAgenticTelemetry({...})`, `AgenticTelemetrySink`, `AgenticLogger`, OTel-backed exporters, span/metric definitions |
| `/testing` | `FakeAgenticBackend`, `harnessChat()`, `mockToolCall()`, registry test utilities, in-memory `AgenticTelemetrySink` for assertion |

**Top-level provider:**

```ts
export function provideAgenticUi(cfg: {
  backend: EnvironmentProviders;                   // e.g. provideAgUiBackend({...})
  tools?: AgenticToolDefinition[];
  widgets?: AgenticWidgetDefinition[];
  mfe?: {
    source?: EnvironmentProviders;                 // provideSpringBootMfeRegistry({url}) | provideStaticJsonMfeRegistry({url})
    federation?: 'native' | 'module-federation' | 'none';
    remotes?: RemoteSpec[];
  };
  ui?: { theme?: 'default' | 'minimal'; transcriptMaxItems?: number };
}): EnvironmentProviders;
```

`provideAgenticUi` registers the four browser registries (Tool, Widget, Capability, Backend) as root services and wires the chosen backend providers. `<maverick-chat-shell>` injects `injectAgenticChat()` which uses Angular 21 `resource()` + signals (the same pattern as `agUiResource` in flights42) and is backend-agnostic — it talks to `AgenticBackend`, never to a protocol directly.

---

## 4. Registries — Layered Design

The library exposes **13 registries** grouped into three tiers. Every registry implements one uniform `Registry<TDef>` interface so MFE-aware teardown, signal subscription, and conformance testing are identical across them. Most apps will only ever touch `ToolRegistry` and `ComponentRegistry` directly; the rest are opt-in.

### 4.1 Uniform registry contract

```ts
export interface Registry<TDef extends { name: string; source?: string }> {
  register(def: TDef): () => void;            // returns disposer
  registerAll(defs: TDef[]): () => void;
  get(name: string): TDef | undefined;
  list(): readonly TDef[];
  readonly signal: Signal<readonly TDef[]>;   // reactive snapshot
  removeBySource(source: string): void;       // MFE-aware teardown
}
```

This uniformity is the architectural payoff: adding a new registry is a copy-paste of the base implementation, and the MFE handoff in Section 6 works for every registry without per-registry plumbing.

### 4.2 Core registries (M1–M3) — the chat shell depends on these

| # | Registry | Inspiration | Lives in | Shape (TDef) |
| - | -------- | ----------- | -------- | ------------ |
| 1 | **ToolRegistry** | OpenAI function calling, LangChain agents | Browser, root | `{ name, description, schema: Zod, handler: (args, ctx) => Promise<ToolResult>, source }` |
| 2 | **ComponentRegistry** *(alias `WidgetRegistry`)* | Angular Dynamic Component Loader, multi-provider DI | Browser, root | `{ name, component: Type<unknown>, propsSchema: Zod, source }` — consumed by `<maverick-widget-container>` via `*ngComponentOutlet` |
| 3 | **CapabilityRegistry** | Backstage plugin system, VS Code extensions | Browser, root | `{ remoteName, version, exposes: { tools, components, actions?, forms? }, manifestUrl }` — populated by `loadRemoteCapabilities()` |
| 4 | **BackendRegistry** | (specific to this design) | Browser, root | `{ id: 'ag-ui'\|'hashbrown'\|'a2ui'\|string, factory, label, capabilities }` — enables runtime backend-switch UI |
| 5 | **MfeRegistry / DomainRegistry** *(external)* | Module Federation, single-spa | Spring Boot service **or** static JSON via pluggable `MfeRegistrySource` | `{ remoteName, version, deploymentUrl, capabilityManifestUrl, env, healthStatus? }` |

**MfeRegistrySource adapter (pluggable):**

```ts
export interface MfeRegistrySource {
  readonly id: 'spring-boot' | 'static-json' | string;
  discover(env: string): Promise<RemoteSpec[]>;
  watch?(env: string): Observable<RemoteSpec[]>;       // SSE for Spring Boot; no-op for static JSON
}

provideSpringBootMfeRegistry({ url: string, auth?: HttpAuth })
provideStaticJsonMfeRegistry({ url: string, refreshIntervalMs?: number })
```

Consumers add a third adapter (Consul, Etcd, internal REST) without forking the library.

### 4.3 Extended registries (M4–M5) — full agent-driven UI

These lift the agent from "can call tools and render widgets" to "can drive the whole UI." They ship in M4–M5 and are gated behind `AgenticBackend.capabilities` flags so apps can opt in.

| # | Registry | Inspiration | Shape (TDef) | Notes |
| - | -------- | ----------- | ------------ | ----- |
| 6 | **ActionRegistry** | NgRx actions + effects (command pattern) | `{ type, payloadSchema: Zod, effect: (payload, ctx) => void\|Promise<void>, source }` | Maps the `ui-action` event class (used by A2UI) onto application-defined commands. NgRx-compatible: an action's `effect` can dispatch into an existing NgRx `Store`. |
| 7 | **IntentRegistry** | OpenAI function-call routing, LangChain agents | `{ id, examples: string[], schema: Zod, mapsTo: { kind: 'tool'\|'action'\|'route'; target: string } }` | A *router*, never executes. Lets common phrases short-circuit pre-LLM (offline / restricted / latency-sensitive flows). |
| 8 | **FormRegistry** | Angular dynamic forms, react-jsonschema-form | `{ name, fieldsSchema: Zod\|JsonSchema, ui: { order, layout }, submit: (values) => Promise<void>, source }` | Pairs with `<maverick-form-renderer>` to render schema-driven forms the agent can fill, validate, and submit. |
| 9 | **DataSourceRegistry** | Apollo Client, Angular `HttpClient` | `{ name, kind: 'rest'\|'graphql'\|'sse'\|'http', adapter: (query) => Observable<unknown>, source }` | Tools call `inject(DataSourceRegistry).get('flights').query(...)` instead of hard-coding fetch URLs. Enables stubbing in tests + per-env routing. |

### 4.4 Extension seams (interface + thin default; consumer plugs in)

These are useful in many apps but not strictly tied to agentic UI. We ship the interface and a thin default; consumers replace freely.

| # | Registry | Inspiration | Default shipped | Tier |
| -- | -------- | ----------- | --------------- | ---- |
| 10 | **ValidationRegistry** | Angular Validators, Ajv, Zod | Yes — Zod default; pluggable Ajv/Joi | M4 |
| 11 | **PersistenceRegistry** | Browser Storage APIs, Dexie.js | Yes — `localStorage`, `sessionStorage`, in-memory; Dexie example | M5 |
| 12 | **LayoutRegistry** | Angular CDK Layout, Gridstack.js | No default — interface + CDK example | M5 |
| 13 | **SchemaTransformerRegistry** | OpenAPI, JSON Schema | Yes — JSON Schema↔Zod; OpenAPI→Tool import helper | M5 |

### 4.5 Inter-registry relationships

Registries don't live in isolation. The dependency graph determines boot order and clarifies ownership:

```
                   IntentRegistry
                    /       |    \
            ToolRegistry  ActionRegistry  (route)        BackendRegistry
                |              |                              |
                v              v                              v
        ComponentRegistry  FormRegistry              AgenticBackend.run(...)
                |              |                              |
                v              v                              v
        WidgetContainer    FormRenderer            <maverick-chat-shell>

   Cross-cutting (used by all):
     ValidationRegistry   PersistenceRegistry   DataSourceRegistry   SchemaTransformerRegistry

   Federation / discovery:
     MfeRegistry → CapabilityRegistry → fans out into Tool / Component / Action / Form registries
```

Concretely:
- **CapabilityRegistry** is the fan-out point: when a remote loads, its `CapabilityModule` pushes entries into Tool, Component, Action, Form registries — all in one transaction so the `signal`s update together (see §6).
- **IntentRegistry** is a *router*; it never executes. Maps NL intents → a tool name OR action type OR route. Useful for short-circuiting common phrases pre-LLM and for offline/restricted environments.
- **ValidationRegistry** is consumed *by* every registry that has a `schema` field — it's how `register(def)` validates the def itself before storing.
- **SchemaTransformerRegistry** lets a single OpenAPI spec or JSON Schema produce: a tool definition, a form, and a Zod validator — all from one source.
- **DataSourceRegistry** is the bridge tools use to talk to APIs without hard-coding fetch URLs.
- **PersistenceRegistry** stores conversation history, draft form values, and the active `BackendRegistry` selection across reloads.
- **LayoutRegistry** is the optional layer that lets the agent ask for `{ layout: 'split-3-7', slots: { left: <widget>, right: <form> } }` instead of a single component.

### 4.6 Placement rationale

- **Browser, root scope** for everything except MfeRegistry. MFE remotes load into the browser at runtime and need to push into a process the chat shell is reading from. Server-side persistence would create stale-state risk and add a network hop per chat turn.
- **MfeRegistry alone is external** — deployments outlive any browser session and discovery must work before any user logs in.

### 4.7 MFE-aware behavior (uniform across all 13)

Every registry entry carries a `source` field (`'host'` or `'remote:<name>'`). When a remote unloads, `removeBySource('remote:<name>')` runs on every registry in one pass; signals notify their subscribers; in-flight runs continue, but the next turn's tool/widget/action/form list excludes the removed capabilities.

---

## 5. AgenticBackend Abstraction

A single interface all three protocols implement. The chat shell sees only this surface:

```ts
export interface AgenticRunInput {
  threadId: string;
  runId: string;
  messages: AgenticMessage[];
  tools: ToolDef[];                    // snapshot from ToolRegistry
  widgets: WidgetDef[];                // snapshot from WidgetRegistry
  signal: AbortSignal;
}

export type AgenticEvent =
  | { type: 'run-started'; threadId: string; runId: string }
  | { type: 'run-finished'; runId: string }
  | { type: 'run-error'; runId: string; error: { code: string; message: string } }
  | { type: 'text-delta'; messageId: string; delta: string }
  | { type: 'text-end'; messageId: string }
  | { type: 'tool-call-start'; toolCallId: string; name: string }
  | { type: 'tool-call-args'; toolCallId: string; delta: string }
  | { type: 'tool-call-end'; toolCallId: string }
  | { type: 'tool-call-result'; toolCallId: string; result: unknown }
  | { type: 'widget-render'; widgetCallId: string; name: string; props: unknown }
  | { type: 'ui-action'; actionId: string; op: string; payload: unknown };       // A2UI

export interface AgenticBackend {
  readonly id: string;
  readonly capabilities: { streaming: boolean; clientTools: boolean; generativeUi: boolean; uiActions: boolean };
  run(input: AgenticRunInput): AsyncIterable<AgenticEvent>;
  reset?(threadId: string): Promise<void>;
}
```

**Mapping per protocol:**
- **AG-UI adapter** — thinnest wrapper around `@ag-ui/client`. AG-UI's `TEXT_MESSAGE_*` / `TOOL_CALL_*` / `RUN_*` map 1:1 to our event union. Generative UI arrives via the `show-component` tool result; the adapter emits a synthetic `widget-render` event so the shell stays protocol-agnostic.
- **Hashbrown adapter** — Hashbrown's UI-generation streams emit component+props natively → `widget-render`. Hashbrown text streaming → `text-delta`. Tool-calling maps to the tool-call event group. Mismatch: Hashbrown lacks AG-UI's explicit `runId` lifecycle, so the adapter synthesizes `run-started` / `run-finished` from stream open/close.
- **A2UI adapter** — implements `AgenticBackend` and uses the reserved `ui-action` event for the agent-issued UI ops (route changes, store mutations, form fills) that are A2UI's distinguishing feature. The chat shell forwards `ui-action` to a registered `UiActionDispatcher` (defaulted to a no-op + warning so unsupported ops fail loudly).

**Capability flags** drive feature-detection in the chat shell — e.g. the tools sidebar hides when `clientTools=false`, and the widget rail hides when `generativeUi=false`.

---

## 6. MFE Integration Model (Native Federation + Module Federation)

**Topology:**

```
[ Host Shell ]   --MfeRegistryClient.discover()-->   [ MFE Registry: Spring Boot OR static JSON ]
       |
       +-- ToolRegistry, WidgetRegistry, CapabilityRegistry, BackendRegistry  (root injectables)
       +-- <maverick-chat-shell>            (talks to AgenticBackend)
       +-- <maverick-widget-container>      (renders by name from WidgetRegistry)
       |
       +--Native Federation OR Module Federation-->   [ Remote A: bookings ]
                                                      [ Remote B: loyalty  ]
```

**Capability handoff sequence:**
1. **Bootstrap.** Host calls `MfeRegistryClient.discover(env)` → receives `RemoteSpec[]` with `remoteEntry` and `capabilityManifestUrl`. Host calls federation init (`initFederation(remotes)` for Native Federation, or `init({remotes})` for `@module-federation/runtime`).
2. **Lazy load.** User navigates to a route owned by Remote A. Router calls the federation API: `loadRemoteModule({ remoteName: 'bookings', exposedModule: './Capability' })`.
3. **Register.** The remote's exposed entry is a `CapabilityModule` produced by `defineCapabilityModule({ tools, widgets, prompts })`. On import, a top-level statement calls `registerCapability(module, { source: 'remote:bookings' })`, pushing into ToolRegistry / WidgetRegistry / CapabilityRegistry. Because all three are root-scoped signals, the chat shell sees the new capabilities immediately — the next user turn includes them in the tool list sent to the agent.
4. **Routing tool calls back.** When the backend emits `tool-call-*`, `executeToolCall` looks up `ToolRegistry.get(name)`. The `source` field tells us which remote owns it; if the tool was registered with `executeIn: 'remote'`, execution dispatches into the remote's `EnvironmentInjector` (captured at registration time) so the handler can resolve services from the remote's own injector tree.
5. **Teardown.** On remote unload, disposers fire; registries drop `source === 'remote:<name>'` entries; signals notify subscribers; in-flight runs continue but the next turn's capability list excludes the removed tools.

**Capability manifest** (sibling to federation manifest, single source of truth used by both federation paths):

```json
{
  "remoteName": "bookings",
  "version": "1.4.2",
  "exposes": {
    "./Capability": "./src/capability.ts",
    "./Routes": "./src/routes.ts"
  },
  "agentic": {
    "manifest": "./capabilities.json"
  }
}
```

`capabilities.json` declares `{ tools: [{ name, description, schemaUrl }], widgets: [{ name, propsSchemaUrl }], prompts: [...] }`. The host can prefetch this *without loading the remote bundle* — used by the system-prompt builder so the agent knows about tools before the remote is hydrated.

**Native Federation vs Module Federation.**
- Native Federation (default): `@maverick/agentic-ui/mfe` exports `loadRemoteCapabilities()` backed by `@angular-architects/native-federation` runtime. Compatible with `@angular/build:application` (esbuild).
- Module Federation: `@maverick/agentic-ui/mfe-module-federation` exports `loadRemoteCapabilitiesMF()` backed by `@module-federation/runtime`. Same input/output shape; consumer picks the entry point matching their bundler. The CapabilityModule format and `capabilities.json` schema are identical across both — only the dynamic-import mechanism differs.

---

## 6.5 Observability (OpenTelemetry)

Agentic UI is the kind of system that needs distributed tracing — one user prompt fans out into LLM streaming, multiple tool calls (some routed into remote MFE injectors), widget renders, and persistence writes. Observability is treated as a baked-in seam from M1, not an M5 polish item.

### Two layers

1. **`AgenticTelemetrySink` interface** — protocol-agnostic emit points the library calls. Defaults to a no-op; the chat shell, registries, runUntilSettled loop, backend adapters, and federation loader all push events through this sink.
2. **`@maverick/agentic-ui/otel` secondary entry point** — ships an OpenTelemetry-backed sink plus auto-instrumentation. Adds `@opentelemetry/api` as a peer dep (small) and optional peers for SDK packages.

```ts
// /otel public API
export function provideAgenticTelemetry(cfg: {
  serviceName: string;
  exporter: 'otlp-http' | 'otlp-grpc' | 'console' | TelemetryExporter;
  endpoint?: string;                                  // OTLP collector
  headers?: Record<string, string>;
  resourceAttributes?: Record<string, string>;
  sampler?: 'always-on' | 'always-off' | 'parent-based' | { kind: 'ratio'; ratio: number };
  metrics?: { enabled: boolean; intervalMs?: number };
  logs?:    { enabled: boolean };
  instrumentations?: {
    registries?: boolean;       // span around register/lookup, count metrics       (default: true)
    runs?: boolean;             // root span per chat turn                          (default: true)
    toolCalls?: boolean;        // span per tool call                               (default: true)
    widgets?: boolean;          // span per widget render — high cardinality        (default: false)
    federation?: boolean;       // span around remote loads                          (default: true)
    fetch?: boolean;            // wrap window.fetch / HttpClient                    (default: false)
  };
  redaction?: { argsAllowList?: string[]; messageBodyCapture?: 'none' | 'hash' | 'full' };
}): EnvironmentProviders;
```

### Instrumented spans

| Span | Kind | Key attributes |
| ---- | ---- | -------------- |
| `agentic.run` | INTERNAL (root for a turn) | `agentic.thread_id`, `agentic.run_id`, `agentic.backend.id`, `agentic.tools.count`, `agentic.widgets.count`, `agentic.message.role`, `agentic.message.bytes` |
| `agentic.backend.stream` | CLIENT | `agentic.backend.id`, `http.url`, `http.method`, `http.status_code` (links to server span via `traceparent`) |
| `agentic.tool_call` | INTERNAL | `agentic.tool.name`, `agentic.tool.source` (`host`/`remote:bookings`), `agentic.tool.execute_in`, `agentic.tool.args.bytes`, `agentic.tool.success`, `error.type` |
| `agentic.widget_render` | INTERNAL (default off) | `agentic.widget.name`, `agentic.widget.source` |
| `agentic.federation.load` | INTERNAL | `mfe.remote_name`, `mfe.version`, `mfe.federation` (`native`/`module`), `mfe.capability_count`, `mfe.load_ms` |
| `agentic.registry.register` | INTERNAL | `registry.name` (`tool`/`component`/...), `registry.entry_count_after`, `registry.source` |
| `agentic.persistence.{read,write}` | INTERNAL | `persistence.adapter`, `persistence.key.hash`, `persistence.bytes` |

Server-side, `@maverick/agentic-ui-server` emits parallel spans for the AG-UI route and the Mastra agent run. The client adapter inserts W3C `traceparent` into AG-UI request headers; the server route extracts it and continues the trace, so a single trace covers `chat-shell → backend adapter → SSE route → Mastra agent → LLM call → tool execution`.

### Metrics

OTel Metrics counter / histogram instruments:

- `agentic.runs.total` (counter; tagged by `backend.id`, `outcome`)
- `agentic.run.duration_ms` (histogram)
- `agentic.tool_call.duration_ms` (histogram; tagged by `tool.name`, `tool.source`)
- `agentic.tool_call.errors.total` (counter; tagged by `tool.name`, `error.type`)
- `agentic.text.delta.bytes` (histogram; debug only, default off)
- `agentic.federation.load_ms` (histogram; tagged by `remote_name`, `federation`)
- `agentic.registry.size` (up-down counter, per registry)

### Logs

The library never `console.log`s. Internal logging routes through `inject(AgenticLogger)`, which is OTel-backed when telemetry is enabled (logs SDK with the same trace context) and falls back to console otherwise. Log lines carry the active `trace_id` / `span_id` so collectors can join logs to traces.

### Privacy / PII

Tool args and message content can carry PII. Defaults are conservative:

- Args / message bodies are **never** captured as span attributes; only their byte size and a stable hash.
- Opt-in `redaction.argsAllowList: ['flightId', ...]` lets specific safe fields through.
- Opt-in `redaction.messageBodyCapture: 'full'` for dev only.
- Error messages are captured but truncated to 512 chars.

### Wiring (consumer side)

```ts
provideAgenticUi({
  backend: provideAgUiBackend({ url: '/api/ag-ui' }),
  telemetry: provideAgenticTelemetry({
    serviceName: 'demo-shell',
    exporter: 'otlp-http',
    endpoint: 'https://otel-collector.local/v1/traces',
    sampler: { kind: 'ratio', ratio: 0.1 },             // 10% sampling in prod
    instrumentations: { runs: true, toolCalls: true, federation: true },
  }),
});
```

### Milestone placement

- **M1** — `AgenticTelemetrySink` interface + no-op default + `runs` and `tool_call` emit points. Cheap; bakes the seam in early.
- **M2** — Schematics `ng-add` accepts `--telemetry=otel\|none` and wires `provideAgenticTelemetry` + a sample collector config.
- **M3** — Federation spans + server-side route instrumentation; W3C traceparent propagation across the SSE boundary; demo with Tempo/Jaeger.
- **M4** — Metrics surface (`agentic.run.duration_ms`, etc.) and dashboards in `docs/cookbook/observability.md`.
- **M5** — Log pipeline integration; redaction toolkit; Datadog / Honeycomb adapter examples.

### Verification

The `/testing` entry ships an in-memory `AgenticTelemetrySink` plus a Vitest matcher (`expect(sink).toHaveSpan('agentic.tool_call', { 'agentic.tool.name': 'bookFlight' })`). The conformance suite in §9 asserts each backend adapter emits the canonical span/event shape; the e2e Playwright tests assert traces traverse the SSE boundary by querying a local OTel collector for a known `traceparent`.

---

## 7. Schematics Collection

Shipped as `@maverick/agentic-ui-schematics`. `ng add @maverick/agentic-ui` resolves to the schematics package's `ng-add`.

| Schematic | Options | Files written |
| --- | --- | --- |
| `ng-add` | `--backend=ag-ui\|hashbrown\|a2ui` (default `ag-ui`), `--mfe=none\|host\|remote`, `--federation=native\|module-federation` (default `native`), `--server=mastra\|none`, `--registry=spring-boot\|static-json\|none`, `--telemetry=otel\|console\|none` (default `none`) | Adds peer deps; patches `app.config.ts` with `provideAgenticUi(...)`; creates `src/app/agentic/` with seed `tools.ts` + `widgets.ts`; if MFE host, scaffolds `federation.config.{js,ts}` for the chosen federation path, plus a `bootstrap.ts` split. If `--telemetry=otel`, adds `provideAgenticTelemetry(...)` plus a sample `otel-collector.yaml`. |
| `chat-shell` | `--route=/chat`, `--style=panel\|page`, `--name=ChatShell` | Standalone component using `<maverick-chat-shell>`, route entry, optional dock layout. |
| `tool` | `--name`, `--executeIn=host\|remote`, `--schema=zod` | `*.tool.ts` with `agenticTool({...})` and Zod schema scaffold; auto-registers via the chosen entry config. |
| `widget` | `--name`, `--inputs=foo:string,bar:number` | Standalone component + `*.widget.ts` factory with Zod props schema; auto-registers. |
| `backend` | `--name=MyBackend`, `--protocol=custom\|ag-ui-extended\|hashbrown-extended\|a2ui-extended` | Adapter class implementing `AgenticBackend`, `provideMyBackend()` factory, and unit-test stub built on `FakeAgenticBackend`. |
| `mfe-capability` | `--remoteName`, `--exposeAs=./Capability`, `--federation=native\|module-federation` | `capability.ts` calling `defineCapabilityModule({...})`, `capabilities.json` manifest, federation `expose` entry update for the chosen path. |
| `agent-server` | `--framework=mastra`, `--route=/api/ag-ui` | Generates `projects/<name>-server/` with Mastra agent, AG-UI SSE route, memory store, sample tool. |

Sample invocations:

```bash
ng add @maverick/agentic-ui --backend=ag-ui --mfe=host --federation=native --registry=spring-boot --server=mastra
ng g @maverick/agentic-ui:chat-shell --route=/assistant
ng g @maverick/agentic-ui:tool --name=bookFlight --executeIn=remote
ng g @maverick/agentic-ui:widget --name=FlightCard --inputs=flightId:string,price:number
ng g @maverick/agentic-ui:mfe-capability --remoteName=bookings --federation=module-federation
ng g @maverick/agentic-ui:backend --name=AcmeBackend --protocol=custom
```

---

## 8. Phased Milestones

- **M1 — AG-UI single-app parity.** `@maverick/agentic-ui` core + `/ag-ui` adapter + `/testing`. Core registries: **ToolRegistry, ComponentRegistry, BackendRegistry** (3 of 13). `<maverick-chat-shell>` and `<maverick-widget-container>`. `projects/demo-monolith` reproduces flights42's behavior against `projects/demo-server`. Manual setup; no schematics yet.
- **M2 — Schematics package.** `@maverick/agentic-ui-schematics` published with `ng-add`, `chat-shell`, `tool`, `widget`, `backend`, `agent-server`. Snapshot tests for each. Documented cookbook entries.
- **M3 — Full MFE + A2UI + CapabilityRegistry + MfeRegistry.** Add `/mfe`, `/mfe-module-federation`, `/a2ui` entry points: `defineCapabilityModule`, `loadRemoteCapabilities` (native) and `loadRemoteCapabilitiesMF` (webpack), `MfeRegistryClient` with both `provideSpringBootMfeRegistry` and `provideStaticJsonMfeRegistry`, **CapabilityRegistry** (4th), **MfeRegistry** (5th — completes core five), `capabilities.json` schema, and the A2UI backend adapter with `ui-action` event support and a `UiActionDispatcher` integration point. `mfe-capability` schematic. Two host apps (`demo-shell`, `demo-shell-mf`) plus two remotes covering Native and webpack federation; Playwright e2e for the load-mid-chat scenario across both federations. A2UI conformance test in `/testing`.
- **M4 — Hashbrown adapter + Action/Intent/Form registries + Validation seam.** `/hashbrown` entry with OpenAI + Google server variants. Backend-switch UI in demos. Adds **ActionRegistry** (6th), **IntentRegistry** (7th), **FormRegistry** (8th), **ValidationRegistry** (10th — Zod default, Ajv adapter example). New schematics: `action`, `intent`, `form`. The A2UI adapter switches from a stub `UiActionDispatcher` to dispatching through ActionRegistry. Cross-backend conformance suite (AG-UI / Hashbrown / A2UI all run the same `/testing` harness with `actions`, `intents`, and `forms` test cases).
- **M5 — DataSource / Persistence / Layout / Schema Transformer + MCP + ecosystem hardening.** **DataSourceRegistry** (9th — REST/GraphQL/SSE adapters), **PersistenceRegistry** (11th — localStorage / sessionStorage / Dexie example), **LayoutRegistry** (12th — interface + CDK example), **SchemaTransformerRegistry** (13th — JSON Schema↔Zod, OpenAPI→Tool importer). MCP Apps integration as a tool source — an MCP server's tools become entries in ToolRegistry via `mcpToolBridge()`. Live MFE registry updates (`MfeRegistrySource.watch()`) wired into Spring Boot adapter via SSE. Telemetry hooks (`AgenticTelemetrySink`) for tool-call latency and run outcome. v1.0 release.

---

## 9. Verification

Each milestone has explicit, runnable checks:

- **Unit tests** (Vitest in libs, Jasmine/Karma if Angular CLI defaults retained for apps): every registry, the `runUntilSettled`-equivalent loop, every adapter's event mapping. Library-level coverage gate at 85%.
- **Conformance suite** (`projects/agentic-ui/testing/`): a single test file run against every backend adapter — exercises text streaming, a tool call with deferred result, a widget render, an abort mid-run, and (M3+) a `ui-action`. Each backend reports which capability flags it claims, and tests assert that each claimed flag actually works.
- **Schematic snapshot tests** (`@angular-devkit/schematics/testing`): for each schematic, run with representative options against an in-memory `Tree` and snapshot the resulting file set; smoke-build the resulting workspace in CI.
- **MFE end-to-end (Playwright)**: scripted scenarios across `demo-shell` (Native Federation) + `demo-shell-mf` (Module Federation) — load a remote mid-chat and assert the new tool appears in the next turn; unload and assert removal; tool-call dispatched into a remote resolves a service from the remote's injector.
- **Manual smoke**: `npm run start:demo-monolith` (M1), `ng add` into a fresh app and ask "Did I already book for Paris?" (parity with flights42's canonical demo); `npm run start:demo-shell` boots the MFE host with two remotes registered via `provideSpringBootMfeRegistry({url})` pointing at the user's `mfe-registry-platform`.
- **Type/lint**: strict TypeScript across all projects, `@angular-eslint`, and a Sheriff config (mirroring flights42) enforcing module boundaries — registries only mutated through their public APIs, adapters not importing each other.

---

## 10. Critical Files (to be created during implementation)

- [angular.json](angular.json) — workspace projects list
- [projects/agentic-ui/src/lib/agentic-backend.ts](projects/agentic-ui/src/lib/agentic-backend.ts) — `AgenticBackend` interface + `AgenticEvent` union
- [projects/agentic-ui/src/lib/registries/registry-base.ts](projects/agentic-ui/src/lib/registries/registry-base.ts) — uniform `Registry<TDef>` implementation reused by all 13
- Core (M1–M3): [tool-registry.ts](projects/agentic-ui/src/lib/registries/tool-registry.ts), [component-registry.ts](projects/agentic-ui/src/lib/registries/component-registry.ts), [capability-registry.ts](projects/agentic-ui/src/lib/registries/capability-registry.ts), [backend-registry.ts](projects/agentic-ui/src/lib/registries/backend-registry.ts), [mfe-registry-client.ts](projects/agentic-ui/mfe/src/mfe-registry-client.ts)
- Extended (M4): [action-registry.ts](projects/agentic-ui/src/lib/registries/action-registry.ts), [intent-registry.ts](projects/agentic-ui/src/lib/registries/intent-registry.ts), [form-registry.ts](projects/agentic-ui/src/lib/registries/form-registry.ts), [validation-registry.ts](projects/agentic-ui/src/lib/registries/validation-registry.ts)
- Extended (M5): [data-source-registry.ts](projects/agentic-ui/src/lib/registries/data-source-registry.ts), [persistence-registry.ts](projects/agentic-ui/src/lib/registries/persistence-registry.ts), [layout-registry.ts](projects/agentic-ui/src/lib/registries/layout-registry.ts), [schema-transformer-registry.ts](projects/agentic-ui/src/lib/registries/schema-transformer-registry.ts)
- [projects/agentic-ui/src/lib/chat-shell/chat-shell.component.ts](projects/agentic-ui/src/lib/chat-shell/chat-shell.component.ts) — built around an `injectAgenticChat()` similar to flights42's `agUiResource()`
- [projects/agentic-ui/src/lib/widget-container/widget-container.component.ts](projects/agentic-ui/src/lib/widget-container/widget-container.component.ts) — `*ngComponentOutlet` based, mirrors flights42's `widget-container.ts`
- [projects/agentic-ui/src/lib/form-renderer/form-renderer.component.ts](projects/agentic-ui/src/lib/form-renderer/form-renderer.component.ts) — schema-driven form renderer (M4)
- [projects/agentic-ui/src/lib/telemetry/telemetry-sink.ts](projects/agentic-ui/src/lib/telemetry/telemetry-sink.ts) — `AgenticTelemetrySink` interface, no-op default, `AgenticLogger` (M1)
- [projects/agentic-ui/otel/src/public-api.ts](projects/agentic-ui/otel/src/public-api.ts) + [otel/src/provide-agentic-telemetry.ts](projects/agentic-ui/otel/src/provide-agentic-telemetry.ts) — OpenTelemetry-backed sink, instrumentations, exporter wiring
- [projects/agentic-ui-server/src/otel-route-middleware.ts](projects/agentic-ui-server/src/otel-route-middleware.ts) — server-side traceparent extraction + AG-UI route span (M3)
- [projects/agentic-ui/ag-ui/src/public-api.ts](projects/agentic-ui/ag-ui/src/public-api.ts) + `ng-package.json`
- [projects/agentic-ui/hashbrown/src/public-api.ts](projects/agentic-ui/hashbrown/src/public-api.ts) + `ng-package.json`
- [projects/agentic-ui/a2ui/src/public-api.ts](projects/agentic-ui/a2ui/src/public-api.ts) + `ng-package.json`
- [projects/agentic-ui/mfe/src/public-api.ts](projects/agentic-ui/mfe/src/public-api.ts) — `defineCapabilityModule`, `loadRemoteCapabilities`, `MfeRegistryClient`, `provideSpringBootMfeRegistry`, `provideStaticJsonMfeRegistry`
- [projects/agentic-ui/mfe-module-federation/src/public-api.ts](projects/agentic-ui/mfe-module-federation/src/public-api.ts) — `loadRemoteCapabilitiesMF`
- [projects/agentic-ui/testing/src/public-api.ts](projects/agentic-ui/testing/src/public-api.ts) — `FakeAgenticBackend`, conformance suite
- [projects/agentic-ui-schematics/collection.json](projects/agentic-ui-schematics/collection.json) + per-schematic `schema.json` and `factory.ts`
- [projects/agentic-ui-server/src/ag-ui-route.ts](projects/agentic-ui-server/src/ag-ui-route.ts) — generic AG-UI SSE route factory
- [projects/agentic-ui-server/src/extended-mastra-agent.ts](projects/agentic-ui-server/src/extended-mastra-agent.ts) — Mastra → AG-UI events bridge

The flights42 references that should be reused (re-implemented but not from scratch — patterns transfer directly):
- `agUiResource()` factory pattern → `injectAgenticChat()` in [chat-shell.component.ts](projects/agentic-ui/src/lib/chat-shell/chat-shell.component.ts)
- `runUntilSettled()` orchestration loop → adapter-internal in `/ag-ui`'s backend implementation
- `show-component.tool.ts` Zod-discriminated-union approach → `agenticWidget()` factory
- `widget-container.ts` `*ngComponentOutlet` pattern → [widget-container.component.ts](projects/agentic-ui/src/lib/widget-container/widget-container.component.ts)
- `extended-mastra-agent.ts` → `projects/agentic-ui-server/src/extended-mastra-agent.ts`

---

## 11. Open Risks — Handling Plans

For each risk: **detection** (how do we know it's biting?), **mitigation** (what we ship up front to keep options open), **contingency** (plan B if it materializes), and **owner / revisit** (who decides, and when).

### R1 — A2UI spec churn
**Why it's risky.** A2UI is the least-settled protocol of the three; the spec may move before/at its v1.0.

| | |
|---|---|
| **Detection** | Watch the A2UI repo / spec channel; weekly delta digest. A `/testing` conformance suite fails when the adapter no longer matches the latest tagged spec. |
| **Mitigation** | Reserve `'ui-action'` in the `AgenticEvent` union from M1 (already done) so the chat shell never breaks. Track spec version in the adapter: `provideA2uiBackend({ specVersion: '0.x' })`; mismatch with server announcement warns loudly. Pin spec version in the lockfile. |
| **Contingency** | On a breaking spec change, ship a parallel `provideA2uiBackend2(...)`; deprecate the old one with a 6-month removal window. If A2UI dies, demote the adapter to a community-maintained side package — the abstraction is uniform so nothing else changes. |
| **Owner / revisit** | Re-evaluate every M5 minor release. |

### R2 — Spring Boot registry contract
**Why it's risky.** The plan assumes `mfe-registry-platform` exposes (or can expose) a `capabilityManifestUrl` field on each MFE record. If not, M3 stalls.

| | |
|---|---|
| **Detection** | M3 kickoff one-day spike: read the live `mfe-registry-platform` REST schema; confirm fields. |
| **Mitigation** | The pluggable `MfeRegistrySource` interface means M3 is unblocked by the static-JSON adapter regardless. `provideSpringBootMfeRegistry(...)` accepts `capabilityManifestResolver: (mfeRecord) => string` so consumers can derive the URL by convention (e.g., `${deploymentUrl}/capabilities.json`) without a server change. |
| **Contingency** | Ship a thin sidecar (`agentic-capability-resolver`) that joins MFE records to capability manifests, documented as the "registry shim." If owners agree, a small PR adds the column + endpoint to `mfe-registry-platform` (1 column, 1 endpoint update). |
| **Owner / revisit** | Decision required at start of M3. |

### R3 — Two-federation maintenance burden
**Why it's risky.** Native + Module Federation parity doubles federation-config code in schematics and the e2e matrix; drift is easy to introduce.

| | |
|---|---|
| **Detection** | Conformance tests run with `runWith(['native', 'module'])` parameterization — divergence fails CI. Monthly parity check loads both `demo-shell` and `demo-shell-mf` and asserts identical `CapabilityRegistry` contents. |
| **Mitigation** | Library surface stays tiny: `loadRemoteCapabilities()` (Native) and `loadRemoteCapabilitiesMF()` (webpack) share an identical signature, return type, and `CapabilityModule` format. All per-bundler boilerplate lives in **schematics templates**, not runtime. Single shared `capabilities.json` Zod schema. |
| **Contingency** | If maintenance cost spikes after M3, label MF "experimental" in v1.x and remove in v2.0 with a 12-month deprecation. Or split MF into a separate package (`@maverick/agentic-ui-mfe-module-federation`) so it can move at its own cadence. |
| **Owner / revisit** | End-of-M3 retro. |

### R4 — Remote-tool execution boundary
**Why it's risky.** Capturing a remote's `EnvironmentInjector` couples host and remote lifetimes; a remote unloaded mid-tool-call must abort cleanly.

| | |
|---|---|
| **Detection** | Playwright test: open chat → invoke remote tool → unload remote mid-execution → assert graceful error + next turn works. Soak test: 50 load/unload cycles during an active chat; assert no leaked subscriptions via `__ngDevMode` counters. |
| **Mitigation** | Each remote registers tools with a `disposalSignal: AbortSignal` that fires on unload; handlers must `signal.throwIfAborted()` at await boundaries (built into the `tool` schematic template). Host wraps invocation in `try/catch`; on dead injector, emits synthetic `tool-call-result` with `{ error: 'remote_unavailable' }` and a recovery hint in the system prompt. |
| **Contingency** | Add an opt-in **retry-with-fresh-remote** policy: on `remote_unavailable`, re-load the remote (if MfeRegistry says it still exists) and re-invoke. If injector capture proves fundamentally unstable, fall back to per-remote `Worker` + `postMessage` (v2.0 refactor). |
| **Owner / revisit** | M3 e2e suite. |

### R5 — OTel bundle impact
**Why it's risky.** OpenTelemetry browser SDKs add 30–80 KB gzipped.

| | |
|---|---|
| **Detection** | Bundle-size budgets in `angular.json` per-app. `size-limit` CI check fails on >5% growth from baseline. CHANGELOG line per release reporting bundle delta. |
| **Mitigation** | OTel ships **only** via the optional `/otel` secondary entry — apps that don't import it pay zero bytes. Core `AgenticTelemetrySink` is a 1-method interface; no-op default is ~10 LOC. Emit sites guard with `if (telemetry !== NoopSink)` so event objects aren't even constructed when off. Tiny `provideAgenticTelemetryConsole()` (~2 KB) covers dev-only use. |
| **Contingency** | Add `/observability/manual` exporter that emits W3C-trace-context-tagged events to `console.table` or a custom HTTP endpoint — same sink interface, much smaller. Add a buildtime transform that strips `inject(AgenticTelemetrySink).emit(...)` calls when a `--telemetry=off` flag is set (M4 opt-in). |
| **Owner / revisit** | M4 bundle audit. |

### R6 — Registry sprawl (13 registries)
**Why it's risky.** Surface area is large enough that newcomer DX could suffer; we might ship registries no one uses.

| | |
|---|---|
| **Detection** | `agentic.registry.size` metric per registry across the demos. Anything that stays at 0 across all demos is a removal candidate. Adoption survey at GA: which registries do users populate? |
| **Mitigation** | Only the **five core** registries are required; the other eight are opt-in via providers — apps that don't need them never instantiate them. One shared `Registry<TDef>` base means each registry costs ~30 LOC; maintenance is sublinear in count. Cookbook split: "Minimal app (5)" vs "Full app (13)". ESLint/Sheriff rules forbid direct registry mutation outside `provideAgenticUi` or `defineCapabilityModule` so the public surface stays bounded. |
| **Contingency** | At M4 retro, any extended registry with zero adoption + zero feature requests → demote to an extension seam (interface only, no shipped default). Overlapping registries (e.g., Action + Intent) merge in v2.0 with a deprecation shim. Any registry can be extracted into its own secondary entry point so non-users pay zero bytes. |
| **Owner / revisit** | M4 retro; pre-1.0 RC review. |

### Risk-handling summary

The pattern across all six risks:
1. **Build the abstraction seam first** — `AgenticBackend`, `MfeRegistrySource`, `Registry<TDef>`, `AgenticTelemetrySink`. Almost every contingency above leans on the seam already existing.
2. **Default to off / opt-in** — extended registries, OTel, MF, A2UI all default off. Risk is bounded by what the average app actually pulls in.
3. **Always have a measurable trigger** — every risk has a concrete detection signal in CI or telemetry, not "we'll keep an eye on it."
4. **Reserve a v2.0 path** — for the structural risks (R3, R4, R6) we explicitly note the v2.0 contingency so we never have to ship a breaking change inside v1.x.
