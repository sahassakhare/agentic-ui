# ADR-050 — WebMCP tool exposure (`navigator.modelContext`)

> **Status**: Accepted (Phase 2 shipped 2026-05-21 as `@infra-tools/agentic-ui-webmcp`).
> **Predecessor**: [ADR-006](./0006-mcp-server-side-adapter.md) (Node MCP server — the outbound-to-a-host case). [ADR-008](./0008-registry-scope-policy.md) (scope policy). [ADR-010 D4](./0010-platform-principles-and-license.md) (optional plugins live outside core). [ADR-049](./0049-mcp-ui-inbound-rendering.md) (MCP-UI inbound rendering — sibling concern).
> **Plan**: [docs/plans/mcp-ui-webmcp-support-plan.md](../plans/mcp-ui-webmcp-support-plan.md) (Phase 2).

## Context

`@infra-tools/agentic-ui-mcp` exposes the app's tools to an MCP host *outside* the browser (Claude Desktop / Cursor / Zed) over a Node server. WebMCP (`navigator.modelContext`) is the in-browser mirror: a draft browser API that lets a page expose tools to an in-browser agent. Same `ToolRegistry` source, different transport.

The proposal is pre-stable. Whatever we ship must feature-detect it and degrade cleanly when absent (every browser today, unless flagged/polyfilled, plus SSR + tests).

## Decision

Ship WebMCP exposure as a sibling package — `@infra-tools/agentic-ui-webmcp` — not in core. Rationale: ADR-010 D4 (optional, browser-API-gated plugins live outside core), matching the `agentic-ui-opa-authorizer` precedent. Keeps the core FESM lean (WebMCP adds zero bytes to it).

### ADR-050-1 — Feature-detect; degrade to no-op

`getModelContext()` checks `navigator.modelContext.registerTool` is a function. Absent → the service emits one `agentic.webmcp.unavailable` telemetry event and does nothing. No errors.

### ADR-050-2 — Reactive mirror of the scope-filtered tool set

`provideWebMcp()` subscribes to `ToolRegistry.signal()` and registers each visible tool with `navigator.modelContext`. `ToolRegistry.list()` applies the scope policy on read, so a tool hidden from the active persona is **never registered**. The mirror re-syncs (register new, unregister vanished) on every visible-set change — federate a remote, change the scope policy, and WebMCP follows.

### ADR-050-3 — Inbound calls re-check scope + validate args

Every inbound call re-resolves the tool via `ToolRegistry.get` (scope re-applied — the policy may have changed since registration) and reports a single `tool-not-found-or-scoped` reason on miss (no existence leak). Args are validated against the tool's Zod schema before the handler runs.

### ADR-050-4 — Approval-gated, mirroring the chat-shell HITL intercept

A tool with an `ApprovalRegistry` policy whose `required(args, ctx)` returns true is **not auto-executed**. The call enqueues a pending `Approval` and returns a pending result, exactly like the orchestrator's chat-shell intercept. A throwing predicate fails closed (queues). Same defense-in-depth caveat as ADR-049: client-side gating is necessary but not sufficient — HITL-critical tools must also enforce server-side.

### ADR-050-5 — Pure core, thin Angular shell (testability)

The security-critical logic (`invokeWebMcpTool`, `syncRegistrations`) lives in framework-free functions tested directly (no TestBed), matching the repo convention that sibling packages test pure logic (cf. `agentic-ui-opa-authorizer`). The `WebMcpService` is a thin DI shell that wires `inject()` + `effect()` reactivity around them.

## Consequences

### Positive
- The app's tools become callable by an in-browser agent with the same scope + approval guarantees as the chat shell — no second authorization model.
- Reactive: tools added via federation or scope change appear/disappear in WebMCP automatically.
- Zero core-FESM cost (sibling package).
- 18 tests cover feature detection, schema conversion, scope gate, validation, approval queueing, registration diff.

### Negative
- `navigator.modelContext` is a moving target. The `NavigatorModelContext` interface is the single point to update if the proposal shifts; everything else is internal.
- The synthetic-context invocation bypasses the orchestrator's approval intercept wiring (it re-implements the queue check). Documented; server-side enforcement still required for HITL.
- No reference browser to integration-test against today — the adapter is unit-tested + build-verified, like the other external-surface adapters (teams-bot, m365-agents, copilot-skill) per the L6 convention.

### Neutral
- Inbound WebMCP (consuming tools another script on the page exposes) is NOT in this slice — it's a thin `McpClient` fed into the existing `mcpToolBridge`, deferred to a later phase.

## Alternatives considered

1. **Ship in core (`lib/webmcp/`).** Rejected — ADR-010 D4 says browser-API-gated optional plugins live outside core; also keeps the FESM lean.
2. **Auto-execute approval-gated tools (trust the in-browser agent).** Rejected — an in-browser agent is semi-trusted; HITL tools must queue, same as the chat shell.
3. **Full `@remote-dom/core` for the render side.** Out of scope here (that's ADR-049 / MCP-UI Phase 3, and we ship a JSON component-tree instead of the heavy worker-RPC runtime).

## Related
- [ADR-006](./0006-mcp-server-side-adapter.md) · [ADR-008](./0008-registry-scope-policy.md) · [ADR-049](./0049-mcp-ui-inbound-rendering.md)
- [docs/plans/mcp-ui-webmcp-support-plan.md](../plans/mcp-ui-webmcp-support-plan.md)
