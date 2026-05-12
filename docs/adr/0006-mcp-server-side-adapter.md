# ADR-006: MCP server-side adapter — `@infra-tools/agentic-ui-mcp`

**Status**: Accepted (implementing).

**Drives**: Roadmap Tier 1.1 ([`ROADMAP.md`](../../ROADMAP.md#11--mcp-server-side-adapter)).

**Companion docs (when implemented)**: cookbook entry, sample app under `examples/demo-mcp-server/`, CHANGELOG entries on both libraries.

## Context

The Model Context Protocol (MCP) is the de-facto interop layer for
agentic tools in early 2026. Hosts that consume MCP servers today:
Claude Desktop, Cursor, Continue, Zed, Windsurf, the upcoming Copilot
MCP support. Tools registered with our `ToolRegistry` are currently
invokable only through our own `<mvk-chat-shell>`; users who already
live in one of those host environments can't reach them without us
rewriting their experience.

We already implement the *consumer* half of MCP via
[`mcpToolBridge`](../../projects/agentic-ui/src/lib/mcp/) — pulling
tools FROM an external MCP server INTO our `ToolRegistry`. The
**server** half — exposing OUR tools AS an MCP server — is missing.

The seam is already in place. Every `ToolDef` already has the four
fields MCP wants:

| `ToolDef` field | MCP `Tool` field |
|---|---|
| `name` | `name` |
| `description` | `description` |
| `schema` (Zod) | `inputSchema` (JSON Schema — `zodToJsonSchema` already shipped) |
| `handler(args, ctx)` | `tools/call` request handler |

## Decision

Ship **one new optional npm package**: `@infra-tools/agentic-ui-mcp`.

- Wraps `@modelcontextprotocol/sdk` for the wire-format implementation.
- Single primary export: `createMcpServer({ name, version, tools, ... })` — takes a `ToolDef[]` and returns a configured server with stdio + HTTP/SSE transports.
- Lives in its own package (not bundled into `@infra-tools/agentic-ui`) so consumers building only an Angular host pay zero bytes for MCP code.
- No new core-library changes required; the package consumes the existing public types.

Supplementary, on the **core** library (`@infra-tools/agentic-ui`):
- Document a non-breaking convention on `ToolDef` return values:
  - existing `components: [{name, props}]` continues to render through `<mvk-widget-container>`,
  - **new optional** `markdown: string` for hosts that render only markdown,
  - **new optional** `image_url: string` for hosts that render images by URL.
- Adds zero TypeScript surface beyond a one-line interface extension on the existing tool-result type.

### Public API surface

```ts
// @infra-tools/agentic-ui-mcp — single package entry

export interface CreateMcpServerOptions {
  /** Server name advertised to MCP hosts (claude_desktop_config.json mountpoint). */
  readonly name: string;
  /** Semver. Surfaced in MCP `initialize` responses. */
  readonly version: string;
  /** The tools to expose. Reuses ToolDef from @infra-tools/agentic-ui. */
  readonly tools: readonly ToolDef[];
  /** Optional pre-call hook — auth, audit, rate-limit, etc. */
  readonly beforeCall?: (params: { name: string; args: unknown; callId: string }) => void | Promise<void>;
  /** Optional post-call hook — telemetry, redaction, response shaping. */
  readonly afterCall?: (params: { name: string; result: unknown; callId: string; durationMs: number }) => void | Promise<void>;
}

export interface McpServerHandle {
  /** Start with the stdio transport — Claude Desktop's default. */
  startStdio(): Promise<void>;
  /** Start with HTTP/SSE — for remote MCP hosts (Cursor remote, custom). */
  startHttp(opts: { port: number }): Promise<void>;
  /** Lower-level: handle a single MCP request. For embedding in another HTTP server. */
  handleRequest(request: McpRequest): Promise<McpResponse>;
  /** Close transports and run any registered cleanup. */
  close(): Promise<void>;
}

export function createMcpServer(opts: CreateMcpServerOptions): McpServerHandle;
```

### Tool-result rendering convention

Documented on `ToolDef` (one line of new TypeScript optionality, no breakage):

```ts
// Standardised on @infra-tools/agentic-ui as `ToolResultRenderHints` —
// purely additive, every field optional, consumers ignore unrecognised fields.

interface ToolResultRenderHints {
  /** Generative-UI hint for `<mvk-widget-container>`. Existing. */
  readonly components?: ReadonlyArray<{ readonly name: string; readonly props: unknown }>;

  /** NEW: markdown rendering for hosts that don't render Angular widgets. */
  readonly markdown?: string;

  /** NEW: image URL inline-renderable in markdown chats. */
  readonly image_url?: string;

  /** RESERVED for ADR-007 (MCP UI): pre-rendered static HTML. Not yet activated. */
  readonly html?: string;

  /** RESERVED for ADR-007 (MCP UI): sandboxed live-widget URL. Not yet activated. */
  readonly iframe_url?: string;
}
```

Same handler, multiple output shapes — host picks what it can render. The
chat shell ignores `markdown` (renders the typed widget); Claude Desktop
shows the markdown table; an image-rendering host gets the image. The
`html` / `iframe_url` fields are reserved so consumers writing
forward-compatible tools today aren't blocked when ADR-007 lands.

## Production-grade scope

This ADR ships a **library-grade** package — the API is stable,
tested, and works against today's MCP hosts. It does **not** ship
multi-tenant operational infrastructure, which is consumer-side and
matches how the rest of v1 of `@infra-tools/agentic-ui` is positioned.

| Aspect | What ADR-006 ships | What's consumer's responsibility |
|---|---|---|
| Public API | Stable, JSDoc'd, semver-bound | — |
| Schema conversion (Zod → MCP) | Round-trip tested | — |
| Stdio transport | Single-call wiring; works in Claude Desktop / Cursor / Zed | — |
| HTTP/SSE transport | Single-call wiring; CORS allowlist; bearer token gate as sample code | TLS termination, real auth provider integration |
| Error mapping | Full MCP error code coverage | — |
| Result formatter | Markdown/image/json precedence | — |
| `beforeCall` / `afterCall` hooks | The seam; documented patterns | Telemetry sink wiring, OAuth flow, JWT validation, token-bucket rate limiting |
| Multi-tenant (one server, N users) | Out of scope | Consumer wraps with auth + per-user MCP server instances OR uses the embeddable `handleRequest()` path |
| MCP spec version | Pinned `@modelcontextprotocol/sdk@^1`, supported version documented in cookbook | Spec-version negotiation if/when MCP 2.0 lands |
| Observability per call | Hook seam; reference Langfuse/OTel snippets in cookbook | Production trace/metric pipeline |

These boundaries are written into the cookbook entry up-front so
adopters know exactly what they own. Same maturity tier as
`<mvk-chat-shell>` is today: ship-able, used in real contexts,
operational layer is opt-in / consumer-side.

## Implementation plan

### Phase 0 — scaffold (½ day)

- [ ] Create `projects/agentic-ui-mcp/` (lib package, mirror `projects/agentic-ui-server/` structure: `package.json`, `tsconfig.json`, `src/index.ts`, `CHANGELOG.md`).
- [ ] Add to workspace `tsconfig.json` references; add `npm test` workflow path.
- [ ] Declare runtime deps: `@modelcontextprotocol/sdk@^1.x` (pin), `zod@^3` (peer to match core lib).
- [ ] Declare *peer* dep on `@infra-tools/agentic-ui` (consumer brings their own version).

### Phase 1 — core adapter (1 day)

- [ ] `src/types.ts` — `CreateMcpServerOptions`, `McpServerHandle`.
- [ ] `src/zod-to-mcp-schema.ts` — re-uses `zodToJsonSchema` from the core lib (already shipped) and post-processes the output for MCP's specific JSON Schema dialect (handles `additionalProperties: false`, removes `$schema` annotations MCP rejects, etc.).
- [ ] `src/synthetic-tool-context.ts` — builds a `ToolContext` for handlers that need one. The MCP server doesn't have a real `runId` / `threadId`; mint synthetic stable ones tied to the MCP `callId` so handler telemetry stays usable.
- [ ] `src/create-mcp-server.ts` — the main factory.
  - `tools/list` handler: maps each `ToolDef` → MCP `Tool` shape, calling the schema converter.
  - `tools/call` handler: looks up by `name`, runs `beforeCall`, validates `args` against the Zod schema, invokes `handler(args, ctx)`, runs `afterCall`, formats the result via the resolution convention below.
  - Errors: schema-validation failures → MCP `InvalidParams`; handler throws → MCP `InternalError` with the message; unknown tool → MCP `MethodNotFound`.
- [ ] `src/result-formatter.ts` — implements the multi-shape return convention. Order of preference for the MCP `content` array:
  1. If result has `markdown`: emit a single `text/markdown` content block.
  2. Else if result has `image_url`: emit an `image` content block.
  3. Else: emit `text/json` with the full typed result.
  Always prepend a hidden structured-data block (per MCP spec) so hosts capable of reading raw fields can still bind them.

### Phase 2 — transports (½ day)

- [ ] `src/transports/stdio.ts` — wires `StdioServerTransport` from the SDK. The Claude Desktop default; reads `stdin`, writes `stdout`.
- [ ] `src/transports/http.ts` — wires `SSEServerTransport`; bind to port from options. Adds `cors` allow-list, `Authorization` bearer-token gate (reuses the demo-server's `bearerAuth` pattern as a reference).
- [ ] `src/transports/embeddable.ts` — exports the lower-level `handleRequest()` method for consumers embedding MCP in their existing HTTP server (Hono / Express / Fastify).

### Phase 3 — sample app (½ day)

- [ ] `examples/demo-mcp-server/` (new) — a Node project mirroring `demo-server`'s shape. Imports the demo's tools (`bookFlight`, `cancelFlight`, `checkPoints`, `redeemPoints`, `openTicket`, `checkTicket`) and exposes them as one MCP server. Runs in stdio mode by default.
- [ ] Add to `angular.json`-equivalent (it's a Node project, no Angular config; just a `package.json` script).
- [ ] CI workflow step: `cd examples/demo-mcp-server && npm ci && npm run build` to guard against schema-conversion regressions.

### Phase 4 — tests (½ day)

- [ ] `src/zod-to-mcp-schema.spec.ts` — round-trip a representative Zod schema (object with strings, enums, optionals, nested) and assert MCP-compatible JSON Schema.
- [ ] `src/create-mcp-server.spec.ts` — using a fake transport, exercise:
  - `tools/list` returns every registered tool's shape.
  - `tools/call` happy path invokes the handler, returns the typed result.
  - Schema-validation failure surfaces as `InvalidParams` with the Zod issue message.
  - Handler-throw surfaces as `InternalError`.
  - `beforeCall`/`afterCall` hooks fire in order and can short-circuit (throwing in `beforeCall` rejects the call).
  - Result-formatter: precedence of `markdown` > `image_url` > `text/json`.
- [ ] At least 8 tests; target same per-file conventions as the core lib's spec files.

### Phase 5 — docs (½ day)

- [ ] **Cookbook entry** `docs/cookbook/mcp-server.md`:
  - "Why expose your tools as MCP" framing
  - 60-second walkthrough mounting `examples/demo-mcp-server` in Claude Desktop
  - Mermaid sequence diagram (the same one in the prior chat exchange — Claude Desktop ↔ MCP server ↔ ToolRegistry ↔ handler)
  - Tool-result multi-shape convention (markdown / image / text/json)
  - HTTP/SSE deployment example (`Hono` snippet)
  - Auth, rate-limit, and audit examples via `beforeCall`
  - Limitations section (no generative UI in markdown hosts; document the escape hatches)
- [ ] **CHANGELOG** entries on both:
  - `@infra-tools/agentic-ui` `[Unreleased]` — note the optional `markdown` / `image_url` fields on `ToolDef` return values (additive, non-breaking).
  - `@infra-tools/agentic-ui-mcp` `[0.1.0]` — first release, full feature list.
- [ ] **README documentation table** — link the new cookbook entry.
- [ ] **Compodoc summary** — include the new cookbook page so the generated site picks it up.

### Phase 6 — wire-up & verification (½ day)

- [ ] Run all 8 demo apps; confirm no regressions in the existing chat-shell render path (the `markdown` / `image_url` fields shouldn't change anything for `<mvk-chat-shell>`).
- [ ] Manual smoke: install `examples/demo-mcp-server` in Claude Desktop's `claude_desktop_config.json`, run a tool call, capture the result.
- [ ] Bundle-size guard: confirm `@infra-tools/agentic-ui` core hasn't grown — the MCP code lives in its own package.

**Total**: ≈ 3–4 days end-to-end.

## Acceptance criteria

A change request implementing this ADR is "done" when:

1. `npm install @infra-tools/agentic-ui-mcp` works against an unrelated app and produces a buildable Node binary that exposes the consumer's `ToolDef[]` as an MCP server.
2. Mounting the demo MCP server in Claude Desktop's `claude_desktop_config.json` lets the user type *"Book a flight from LAX to JFK on May 5"* and see the demo's `bookFlight` handler run with the typed result returned to Claude.
3. The same `bookFlightTool` registered in `<mvk-chat-shell>` (via `provideAgenticUi({ tools: [bookFlightTool] })`) continues to render the `flightCard` widget — proving the dual-consumer pattern works without forks.
4. A new cookbook entry walks an integrator from zero to "my tool runs in Claude Desktop" in ≤ 10 minutes.
5. Lib build green; CI green; existing 85 tests pass; new MCP-package tests pass.
6. Zero new bytes shipped to consumers of the core `@infra-tools/agentic-ui` package who don't import the MCP package.

## Consequences

- **Distribution multiplier**: every consumer's existing tools become invokable from every IDE-class chat host without their building a chat UI. Library reach goes from "Angular apps" to "any MCP-compatible host."
- **Validates the registry-as-portable-capability pattern**: the same `ToolDef` is now consumed by two surfaces (our chat shell + arbitrary MCP hosts) without per-surface forks.
- **Zero impact on core-lib bundle**: the MCP package is opt-in; consumers not using it pay nothing.
- **MCP spec evolution risk**: pin `@modelcontextprotocol/sdk` to a known-good version; bump deliberately. Document the supported spec version in the cookbook.
- **Generative UI fidelity ceiling**: markdown hosts won't render Angular components. The multi-shape return convention (`markdown` / `image_url`) gives the agent author room to provide a respectable rendering at lower fidelity. Image-rendering escape hatch (server-side widget-to-PNG) is a future optimisation, not part of this ADR.

## Alternatives considered

1. **Bundle MCP support directly into `@infra-tools/agentic-ui`**.
   *Rejected*: pollutes the core-library bundle with Node-only deps (`@modelcontextprotocol/sdk`, stdio transports) that browsers don't need. Optional packages keep the core surface tight.
2. **Bundle into `@infra-tools/agentic-ui-server`**.
   *Rejected*: agentic-ui-server is the AG-UI route handler library — its concern is the `ServerAgent` contract, not protocol bridges. MCP isn't AG-UI; it's a sibling protocol with its own wire format. Different lifecycle, different deps, different consumer audience.
3. **Server-render Angular components to PNGs as the default tool-result**.
   *Rejected for v1*: heavy infra (puppeteer, image cache); fragile (font, viewport, environment differences); cost. The markdown convention covers ≥ 90 % of useful renderings; image rendering is a Tier 2 follow-up.
4. **Build the MCP server inside the Angular app** (browser-side).
   *Rejected*: MCP hosts (Claude Desktop, Cursor) connect to the server over stdio or HTTP/SSE — they expect a Node process or HTTP endpoint, not a browser. The browser app consumes its own tools through the chat shell; MCP exposes the same tools to a separate audience.

## Out of scope (for this ADR)

- Image rendering of generative-UI components (Tier 2 follow-up).
- MCP "resources" and "prompts" surfaces (beyond `tools/list` + `tools/call`). Add when a consumer asks.
- WebSocket transport. Stdio + HTTP/SSE cover all current host use cases.
- Multi-tenant authentication (one consumer's MCP server serving many users). Single-tenant + bearer auth covers the demo; multi-tenant is a v2 concern.
- Permission scopes on individual tools (the `requiresConfirmation` work in Tier 1.2 covers the related security concern; permission scoping is a separate orthogonal feature).
- Bundling the MCP server with a published Docker image.

## How to start (concrete next step)

If the team accepts this ADR, the work begins by scaffolding `projects/agentic-ui-mcp/` per Phase 0. Phase 0 → 6 are designed to be a single contributor's ~3–4 day effort with no concurrent dependencies on other parts of the codebase; the only cross-cutting touch is the optional one-line `ToolDef` return-type extension which is additive and doesn't break any existing test.

The roadmap entry ([`ROADMAP.md`](../../ROADMAP.md#11--mcp-server-side-adapter)) tracks status; this ADR will move from `Proposed` → `Accepted` when implementation begins, and the roadmap row will gain `→ shipped, see CHANGELOG` once Phase 6 verification passes.
