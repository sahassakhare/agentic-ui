# Reference implementations — Hashbrown · A2UI · WebMCP · MCP-UI

> **Date prepared**: 2026-05-21
> **Status**: Draft RFC — **do not implement**. Awaiting approval + decisions on the items at the end.
> **Predecessor**: [ADR-048](../adr/0048-backend-adapter-parity-contract.md) (backend parity — client adapters), [ADR-049](../adr/0049-mcp-ui-inbound-rendering.md) (MCP-UI), [ADR-050](../adr/0050-webmcp-tool-exposure.md) (WebMCP). The [Backend support matrix](../../README.md#backend-support-matrix) already documents these as "client-conformant, reference adopter-supplied."

## The gap this closes

Four protocols ship **client adapters** but lack **end-to-end reference implementations** — a working server (or shim) + a demo that exercises the adapter against it + (ideally) an e2e test. This is the "operational parity" gap the senior-architect review flagged: the adapters are conformant and unit-tested, but nothing in the repo proves them end-to-end, and adopters have nothing to copy.

| Protocol | Client adapter | Reference server / shim | Demo wiring | Real-LLM e2e | This plan |
|---|---|---|---|---|---|
| AG-UI | ✅ | ✅ `demo-server` | ✅ 16 demos | ✅ Playwright | (already complete — the template) |
| Hashbrown | ✅ (post-L1) | ❌ | ❌ | ❌ | **R1** |
| A2UI | ✅ (post-L1) | ❌ | ❌ | ❌ | **R2** |
| WebMCP | ✅ (`agentic-ui-webmcp`) | ❌ (no browser implements `navigator.modelContext`) | ❌ | ❌ | **R3** |
| MCP-UI | ✅ inbound renderer (ADR-049) | ❌ (no UIResource source) | ❌ | ❌ | **R4** |

## The key simplification (why this is smaller than it looks)

Post-L1, all three backend adapters (AG-UI / Hashbrown / A2UI) consume the **canonical `AgenticEvent` stream**. The Hashbrown + A2UI client adapters parse NDJSON lines straight into `agenticEventSchema`. So a reference server is trivial:

> **Run the existing `ServerAgent` (Echo or Gemini), and for each yielded `AgenticEvent`, write `JSON.stringify(event) + '\n'`.**

That's it. The same agent loop that powers AG-UI emits the same events; only the wire framing differs (SSE for AG-UI, NDJSON for Hashbrown/A2UI). The reference servers are ~40 LOC route handlers, not new agent implementations. R1 and R2 are mostly demo-wiring + a thin NDJSON serializer.

WebMCP (R3) and MCP-UI (R4) are different — WebMCP needs a `navigator.modelContext` shim (the API doesn't exist in browsers yet), and MCP-UI needs a tool that emits `UIResource`s. Both are demo-side, not server-side.

---

## R1 — Hashbrown reference server + demo

**What ships**:
- A Hashbrown-shaped route handler in `examples/demo-server` (`POST /agents/hashbrown/run`): accepts `{threadId, runId, messages, tools, state}`, runs the existing `GeminiAgent` (or `EchoAgent` fallback), streams the agent's `AgenticEvent`s as NDJSON.
- A demo wiring: extend `demo-monolith` (or a new `demo-protocols`) with `provideHashbrownBackend({ url: '/agents/hashbrown/run' })` + a backend switcher so a reviewer can flip AG-UI ↔ Hashbrown and see identical behavior.
- A Playwright smoke (LLM-free, EchoAgent): send a message, assert the NDJSON round-trips into the transcript.

**Effort**: 1.5 days. **Risk**: low (the canonical-event insight makes the server thin).

**Proves**: the Hashbrown adapter's tool-schema serialization + `state` threading + event validation work against a real NDJSON server — the L1 parity claim becomes verifiable.

---

## R2 — A2UI reference server + demo (with ui-action dispatch)

**What ships**:
- An A2UI-shaped route handler (`POST /agents/a2ui/run`): like Hashbrown's, but the agent ALSO emits a `ui-action` event (e.g. `{ type: 'ui-action', actionId, op: 'navigate', payload }`) so the demo exercises the distinguishing A2UI feature.
- A demo wiring with `provideA2uiBackend(...)` + a `UI_ACTION_DISPATCHER` wired to a real `ActionRegistry` action (e.g. navigate-to-route). Proves the L1 dispatcher fix (live `threadId`/`runId` attribution).
- A Playwright smoke: trigger a ui-action, assert the action's effect ran with the correct thread/run ids.

**Effort**: 2 days (the ui-action dispatch demo is the extra bit over R1). **Risk**: low-medium (A2UI spec 0.x — we pin our wire shape + document it).

**Proves**: the A2UI adapter's ui-action path + the dispatcher attribution fix from L1.

---

## R3 — WebMCP reference shim + demo

**What ships**:
- A **`navigator.modelContext` shim** (dev-only, in the demo — NOT in the lib): a minimal in-page implementation of the proposal's `registerTool` / `unregister` surface, backed by a simple "agent panel" UI where a developer types a prompt and the shim invokes a registered tool. This is the reference for "what an in-browser agent calling WebMCP looks like."
- A demo wiring `provideWebMcp({ persona })` + the shim, showing: register a tool → it appears in the agent panel → invoke it → scope + approval gating in action (try a paralegal-scoped tool, see it queue an approval).
- A Playwright smoke: register a tool via the shim, invoke it, assert the handler ran (and an approval-gated one queued).

**Effort**: 2.5 days (the shim + agent-panel UI is the work; the lib side is done). **Risk**: medium — `navigator.modelContext` is a proposal; the shim models our best understanding and is clearly labeled dev-only. If the proposal shifts, the shim updates (the lib adapter's `NavigatorModelContext` interface is the single point of truth).

**Proves**: the WebMCP adapter's reactive registration + scope + approval gating end-to-end, without waiting for browser support.

---

## R4 — MCP-UI reference UIResource source + demo

**What ships**:
- A tool (in a demo) that returns each of the three MCP-UI payload shapes: `text/html` (inline card), `text/uri-list` (an allowlisted external widget URL), and `component-tree+json` (a composition of the demo's own registered widgets). Plus a tiny static HTML page for the uri-list case.
- A demo route rendering the resources via `<mvk-mcp-ui-resource>`, with `provideMcpUi({ allowedOrigins, navigate, onUnhandledAction })` wired so the action bridge's `tool` / `link` dispatch is exercised (click a button in the sandboxed iframe → it posts an action → a host tool runs).
- A Playwright smoke: render each payload type; for the component-tree, assert the native widgets mount; for html, assert a posted `tool` action dispatches (scope-gated).

**Effort**: 2 days. **Risk**: low (the renderer + bridge are done; this is a UIResource source + demo).

**Proves**: the MCP-UI inbound renderer + action bridge + component-tree renderer end-to-end, including the security boundary (origin allowlist, scope-gated tool dispatch).

---

## Where it all lives — two options

**Option A — extend existing demos.** Hashbrown/A2UI routes go in `examples/demo-server`; the demo wiring extends `demo-monolith` with a backend switcher; WebMCP + MCP-UI get routes in an existing demo. Pro: no new app. Con: `demo-monolith` grows a lot of protocol-switching chrome that muddies its "simplest example" purpose.

**Option B — a new `examples/demo-protocol-gallery` app.** One showcase app: a backend switcher (AG-UI / Hashbrown / A2UI), a WebMCP agent-panel, and an MCP-UI resource gallery. Reference servers still live in `demo-server`. Pro: a single coherent "every protocol, working" showcase — strong for evaluators; keeps `demo-monolith` clean. Con: a new app to maintain (~the 17th example).

**Recommendation: Option B.** A protocol-gallery demo is the artifact that makes the README's multi-protocol pitch tangible — one URL, flip between protocols, see MCP-UI render, watch WebMCP gate an approval. It's also the natural home for the e2e specs.

---

## Sequencing

```
R1 Hashbrown server + demo      (1.5d)  ─┐
R2 A2UI server + ui-action demo (2.0d)  ─┤ share the demo-server NDJSON serializer
R4 MCP-UI UIResource + demo     (2.0d)  ─┤ + the gallery shell
R3 WebMCP shim + agent panel    (2.5d)  ─┘ (most net-new — the shim)
```

R1 first (establishes the NDJSON serializer + gallery shell), then R2 (reuses both), then R4 (gallery route), then R3 (the shim is the most independent + highest-uncertainty piece). Total **~8 days** + ~2 days of Playwright e2e across the four = **~10 days**.

## Value assessment (honest)

**High value:**
- R1 + R2 make the L1 backend-parity claim verifiable end-to-end and give adopters copy-paste reference servers. Directly closes the operational-parity gap the senior-arch review + the README support matrix flagged. **This is the most defensible work** — it backs a claim the README already makes.
- R4 makes MCP-UI demonstrable — without it, ADR-049 is code + tests with nothing to look at.

**Medium / speculative value:**
- R3 (WebMCP shim) proves the adapter, but `navigator.modelContext` has no browser support — the shim is a model, not a real integration. Worth it to validate the adapter + show the shape; lower urgency than R1/R2 until the proposal gains traction.

**Net:** R1 + R2 + R4 are clearly worth doing (they back existing claims + make recent work demonstrable). R3 is worth doing for completeness but is the one to defer if scope needs trimming.

## Risks

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R-1 | Hashbrown/A2UI reference servers diverge from real upstream server shapes | medium | low | We control the wire (adopter-defined for Hashbrown; spec-0.x pinned for A2UI). Document the shape in each server's header. |
| R-2 | WebMCP shim drifts from the eventual `navigator.modelContext` spec | medium | low | Shim is dev-demo-only, clearly labeled; the lib's `NavigatorModelContext` interface is the single update point. |
| R-3 | A new gallery app adds maintenance + a 17th example | low | low | One app, shared with e2e; the showcase value outweighs upkeep. |
| R-4 | LLM-dependent demos need an API key | low | low | Every demo already degrades to EchoAgent; e2e smokes use Echo (LLM-free), matching the existing `00-smoke` convention. |
| R-5 | Bundle / build-matrix growth | low | low | Demos aren't published; reference servers are dev artifacts. No FESM impact. |

## Decisions needed before any code

1. **Scope.** All four (R1–R4), or R1+R2+R4 (defer R3 WebMCP shim)? Decision: **all four / defer R3 / other**.
2. **Home.** Option A (extend existing demos) or Option B (new `demo-protocol-gallery`)? Decision: **A / B**.
3. **LLM in the demo.** Reference servers reuse `GeminiAgent` (needs key) with `EchoAgent` fallback (matches `demo-server`). Confirm that's acceptable vs Echo-only. Decision: **Gemini+Echo / Echo-only**.
4. **e2e.** Add Playwright smokes per protocol (LLM-free, ~2 days), or ship demos without e2e for now? Decision: **with e2e / demos-only**.
5. **A2UI wire shape.** Pin our A2UI server to spec 0.x as we interpret it, documented in the server header — acceptable? Decision: **yes / research upstream first**.
6. **WebMCP shim packaging.** Shim lives in the demo (dev-only), NOT shipped in `@infra-tools/agentic-ui-webmcp`. Confirm. Decision: **demo-only / ship a polyfill in the package**.

## What I'm asking for

- Approval (or rejection) of the recommended scope: **R1 + R2 + R4 now, R3 deferred** — in a new `examples/demo-protocol-gallery` (Option B), reference servers in `demo-server`, with LLM-free Playwright smokes.
- Decisions on the six items above.
- If approved, I'll start with R1 (establishes the shared NDJSON serializer + gallery shell), then R2, R4, and R3 if in scope.
