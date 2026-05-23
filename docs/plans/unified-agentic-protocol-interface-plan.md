# Unified Agentic Protocol Interface

## Context

The maintainer wants **one unified interface** through which all of the project's
agent protocols/specs can be used together rather than separately: AG-UI,
Hashbrown, A2UI (chat transports), plus MCP server (outbound tool exposure),
MCP-UI (inbound UI rendering), and WebMCP (in-browser tool exposure).

**Key finding from exploration:** the unification *spine already exists* — the
canonical `AgenticEvent` union + `ToolDef`/render-hint contract that every
protocol normalizes to (ADR-048 parity contract, enforced by `runConformance`).
What is missing is (1) a single facade that wires every surface from one config,
and (2) a single tool definition shared across the Angular app **and** the Node
MCP server (today they hand-duplicate the same tools, which will drift).

This plan delivers the unified interface as a thin **composition facade** over
the existing providers, plus a shared tool source, and recommends extracting the
portable contract into `agentic-core` so the unification holds across the
Angular/Node process boundary.

## The decisive insight: two axes, not one super-type

A unified interface must NOT merge these into one type:

- **Axis 1 — Chat transport (mutually exclusive).** AG-UI / Hashbrown / A2UI each
  implement `AgenticBackend.run(): AsyncIterable<AgenticEvent>`. Exactly one is
  active per session via `BackendRegistry.setActive()`. This is correct; leave it.
- **Axis 2 — Tool exposure + UI rendering (orthogonal, composable).** MCP server,
  WebMCP, MCP-UI are NOT conversation transports — they have no `run()` loop. They
  revolve around `ToolDef` + `ToolResultRenderHints`. Any number can be active at once.

Forcing MCP/WebMCP into `AgenticBackend` would be wrong. The shared abstraction is
the **data contract** (`AgenticEvent`, `ToolDef`, render-hints), and the unified
"interface" is a **composition facade**, not a new merged interface.

## Target state architecture

```
                          ┌──────────────────────────────────────────┐
   APP CONFIG             │      provideAgenticUiPlatform({...})       │  ← single unified entry point
   (one call)             │  tools · widgets · transport · mcpUi · webMcp
                          └───────────────────┬────────────────────────┘
                                              │ delegates verbatim (no reimpl)
            ┌──────────────────┬──────────────┼───────────────────┬───────────────────┐
            ▼                  ▼              ▼                   ▼                   ▼
     provideAgenticUi   transport provider  provideMcpUi      provideWebMcp     createMcpServer
     (tools+widgets)    (pick ONE)          (inbound UI)      (browser tools)   (Node, separate proc)
            │                  │              │                   │                   │
   ┌────────┴────────┐  ┌──────┴───────┐      │                   │                   │
   ▼                 ▼  ▼              ▼       ▼                   ▼                   ▼
 ToolRegistry  ComponentRegistry  BackendRegistry          navigator.modelContext   MCP stdio/http
 (DI, live)    (DI, live)         (DI, ONE active)         (mirrors ToolRegistry)
   │                 │                  │
   └─── AXIS 2 (composable) ──┘   AXIS 1 (mutually exclusive: AG-UI | Hashbrown | A2UI)

  ═══════════════════════════════════════════════════════════════════════════════════════
   SHARED CONTRACT  ──  @infra-tools/agentic-core  (framework-agnostic, no DOM/CDK)
   AgenticEvent · agenticEventSchema · AgenticBackend · ToolDef/ComponentDef ·
   ToolResultRenderHints · agenticTool() · result-formatter logic · runConformance
  ═══════════════════════════════════════════════════════════════════════════════════════
            ▲                              ▲                              ▲
   imported by Angular lib        imported by Node MCP server     imported by demo-shared-tools
   (agentic-ui)                   (agentic-ui-mcp)                (the ONE tool source both use)
```

**How to read it.** One `provideAgenticUiPlatform(...)` call is the unified
interface. It fans out to the existing providers — never reimplementing them.
Below the providers sit the live Angular DI registries (Axis 2 composable tool/UI
surfaces; Axis 1 the single active chat transport). Underneath everything is
`agentic-core`: the one contract that the Angular library, the Node MCP server,
and the shared tool source all import — which is *why* the same `ToolDef` can drive
browser chat, the MCP server process, and WebMCP without duplication.

**Package boundaries (target):**

| Package | Kind | Holds |
|---|---|---|
| `@infra-tools/agentic-core` | TS-only (no DOM) | contract: events, schemas, `ToolDef`, `agenticTool`, formatter, conformance |
| `@infra-tools/agentic-ui` | Angular | registries, components, `provide*` incl. `provideAgenticUiPlatform`; re-exports core |
| `@infra-tools/agentic-ui-mcp` | Node | `createMcpServer`; imports core |
| `@infra-tools/agentic-ui-webmcp` | Angular/browser | `provideWebMcp`; mirrors `ToolRegistry` |
| `examples/demo-shared-tools` | TS-only (new) | the single `ToolDef[]` both demo app + MCP server import |

## Architecture assessment (industry-grade?)

- **Patterns:** canonical event + per-protocol adapters = **ports-and-adapters /
  anti-corruption layer** (as in Vercel AI SDK / AG-UI spec); the facade =
  **Facade over DI composition** (idiomatic Angular `provideX`). Sound.
- **Interop:** **hub-and-spoke via a canonical model** — protocols talk to core, not
  each other, so it's **N adapters, not N²**, and ADR-048 `runConformance` *enforces*
  parity. Real interop at the consumption layer today; full cross-protocol interactive
  interop is delivered by Phase 4 ("Half B").
- **Scalability:** adding protocols scales linearly; the MCP server scales as its own
  process. Watch-items, addressed above: static tool arrays → `ToolSource` provider;
  one-active `BackendRegistry` is fine for one UI but is a *selector, not a router*
  (multi-agent multiplexing would need a router).
- **Net:** the foundation is industry-grade; the schema-first `ToolSource` (§2) and the
  shared invocation core (Phase 3) are what make the interop/scalability claims literally true.

## Recommended approach

### 1. New facade: `provideAgenticUiPlatform` (thin aggregator)

Create `projects/agentic-ui/src/lib/providers/provide-agentic-ui-platform.ts`.
(Name note: `provideAgenticPlatform` already exists in `lib/platform/` for
catalog/IAM/MFE concerns — do NOT reuse it.) The facade collects
`EnvironmentProviders` and delegates verbatim to existing providers:

```ts
provideAgenticUiPlatform({
  tools,                              // shared ToolDef[] — see §2
  widgets,                           // ComponentDef[]
  transport: provideAgUiBackend({url}) | provideHashbrownBackend(...) | provideA2uiBackend(...),
  mcpUi?: ProvideMcpUiOptions | false,   // default false → provideMcpUi(...)
  webMcp?: WebMcpOptions | false,        // default false → provideWebMcp(...)
})
```

- `tools/widgets` → `provideAgenticUi({tools, widgets})` (registers `ToolRegistry`/`ComponentRegistry`)
- `transport` → passed through (returns providers registering a `BackendDef`)
- `mcpUi` → `provideMcpUi(...)`; `webMcp` → `provideWebMcp(...)`

Constraint: keep it a thin aggregator. Every sub-provider must remain independently
callable so existing `demo-monolith` configs keep working. The Node `createMcpServer`
is intentionally **out** of the Angular facade (separate process); it consumes the
same shared tool source (§2).

### 2. Shared tool source (closes the real gap)

Today `examples/demo-mcp-server/src/index.ts:48-77` re-declares `bookFlightTool`
by hand because importing the `@infra-tools/agentic-ui` barrel drags Angular's
compiler into Node; `demo-monolith` defines the same tool in
`examples/demo-monolith/src/app/agentic/agentic.ts`. Two definitions, guaranteed drift.

Fix: define a `ToolSource` (a plain `readonly ToolDef[]`, or a `() => readonly
ToolDef[]` provider so it can grow to dynamic/per-tenant sets) in a
**zero-Angular-import** module — `examples/demo-shared-tools/src/tools.ts`. Both
`demo-monolith` and `demo-mcp-server` import it; delete the duplicated literals.
WebMCP inherits the set for free (it mirrors the live `ToolRegistry`).

**Design principle — schema-first:** the tool *contract* (name + Zod/JSON schema)
must be serializable and Angular-free; the *handler* is pluggable per runtime. This
is what makes the contract portable across processes (and later languages), and is
the industry-standard interop posture (MCP is schema-first). Keep schema and handler
separable in `ToolDef` so the schema can travel where the handler cannot.

### 3. Placement: extract `agentic-core` (split-plan Boundary B)

Per `docs/plans/agentic-core-split-plan.md`, adopt **Boundary B**: move the portable
surface — `agentic-event.ts`, `agentic-event-schema.ts`, `agentic-backend.ts`,
`registry-defs.ts` (`ToolDef`/`ComponentDef`), `tool-result.ts`, `agenticTool()`,
and the pure result-formatter + conformance logic — into `@infra-tools/agentic-core`.
`agentic-ui` and `agentic-ui-mcp` re-export from it.

- **Stays Angular-specific:** DI registries (`ToolRegistry`, `ComponentRegistry`,
  `BackendRegistry`), components (`<mvk-chat-shell>`, `<mvk-widget-container>`), all
  `provide*` functions incl. the new facade.
- **Why it serves the goal:** once `agenticTool`/`ToolDef` live in core, the Node MCP
  server imports the *same* contract without the Angular-barrel problem — eliminating
  the §2 duplication structurally instead of by convention.

## Phasing (no big-bang)

- **Phase 0 — facade + shared demo tools. Low risk.** Add
  `provide-agentic-ui-platform.ts`; create `examples/demo-shared-tools`; point both
  `demo-monolith` and `demo-mcp-server` at it. Delivers the unified config and kills
  tool drift now. ~1 file + 1 tiny package; reuses everything.
- **Phase 1 — extract `agentic-core` (slices C1+C3). Low/med risk.** Move pure
  types/schemas/`agenticTool`/formatter logic; re-export from `agentic-ui` +
  `agentic-ui-mcp`. `demo-shared-tools` then imports `agenticTool` from core. Risk:
  federation singleton config + barrel re-export correctness.
- **Phase 2 — move adapters (slice C2). Med risk.** Relocate AG-UI/Hashbrown/A2UI
  adapters + orchestrator pure logic to core; re-verify ADR-048 parity.
- **Phase 3 — shared invocation/result core ("Half A"). Low risk, do regardless.**
  Extract a transport-neutral `invokeTool(name, args, ctx) → { result, renderHints }`
  into `agentic-core`, called by *both* the in-app orchestrator and the Node MCP
  server (`createMcpServer` + `result-formatter.ts`). Deletes duplicate result
  formatting and guarantees a tool renders identically in-app and via MCP. This is the
  natural completion of the core extraction and removes a second drift bug (results,
  the way Phase 0–1 removed it for tool definitions).

- **Phase 4 — cross-team interactive interop ("Half B"). High risk, committed.**
  Lets a tool/widget owned by Team A run *interactively* — multi-turn loop + action
  round-trip — inside another team's independently-deployed host over MCP/A2A
  (Flavor 2 topology). Builds directly on the Phase 3 invocation core. Concrete work:

  1. **Transport-neutral loop driver** — extract the agent loop (today living in the
     browser orchestrator) into `agentic-core` as a headless driver that consumes a
     transport port and emits `AgenticEvent`s. The browser orchestrator and the Node
     service both become thin transport bindings over this one driver.
     New: `projects/agentic-core/src/loop/agent-loop.ts`.
  2. **Stateful MCP/A2A session server** — extend `agentic-ui-mcp` `createMcpServer`
     from stateless `tools/call` into a session-bearing server: a session store keyed
     by `threadId` holding conversation + widget state across calls.
     Files: `projects/agentic-ui-mcp/src/{server.ts,session-store.ts}`.
  3. **MCP-UI action round-trip** — accept the MCP-UI action message (`intent`/`tool`/
     `prompt`/`link`/`notify`) `postMessage`d by the widget in the foreign host, map it
     to a `ui-action` `AgenticEvent`, and feed it back into the loop driver as the next
     turn. New: `projects/agentic-core/src/loop/ui-action-router.ts`.
  4. **Streaming over the external transport** — emit the `AgenticEvent` stream as MCP
     notifications / SSE (and A2A streaming if A2A is an outbound target), not a single
     return value.
  5. **Capability negotiation** — at MCP `initialize`, advertise/inspect host UI
     support (`ui://` mime, remote-dom) and pick render mode, else fall back to markdown.
  6. **New ADR** documenting the cross-process interactive loop + parity expectations
     (extends ADR-048/049); add conformance cases for the round-trip.

  Note: Phases 0–3 are the prerequisites and are independently valuable, so Phase 4 can
  start once the shared invocation core (Phase 3) lands; it does not need to wait for
  Flavor 2 to be in production.

## Critical files

- `projects/agentic-ui/src/lib/providers/provide-agentic-ui.ts` (compose, don't reimplement)
- `projects/agentic-ui/src/lib/providers/provide-agentic-ui-platform.ts` (new facade)
- `projects/agentic-ui/src/lib/mcp-ui/provide-mcp-ui.ts`, `projects/agentic-ui-webmcp/src/provide-web-mcp.ts` (composed)
- `examples/demo-shared-tools/src/tools.ts` (new shared tool source)
- `examples/demo-mcp-server/src/index.ts` (consume shared tools; delete hand-declared literals)
- `examples/demo-monolith/src/app/agentic/agentic.ts` + `app.config.ts` (consume shared tools; rewire to facade)
- `projects/agentic-ui/src/lib/types/{registry-defs.ts,tool-result.ts,agentic-event.ts,agentic-event-schema.ts}` (move to core in Phase 1)
- `projects/agentic-core/src/loop/{agent-loop.ts,ui-action-router.ts}` (new, Phase 4 — headless loop + action round-trip)
- `projects/agentic-ui-mcp/src/{server.ts,session-store.ts}` (Phase 4 — stateful session server + streaming)
- `docs/plans/agentic-core-split-plan.md` (placement reference)

## Verification

- **End-to-end testbed:** rewire `examples/demo-monolith` `app.config.ts` to
  `provideAgenticUiPlatform` with opt-in `webMcp`; confirm the protocol switcher
  (`BackendRegistry.setActive`), MCP-UI showcase, and WebMCP exposure all run off the
  one shared tool set.
- **Cross-process proof:** build `demo-mcp-server` (Node) and `demo-monolith` (Angular)
  from the same `demo-shared-tools`; assert MCP `tools/list` output matches
  `ToolRegistry.list()`. A Node build failing on an Angular import is the regression
  signal for the boundary.
- **Contract:** run `runConformance` (`conformance-suite.ts`) against each backend after any core move.
- **Half B round-trip (Phase 4):** drive the `bookFlight` tool from an external MCP
  client against the stateful server; render its `ui://` seat-map in a host iframe,
  click a seat, and assert the action `postMessage` routes back through
  `ui-action-router` → loop driver → next tool call, with session state preserved
  across calls. Add these as conformance cases.
- **Builds:** `ng build agentic-ui`, `ng build demo-monolith`, and a Node `tsc`/bundle of
  `demo-mcp-server` must all pass.
