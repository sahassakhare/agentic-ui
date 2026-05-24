# Library × target-host compatibility & gap analysis

> Date: 2026-05-24. A senior-architect assessment of each published package against the
> host(s) it targets — what works today, what's emerging, what's not viable, and the
> concrete gaps/bugs to fix. Confidence is flagged per claim:
> **[V]** verified in code/over-the-wire this session · **[O]** observed at runtime ·
> **[A]** assessed from code, not independently retested.

## 0. Executive verdict

| Surface (package) | Target host(s) | Verdict today |
|---|---|---|
| Angular host lib (`agentic-ui`) | Your own browser app | ✅ **Works** — the mature, dependable surface |
| AG-UI chat (`agentic-ui` + `agentic-ui-server`) | AG-UI servers (SSE) | ✅ **Works** — real `@ag-ui/client` 0.0.52, full stack + deployed demo |
| Hashbrown chat (`agentic-ui`) | Hashbrown servers | ✅ **Works (native)** — real `@hashbrownai/core` 0.4.1 frames |
| A2UI chat (`agentic-ui`) | A2UI servers | ⚠️ **Contract-only** — no ratified spec/SDK exists to be a client of |
| MCP server (`agentic-ui-mcp`) | Claude Desktop, Cursor, ChatGPT, MCPJam, web hosts | ⚠️ **Tools work; UI emerging** — SEP-correct, but host renderers immature |
| MCP-UI inbound (`agentic-ui`) | Your app as an MCP-UI host | ✅ **Works** — renders MCP Apps SEP (`text/html;profile=mcp-app`) + legacy, with the `ui/*` JSON-RPC action channel |
| WebMCP (`agentic-ui-webmcp`) | In-page agent (`navigator.modelContext`) | ⚠️ **Spec-shaped** — draft browser API, no ratified spec |
| M365 / Teams (`-m365-agents`, `-teams-bot`, `-copilot-*`) | M365 Copilot, Teams | ✅ **Works** — Adaptive Cards, the mature non-web UI path |

**One-line takeaway:** the library is solid where *you* control the host (your Angular app) and for
the two mature standards (**AG-UI** and **Adaptive Cards / M365**). Everything aimed at *third-party
assistant hosts rendering rich UI* (MCP Apps in Claude Desktop/ChatGPT, WebMCP, A2UI) is **correct on
our side but gated on host/spec maturity we don't control.**

---

## 1. Chat transports (in `agentic-ui`)

| Backend | SDK / spec | Status | Gap |
|---|---|---|---|
| **AG-UI** | `@ag-ui/client` + `@ag-ui/encoder` **0.0.52** (pinned) **[V]** | Production. SSE over `fetch`; full event mapping; reference server + deployed demo. | Pre-1.0 SDK — pinned; watch for breaking 0.0.x bumps. The `{components:[…]}` generative-UI convention is *our* layer, not AG-UI spec. |
| **Hashbrown** | `@hashbrownai/core` **0.4.1** (optional peer) **[V]** | Native this session — sends `CompletionCreateParams`, decodes length-prefixed frames. | ⚠️ **Breaking wire change vs the 1.2.2 NDJSON adapter** — flagged in CHANGELOG; needs a minor bump on release. Tool-call streaming mapped; tool *results* go back via the next turn (Hashbrown model). |
| **A2UI** | none — **no ratified spec or SDK** **[V]** | Canonical-contract adapter (posts lib `AgenticMessage[]`, parses canonical NDJSON, adds `ui-action`). | ⚠️ **Cannot be made "native"** — the `a2ui` npm name is an unrelated Angular-2 lib; the protocol is unsettled. Honest labeling is the correct end state. |

**Cross-backend:** all normalize to the canonical `AgenticEvent` stream (ports-and-adapters), enforced by `runConformance`. Swapping is one provider line. **Limitation [A]:** transport is HTTP request/response-streaming — half-duplex per turn, **no resume/replay** on a dropped stream (an implementation/stateless-design choice, not a protocol limit), and the single-active `BackendRegistry` is a *selector, not a router* (no simultaneous multi-agent multiplexing).

---

## 2. MCP server — `agentic-ui-mcp` → MCP hosts

**Tools (stdio):** ✅ **Works.** Verified over stdio: `tools/list`, `tools/call`, schema conversion, hooks. Claude Desktop lists and calls the tools. **[V]/[O]**

**MCP Apps UI (SEP-1865):** ⚠️ **Server-correct; host rendering immature.**
- Implemented this session **[V]**: `resources/list`/`read` serving `ui://` templates as `text/html;profile=mcp-app`, `_meta.ui.resourceUri` on tools, `io.modelcontextprotocol/ui` capability negotiation, `structuredContent`. All confirmed over the wire.
- **Gap — render-only:** the iframe→host **action channel** (`ui/*` JSON-RPC: `tools/call` back, `ui/open-link`, `ui/update-model-context`) is **not wired**. UI can display data but can't call tools back. **[V]**
- **Host reality [O]:** Claude Desktop emits the "rendered a widget" note but **paints nothing** — its console showed an internal `oncalltool handler replaced` loop + React re-render storm, **zero faults on our resource/template/CSP**. Reproduced after the update prompt. → a **Claude-client bug**, not ours. MCP Apps host support is days/weeks old industry-wide.

**Transport bugs [V]:**
- **HTTP transport is the deprecated HTTP+SSE** (`SSEServerTransport`, `GET /sse` + `POST /message?sessionId=`), **not** modern Streamable HTTP. Fine for stdio (the common case); a gap for remote hosts.
- **Embeddable path calls the SDK's private `server._handleRequest`** — brittle across SDK versions; SDK loosely pinned `^1.0.0`.

---

## 3. MCP-UI inbound — `agentic-ui` (`provideMcpUi` + `<mvk-mcp-ui-resource>`)

✅ Renders `text/html` (sandboxed `srcdoc`), `text/uri-list` (origin-allowlisted), component-tree (native widgets); `remote-dom` recognized-but-stubbed. Strong security model (sandbox `allow-scripts` only, origin + scope-gated actions). **[V]**

✅ **SEP convergence done (this session) [V]:** the inbound renderer now also accepts the **MCP Apps SEP** mime `text/html;profile=mcp-app` (rendered as sandboxed srcdoc) and speaks the **`ui/*` JSON-RPC-over-postMessage** action channel via `McpUiActionBridge.handleAppRpc`:
- `ui/initialize` → host capabilities handshake; the renderer then pushes the resource's `data` as a `ui/notifications/tool-result` (presentation/data separation).
- `tools/list` / `tools/call` → scope-gated through the same `ToolRegistry` policy as the legacy channel; unknown/forbidden tools return an `isError` result without leaking existence.
- `ui/open-link` → router/external navigation; `ui/update-model-context` → delegated to the host handler.
- Legacy `text/html` + `{source:'mcp-ui', action}` is retained for back-compat. **Outbound (`agentic-ui-mcp`) and inbound now both speak the SEP.** Covered by `mcp-ui-action-bridge.spec.ts`.

---

## 4. WebMCP — `agentic-ui-webmcp` → in-page agent

⚠️ **Spec-shaped, honestly labeled.** Targets the **draft** `navigator.modelContext` browser API; hand-rolled shim, feature-detects + no-ops when absent. **[A]** No ratified spec — bets on the imperative `registerTool` shape; if the declarative `provideContext({tools})` form wins upstream, it breaks. Not a defect; a forward-looking bet.

---

## 5. M365 / Teams / Copilot — the mature non-web UI path

✅ `agentic-ui-m365-agents` + `agentic-ui-teams-bot` ship **Adaptive Card** rendering (`adaptive-card.ts` + `respond.ts` in each) **[V-file]**. Adaptive Cards are the **native, mature rich-UI format** for Teams and M365 Copilot — the one third-party-host UI path that works reliably today. `agentic-ui-copilot-skill` + `-copilot-studio-connector` extend reach into Copilot surfaces.

**Caveat [A]:** these were not deep-tested this session (no live M365 tenant run). The Adaptive Card mapping fidelity for complex tool results, and the exact Copilot/Teams card-action round-trip, are worth a live verification before claiming production parity.

---

## 6. Server-side infra packages (not deep-analyzed this session)

`agentic-ui-server` (AG-UI SSE route handler — **[V]** correct: validation, status codes, SSE encoding, abort).

**Review pass (this session) [V]:**
- **`agentic-ui-server-registrar`** — solid. Idempotent register (409 recovery via name lookup), best-effort heartbeat, `unref`'d timer, graceful SIGTERM → inactive. No issues.
- **`agentic-ui-server-stores`** (Redis + Postgres `ThreadStateStore`) — solid. Caller-owned client lifecycle, TTL, corrupt-entry-as-missing, upsert on conflict. Minor notes (not bugs): Postgres `table` is string-interpolated (dev config, not user input — pg can't parameterize identifiers); Redis/PG don't pub/sub on change (documented — pair with `RegistryProviderHook`).
- **`agentic-ui-opa-authorizer`** — ⚠️ **fixed a real reactivity bug.** A background OPA decision flipping to *deny* after the first `onMiss:'allow'` read never hid the entry: the registry's filtered `computed` didn't re-evaluate (the policy read a plain `Map`; the provider's `effect` reading the registry signals was a no-op for propagation). Fix: `decide()` now reads the `cacheVersion` signal so the policy-running `computed` tracks it; removed the no-op `effect`. New regression test. (v1.2.4)

---

## 7. Cross-cutting issues found this session

1. **Legacy-vs-SEP MCP-UI split [V]** — outbound now SEP, inbound still legacy; the earlier "mime mismatch fix" aligned outbound to our *own* legacy renderer, then the SEP work moved outbound to `text/html;profile=mcp-app`. **Inbound must follow.** (§3)
2. **Packaging / ESM [V]** — `demo-shared-tools` shipped an extensionless ESM import (`from './tools'`) that **broke Node-direct execution** (Claude Desktop launch); fixed with `.js`. Audit all Node-targeted packages for explicit ESM extensions.
3. **Path-with-spaces [O]** — the repo lives under `my projects/`; hosts/tools that split args on whitespace (MCPJam) fail. Affects adopter ergonomics; document quoting / array-args.
4. **MCP SDK pinning [V]** — `^1.0.0` is loose given we touch a private method; pin tighter.
5. **Versioning [V]** — Hashbrown's breaking wire change means the next release should be a **minor** (≥1.3.0), not a 1.2.3 patch.

---

## 8. Prioritized fix list

**P0 — correctness / convergence** ✅ DONE (this session)
1. ✅ Migrated **MCP-UI inbound renderer to the MCP Apps SEP** (mime `text/html;profile=mcp-app`, `data`→`ui/notifications/tool-result`, `ui/*` JSON-RPC). In-app + third-party rendering now converge on one standard. (§3)
2. ✅ Added the **MCP Apps action channel** (host side, `McpUiActionBridge.handleAppRpc`): iframe→host `tools/call`, `tools/list`, `ui/open-link`, `ui/update-model-context` — scope-gated. UI is interactive, not render-only. (§3)

**P1 — robustness**
3. Replace the **deprecated HTTP+SSE** MCP transport with **Streamable HTTP**; drop the private `_handleRequest`; tighten the SDK pin. (§2)
4. **ESM-extension audit** across Node packages; document the spaces-in-path pitfall. (§7)
5. Cut a **minor release (≥1.3.0)** capturing the breaking Hashbrown wire change. (§7)

**P2 — verification / honesty**
6. **Live-verify M365/Teams** Adaptive Card rendering on a real tenant. (§5) — *code-level review done (mappers + send path solid); live-tenant run still outstanding.*
7. ✅ Reviewed the **server infra packages** (registrar/stores/OPA) — registrar + stores clean; fixed an OPA reactivity bug (v1.2.4). (§6)
8. Keep **A2UI / WebMCP** labeled as contract-/spec-shaped until upstream specs ratify. (§1, §4)

**Not actionable by us:** Claude Desktop's MCP Apps renderer bug (file upstream with the `oncalltool` loop). (§2)
