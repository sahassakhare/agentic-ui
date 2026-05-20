# MCP-UI + WebMCP support — RFC + plan

> **Date prepared**: 2026-05-21
> **Status**: Draft RFC — **do not implement**. Awaiting approval to proceed (or reject), plus decisions on six items at the end.
> **Predecessor**: [ADR-006](../adr/0006-mcp-server-side-adapter.md) added `@infra-tools/agentic-ui-mcp` (lib-as-MCP-server — expose this lib's tools to Claude Desktop / Cursor / Zed). [ADR-048](../adr/0048-backend-adapter-parity-contract.md) codified the backend parity contract that AG-UI / Hashbrown / A2UI all conform to. This plan extends both.
> **Audience**: maintainers + anyone evaluating whether MCP-UI / WebMCP belong in the same lib.

---

## What MCP-UI and WebMCP are (the verification step we need)

Before scoping the work, the plan needs to agree on what we're targeting. Two protocols, both recent and both evolving:

### MCP-UI

**Working definition** (subject to verification — see "What I need to confirm before C1"): an extension to the Model Context Protocol that lets an MCP server emit UI widget references alongside tool results. Instead of an MCP server returning just text or render-hint HTML, it returns *typed widget descriptors* (`{ name, props }`-shaped or similar) that the consuming MCP host renders natively.

There's a third-party project (commonly referenced as `mcp-ui`, GitHub `idosal/mcp-ui` or similar) that prototyped this pattern. The spec itself is informal and pre-1.0.

**What needs verification before any code lands:**
- Is `mcp-ui` (`idosal/mcp-ui`) the canonical implementation we're targeting, or a different project?
- What does the wire shape actually look like? Specifically: how does an MCP server signal "render this widget" — via a content-type marker on tool results, a new event class, an extension namespace?
- Is propsSchema validation on the consumer side intended? (If yes, this aligns naturally with the lib's `agenticWidget({propsSchema})`.)
- What's the security model? An MCP server emitting widgets is effectively executing UI in the host's process; how is the trust boundary defined?

If the upstream spec disagrees with this plan, we revise before writing code.

### WebMCP

**Working definition** (subject to verification): MCP exposed over a web transport. The MCP base spec supports stdio (for local desktop hosts) and Streamable HTTP (for remote servers; added in 2025-03 spec). "WebMCP" most likely refers to one of:

1. **MCP servers running in the browser** — exposing tools to other browser tabs / web apps via `postMessage` or BroadcastChannel. A web-native peer to the stdio + HTTP transports.
2. **A specific framework / project named WebMCP** — there have been at least two prototypes by this name; we'd pick one to align with.
3. **Just "MCP over HTTP+OAuth"** — informal name for the new HTTP transport now in the spec.

**What needs verification:**
- Which of the three definitions above are we adopting?
- Transport details: WebSocket? SSE? `postMessage`? `BroadcastChannel`?
- Discovery: how does a host find a WebMCP server in the same browser?
- Auth: stdio assumes a trusted local process; HTTP requires OAuth; WebMCP browser-side has neither out of the box.

---

## Why this is worth considering (and why it might not be)

**The case for adding both:**

1. **MCP is consolidating as the cross-vendor tool protocol.** Claude Desktop, Cursor, Continue, Zed, Cline, plus growing browser-side support. Adding consumer-side MCP support to this lib makes any MCP server's tools usable inside an Angular agentic UI — that's a real expansion of the protocol surface adopters can plug into.
2. **MCP-UI specifically closes a real gap.** Today MCP servers return text or HTML render hints (the lib's existing MCP package does the latter). Typed widget references would let the lib's `ComponentRegistry` resolve MCP-served widgets the same way it resolves agent-served widgets. That's a clean alignment.
3. **WebMCP could be the simplest path to "agentic UI without an agent server."** If a WebMCP MCP server can live in a Service Worker / Web Worker, the lib could host a fully-local agentic experience — no Hono server, no SSE roundtrip. Useful for offline-first, demos, edge cases.
4. **The backend-adapter contract (ADR-048) is the natural home.** Add `provideMcpUiBackend({…})` and `provideWebMcpBackend({…})` alongside `provideAgUiBackend` / etc.; the rest of the lib doesn't change.

**The case against (the honest part):**

1. **MCP-UI is pre-spec.** We'd be adopting a moving target. Hashbrown + A2UI's "we ship a stub that compiles" trap is recent — let's not repeat it. If MCP-UI's wire shape changes after we ship, every adopter has to follow.
2. **The lib already exposes tools to MCP hosts.** `@infra-tools/agentic-ui-mcp` covers "expose Angular tools to Claude Desktop." The reverse direction (consume MCP server tools inside the Angular shell) is a different population of adopters — smaller, and arguably better served by writing your tools natively.
3. **Backend sprawl is a real cost.** We just shipped L1 to bring Hashbrown + A2UI to parity with AG-UI. Adding two more backends doubles the conformance-suite + parity-contract surface. If neither has a *demo* in the repo (the gap we acknowledged for Hashbrown + A2UI), we accumulate the same "client-conformant but operationally unproven" problem.
4. **Federation interaction is non-obvious.** Today, MFE remotes contribute tools via `defineCapabilityModule`. If an MCP server can ALSO contribute tools (via WebMCP discovery), we have two paths to "where did this tool come from." Source-tag discipline (`source: 'mcp:<server>'`) handles teardown, but the LLM-budget-per-turn question (`keywordToolFilter`) gets harder.

**Net read:** the value-prop is real (multi-vendor agentic-UI ecosystem), but only if we wait for the upstream specs to stabilize OR are willing to maintain shims through the churn. Both options should be on the table.

---

## Four implementation directions

The work splits along two axes — direction (lib-as-client vs lib-as-server) × protocol (MCP-UI vs WebMCP):

| | MCP-UI | WebMCP |
|---|---|---|
| **Lib-as-client** (consume) | Option C1 — adopt MCP-UI widget references as an additional `widget-render` source on the chat shell | Option C2 — new backend adapter `provideWebMcpBackend({…})` so MCP servers can drive the chat shell |
| **Lib-as-server** (expose) | Option E1 — extend `@infra-tools/agentic-ui-mcp` to emit MCP-UI-shaped widget references when tools return `components: [...]` | Option E2 — ship a browser-side MCP server (separate package, e.g. `@infra-tools/agentic-ui-webmcp`) that adopts the WebMCP transport |

### Option C1 — Consume MCP-UI widget references (lib-as-client)

**Scope.** When the chat shell receives a tool result from an MCP-UI-aware MCP server (via WebMCP or a new MCP-over-HTTP backend), translate the MCP-UI widget reference into the lib's canonical `widget-render` event. `ComponentRegistry` resolves the widget name the same way it does today.

**Required work:**
- A protocol-translation helper in `lib/backends/_shared/canonical-events.ts` (or a peer file): `extractMcpUiWidgets(mcpToolResult) → AgenticEvent[]`.
- Schema + adapter for MCP-UI's specific wire shape (TBD post-verification).
- Conformance test in `lib/testing/conformance-suite.ts`: any backend advertising MCP-UI capability must yield widget-render events that round-trip through the helper.

**Effort:** 1.5 days IF the upstream spec is settled. 3+ days if we need to negotiate edge cases (validation rules, props schema location, content-type signaling).

**Risk:** Low-medium. The translation is structurally similar to what `extractWidgetRenders` does today for the `{components: [...]}` convention.

### Option C2 — WebMCP backend adapter (lib-as-client)

**Scope.** A new client-side `AgenticBackend` implementation that talks to a WebMCP server. Mounted alongside AG-UI / Hashbrown / A2UI in `BackendRegistry`; conforms to ADR-048; passes `runConformance` capability-gated checks.

**Required work:**
- New `lib/backends/webmcp/webmcp-backend.ts` + spec file matching the L1 pattern (tools serialized via `serializeToolsForWire`, events validated via `parseAgenticEventStrict`, `state` threaded).
- New `provideWebMcpBackend({…})` provider in the same shape as the existing three.
- Transport implementation: depending on which WebMCP variant we adopt, this is `postMessage` / `BroadcastChannel` / `WebSocket` / `EventSource`.
- README: extend the [Backend support matrix](../../README.md#backend-support-matrix) row with WebMCP's status.
- ADR-049 (parity addendum) noting WebMCP's capability flags.

**Effort:** 3–4 days if WebMCP is "MCP-over-HTTP with extra steps" (an SSE-shaped adapter we can lift from the existing AG-UI work). 5–7 days if it's a fundamentally different transport (browser-to-browser `postMessage`) that needs its own discovery / handshake.

**Risk:** Medium. Transport choice and discovery story are upstream-decided; we're a downstream client.

### Option E1 — Emit MCP-UI from `agentic-ui-mcp` (lib-as-server)

**Scope.** Today `@infra-tools/agentic-ui-mcp` returns tool results with HTML render hints (`text/html;profile=mcp-app`). MCP-UI would let it emit typed widget references instead. Hosts that understand MCP-UI render natively; hosts that don't see the same HTML fallback.

**Required work:**
- Extend the package's result formatter to emit BOTH the legacy HTML hint AND the new MCP-UI widget reference, with the host selecting via Accept header / capability negotiation.
- Document the MCP-UI surface in the package README; cross-link from cookbook `mcp-server.md`.
- New tests asserting the dual-output emission.

**Effort:** 1.5–2 days. Adopting an output format is mechanically simple; the cost is keeping HTML and MCP-UI in lockstep through future spec changes.

**Risk:** Low. Backward compatibility is preserved by the dual emission.

### Option E2 — Browser-side WebMCP server package (lib-as-server)

**Scope.** A new sibling package — `@infra-tools/agentic-ui-webmcp` — that wraps an Angular app's `ToolRegistry` as a browser-resident WebMCP server. Other browser tabs (or the same page hosting a different agent) can call into it via the WebMCP discovery + transport.

**Required work:**
- New sibling package + tsconfig + tests, matching the layout of `@infra-tools/agentic-ui-teams-bot`.
- Transport implementation (Service Worker / Worker / `BroadcastChannel` — TBD).
- Discovery mechanism (how does another tab find this server?).
- Auth story (cross-origin: same-origin only? consent flow?).
- Cookbook entry + decision-tree doc update.

**Effort:** 4–6 days. The package skeleton + transport are the simple parts; the discovery + auth story is the hard part and is upstream-decided.

**Risk:** Medium-high. Browser-to-browser MCP is the least-settled of the four options.

---

## Recommended scope (the honest middle)

Of the four options, the cleanest first step is **C1 + E1 together (MCP-UI consumer + producer)**, with WebMCP deferred:

- **C1 + E1 share most of the translation work.** The same `extractMcpUiWidgets` helper is consumed both ways. We write it once.
- **MCP-UI is a smaller surface change than WebMCP.** No new transport, no new backend adapter — it slots into existing seams (the result-formatter on the server side, the widget-render path on the client side).
- **WebMCP can be added later as a separate slice** once the transport choice has stabilized upstream.
- **We can verify upstream alignment quickly** (a 1-day spike to read `mcp-ui` source + the MCP spec discussion threads) before committing to specific wire shapes.

Two-slice plan if approved:

| # | Slice | Effort | Output |
|---|---|---|---|
| **M1** | MCP-UI verification + alignment spike | 1 day | Doc capturing the exact upstream wire shape, validation rules, security model. Output feeds M2's design. |
| **M2** | C1 (consume) + E1 (produce) MCP-UI | 3–4 days | Helper in `_shared/`, conformance test, dual-emission in `agentic-ui-mcp`, README support-matrix update, ADR-049 |

WebMCP becomes a separate slice (M3) ~3 weeks later — gives upstream time to settle.

Total scope under recommendation: **4–5 days of work**, two commits, one ADR. Smaller than the L1 parity work; comparable risk to L6.

---

## Pros and cons

### Pros of the recommended scope

1. **Extends the lib's protocol surface without doubling adapter complexity.** MCP-UI plugs into existing widget-render paths.
2. **Producer + consumer in the same slice.** Adopters can both consume MCP-UI servers AND expose Angular tools via MCP-UI — bidirectional alignment.
3. **Conformance harness (slice L5) already has teeth.** New backends will fail the capability-gated checks if MCP-UI isn't wired correctly.
4. **No new sibling package.** We extend `@infra-tools/agentic-ui-mcp` rather than adding `@infra-tools/agentic-ui-mcp-ui`. Keeps the 10-package surface intact.

### Cons (and risks)

1. **MCP-UI's spec is unsettled.** R1 in the risks register. Mitigated by M1's verification spike.
2. **Adopter confusion.** "Wait, the lib supports MCP and MCP-UI?" — a doc clarity problem. Cookbook + README support-matrix updates address it.
3. **Security boundary.** MCP-UI widgets rendered in the host process inherit the host's privileges. If MCP servers are not in the host's trust domain, this is a real attack vector. Mitigation: explicit `MCP_UI_ALLOWED_ORIGINS` config; default to deny.
4. **Browser MCP / WebMCP gets deferred.** May lose the window if upstream picks a transport we don't anticipate. Acceptable because WebMCP is highest-risk + lowest-readiness today.

---

## Risks register

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | MCP-UI wire shape changes after we ship | medium | high | M1 spike confirms the shape; ADR-049 pins the version we target; backward-compat via dual-emission |
| R2 | Adopters confuse `agentic-ui-mcp` (expose tools) with MCP-UI support (render widgets) | medium | low | Cookbook clarification + README support-matrix row |
| R3 | Security — malicious MCP server emits a widget that breaks out of the propsSchema | low | high | Mandatory propsSchema validation at the orchestrator boundary; widgets without registered names render as "unknown widget" stubs (already the lib's default) |
| R4 | WebMCP, if approved separately, fails to deliver on the cross-tab use case | medium | medium | Treat WebMCP as a separate decision; don't couple to MCP-UI |
| R5 | The 10-package surface grows again | low | low | Recommended scope deliberately extends an existing package; no new sibling |
| R6 | Conformance suite (L5) grows with MCP-UI-specific checks | medium | low | Acceptable cost; the harness already has the gated-check pattern |

---

## What I need to confirm before M2 starts

The M1 spike is a 1-day budget to read upstream and verify these assumptions. If any answer surprises us, the plan revises before M2.

1. **Canonical reference.** Is `idosal/mcp-ui` the spec we're targeting? If not, what is?
2. **Wire shape.** How does an MCP server signal "this tool result has a widget"? Content-type, custom field, extension namespace?
3. **Propsschema validation responsibility.** Server-side, client-side, or both?
4. **Security boundary.** What's the recommended trust model?
5. **WebMCP transport.** Among postMessage / BroadcastChannel / WebSocket / SSE, which has the most upstream momentum?
6. **Discovery for WebMCP.** Is there a discovery RFC, or is it ad-hoc per host?

---

## Decisions needed before any code lands

If you approve proceeding, the following decisions gate M2:

1. **Scope confirmation.** Approve "C1 + E1 (MCP-UI bidirectional), defer WebMCP." Or pick a different scope. Decision: **C1+E1 / C1 only / E1 only / all four / defer everything**.
2. **Spec alignment.** Approve the M1 verification spike as a hard prerequisite. Decision: **approve / skip and proceed on best-effort / defer**.
3. **Package home for MCP-UI.** Extend `@infra-tools/agentic-ui-mcp` (recommended) vs ship a new `@infra-tools/agentic-ui-mcp-ui`. Decision: **extend / new package**.
4. **Conformance-suite addition.** Does MCP-UI get a capability-gated check in `runConformance`? Decision: **yes / no**.
5. **ADR commitment.** ADR-049 will codify the MCP-UI parity addendum once shipped. Decision: **acceptable / propose alternative**.
6. **WebMCP timeline.** Slot WebMCP for M3 after MCP-UI ships (recommended), or commit to a longer single-slice plan that includes both. Decision: **defer / single-slice**.

---

## Alternatives considered

1. **Don't add MCP-UI or WebMCP — stay with the four backends (AG-UI / Hashbrown / A2UI / MCP server-side).** Rejected if MCP-UI is becoming a real consolidation point; accepted if you'd rather wait for the spec to stabilize.
2. **Add both, in one slice, immediately.** Rejected — WebMCP's transport story is the riskiest variable; staging it gives upstream time to converge.
3. **Add WebMCP first, MCP-UI second.** Rejected — MCP-UI is the smaller, lower-risk addition and the bidirectional path delivers more value to existing MCP-server adopters.
4. **Ship MCP-UI as a separate `@infra-tools/agentic-ui-mcp-ui` package.** Rejected — keeps the 10-package surface from growing; MCP-UI is a natural extension of the existing MCP package, not a new concern.

---

## Cross-references

- [ADR-006](../adr/0006-mcp-server-side-adapter.md) — original MCP server-side adapter (lib-as-server, stdio + HTTP)
- [ADR-048](../adr/0048-backend-adapter-parity-contract.md) — backend parity contract; ADR-049 will be the MCP-UI addendum
- [cookbook/mcp-server.md](../cookbook/mcp-server.md) — current MCP server cookbook
- [cookbook/paralegal-mcp-review.md](../cookbook/paralegal-mcp-review.md) — end-to-end MCP demo from the eDiscovery flagship
- [docs/plans/library-hardening-plan.md](./library-hardening-plan.md) — completed six-slice hardening plan (L1–L6); this plan inherits the parity contract + conformance harness it shipped
- [docs/plans/agentic-core-split-plan.md](./agentic-core-split-plan.md) — pending RFC for the `agentic-core` package; if approved, MCP-UI helpers move with the rest of the canonical layer

---

## What I'm asking for

- Approval (or rejection) of the recommended scope: **MCP-UI bidirectional (C1 + E1), WebMCP deferred to M3.**
- Decisions on the six items in "Decisions needed."
- If approved, I'll start with the M1 verification spike (~1 day, no code), report findings, then proceed to M2.

If rejected, this plan stays in the repo as the record of considered options.
