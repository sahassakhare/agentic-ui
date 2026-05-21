# ADR-049 — MCP-UI inbound rendering + action security model

> **Status**: Accepted (Phase 1 shipped 2026-05-21). Phases 2–3 (WebMCP expose, remote-dom → ComponentRegistry) remain planned.
> **Predecessor**: [ADR-006](./0006-mcp-server-side-adapter.md) (MCP server-side adapter — the *emit* side). [ADR-008](./0008-registry-scope-policy.md) (registry scope policy — reused here for tool gating). [ADR-048](./0048-backend-adapter-parity-contract.md) (the backend parity pattern this follows).
> **Plan**: [docs/plans/mcp-ui-webmcp-support-plan.md](../plans/mcp-ui-webmcp-support-plan.md).

## Context

The library already EMITS MCP-UI: `@infra-tools/agentic-ui-mcp` returns tool results as `text/html;profile=mcp-app` resource blocks (`MCP_UI_HTML_MIME`). What was missing was the CONSUMER side — rendering an MCP-UI `UIResource` inside the Angular shell and handling the actions it posts back.

MCP-UI `UIResource`s carry one of three payloads:
- `text/html` — inline HTML, rendered in a sandboxed iframe via `srcdoc`
- `text/uri-list` — an external URL, rendered via `src` (origin-sensitive)
- `application/vnd.mcp-ui.remote-dom+javascript` — server-described UI as remote-DOM elements (Phase 3)

A rendered resource can post actions back to the host over `postMessage`: `{ type: 'tool' | 'intent' | 'link' | 'notify' | 'prompt', payload }`. Each maps onto a registry the lib already has. The hard problem is **trust**: a UIResource is potentially-untrusted content executing UI in (near) the host's context. The action channel must not become a way to invoke arbitrary tools or navigate arbitrarily.

## Decision

Ship MCP-UI inbound rendering as a core-lib module (`lib/mcp-ui/`) with a strict, default-deny security model.

### ADR-049-1 — Sandboxed iframe rendering

`<mvk-mcp-ui-resource>` renders every resource in an `<iframe>` with a configurable `sandbox` attribute. The default is `allow-scripts` ONLY:
- NOT `allow-same-origin` — combined with `allow-scripts`, same-origin would let the frame escape the sandbox and reach the host's DOM / storage. Off by default.
- NOT `allow-top-navigation`, `allow-forms`, `allow-popups` — adopters widen deliberately.

`text/html` payloads render via `srcdoc` (origin `'null'`). `text/uri-list` payloads render via `src` and are subject to the origin allowlist (ADR-049-3).

### ADR-049-2 — All inbound actions are Zod-validated before dispatch

Every `postMessage` is parsed with `mcpUiMessageSchema` (a Zod discriminated union). Messages that don't match are dropped. Messages that *claim* to be MCP-UI (`source: 'mcp-ui'`) but fail validation emit `agentic.mcp_ui.action_blocked` telemetry; messages that don't claim to be MCP-UI are dropped silently (a frame may `postMessage` to itself for unrelated reasons).

### ADR-049-3 — Origin allowlist for external resources, default-deny

`text/uri-list` resources are refused unless their origin is on the configured `allowedOrigins`. The default allowlist is **empty** — only inline `text/html` (srcdoc, origin `'null'`) renders out of the box. Adopters opt into external origins explicitly. `'*'` is supported but documented as trusted-server-only.

Inbound `postMessage`s from an external-URL frame must match BOTH the frame's loaded origin AND the allowlist. Inline srcdoc frames post from origin `'null'` and are accepted (they ran the host's own HTML).

### ADR-049-4 — Tool actions go through the registry scope policy

A `tool` action resolves the tool via `ToolRegistry.get(name)`, which applies the active scope policy (ADR-008) on read. A tool hidden from the active persona resolves to `undefined` — exactly as it would for the LLM. The bridge reports a single `tool-not-found` reason for both "doesn't exist" and "hidden by scope" so an untrusted UIResource cannot probe which tools exist.

**Defense-in-depth caveat**: the bridge runs the tool's handler directly via a synthetic `ToolContext` (it does NOT route through the orchestrator's approval intercept). Adopters who require HITL approval on a tool MUST also enforce it server-side — the standard ADR-008 note that client-side filtering is necessary but not sufficient.

### ADR-049-5 — Link actions are gated

`link` actions with `target: 'router'` route through an optional navigate callback (wired by `provideMcpUi({ navigate })`); without it they no-op (`no-router`). `target: 'external'` opens only absolute `http(s)` URLs via `window.open(..., 'noopener,noreferrer')`.

### ADR-049-6 — Not-yet-first-class actions delegate, never silently execute

`intent` / `notify` / `prompt` actions are validated, then handed to an optional `onUnhandledAction` host callback. The library does not guess a dispatch for them in Phase 1. First-class dispatch (IntentRegistry / notification tray / chat-prompt injection) lands as those seams are threaded in.

## Consequences

### Positive
- The render plane gains a path for raw-HTML / external-URL UI it never had — the reserved `iframe_url` render hint (`tool-result.ts:108`) is finally meaningful.
- The action channel reuses the existing scope policy, so persona gating extends to UIResource-triggered tool calls with zero new policy code.
- Opt-in + default-deny means apps that don't render MCP-UI pay nothing, and apps that do can't accidentally expose tools or origins.
- 26 tests cover the security boundary (origin, scope, malformed payloads, delegated actions).

### Negative
- The synthetic-context tool invocation bypasses the orchestrator's approval intercept. Documented (ADR-049-4); the mitigation is server-side enforcement.
- remote-dom is recognised but unsupported in Phase 1 — a UIResource of that type renders an "unsupported" stub. Phase 3 closes it.
- Adopters must understand the sandbox model to render external URLs safely; the strict default reduces footgun risk but external rendering is inherently a trust decision.

### Neutral
- The MCP *emit* side (ADR-006 / `agentic-ui-mcp`) is unchanged. This ADR is purely the consumer side.
- No new package — `lib/mcp-ui/` is part of the core entry (ADR-005 single-primary-entry preserved); `sideEffects: false` keeps it tree-shakeable.

## Alternatives considered

1. **Render MCP-UI HTML directly in the host DOM (no iframe).** Rejected — no sandbox, arbitrary script in the host context. Non-starter for untrusted resources.
2. **Allow all origins by default.** Rejected — default-deny is the only safe default; adopters opt in.
3. **Route tool actions through the full orchestrator (approval intercept included).** Deferred — the orchestrator is turn-shaped (messages + stream); a UIResource action is a one-shot dispatch. Wiring it through the orchestrator is possible but larger; the synthetic-context path + the server-side-enforcement note is the Phase 1 compromise.
4. **Ship as a separate `@infra-tools/agentic-ui-mcp-ui` package.** Rejected — rendering is a core browser concern tied to `ComponentRegistry`; keeps the 10-package surface from growing.

## Related
- [ADR-006](./0006-mcp-server-side-adapter.md) — MCP server-side adapter (emit side)
- [ADR-008](./0008-registry-scope-policy.md) — scope policy reused for tool gating
- [docs/plans/mcp-ui-webmcp-support-plan.md](../plans/mcp-ui-webmcp-support-plan.md) — full phasing (Phase 2 WebMCP, Phase 3 remote-dom)
