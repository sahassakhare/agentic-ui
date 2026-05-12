# Teams + Copilot integration plan

**Status:** draft · **Owner:** sahas · **Started:** 2026-05-11
**Related ADR:** [ADR-041 — Teams + Copilot external surfaces](../adr/0041-teams-copilot-external-surfaces.md)

How we extend the agentic-ui platform to two external ecosystems —
**Microsoft Teams** and **Microsoft / GitHub Copilot agents** — without
forking the library, without rewriting tools, and without losing the
shared audit chain. The shape is: every external surface is a new
**adapter package** that consumes the existing `AgenticBackend` /
catalog interfaces; the runtime tier and control plane don't change.

---

## 1. Goals & non-goals

**Goals.**

- Reuse `@infra-tools/agentic-ui` and its 15 registries unchanged across
  every new surface. No code fork.
- Keep the catalog server (capability registry / audit chain / tenant
  RBAC / IAM persona resolver) the single source of truth across
  surfaces. Every surface writes audit events with an `origin` tag.
- Register a tool once → it works in chat shell, Teams tab, Teams
  bot, Microsoft Copilot Studio agent, GitHub Copilot extension, and
  MCP host. Tools never know which surface called them.
- Honour ADR-010 D4 zero-breaking-changes contract — adapters extend,
  they don't modify the runtime tier's public surface.

**Non-goals.**

- Net-new agent protocols. Use AG-UI / Hashbrown / A2UI / MCP / BYO
  adapters already shipped.
- Net-new registries. The 15 existing ones cover every surface.
- Replacing `<mvk-chat-shell>` in any external surface. The chat
  shell is the canonical Angular surface; Teams and Copilot get
  their own native chat surfaces with adapter-rendered cards.
- Productionising any single surface in v1 — focus is demo-grade
  parity across surfaces, leaving the operator-grade polish (rate
  limits, retries, multi-tenant scaling) as follow-up slices.

---

## 2. The seam in one diagram

```
                                ┌── @infra-tools/agentic-ui (Angular library)
                                │     mvk-chat-shell · 15 registries · F1–F6
                                │     ← canonical surface, ships today
                                │
                                ├── Teams Tab        (Path 1a, eDiscovery shell in iframe)
                                │     manifest + microsoft-teams-js context
                                │
                                ├── @infra-tools/agentic-ui-teams-bot      (Path 1b, NEW)
catalog server   ──┬────────────┤     Bot Framework adapter + Adaptive Card render hint
(capabilities,     │            │
 tenants, RBAC,    │            ├── Copilot Studio Connector + sync     (Path 1c, NEW)
 audit chain,      │            │     publishes catalog actions to MS Copilot Studio
 IAM persona       │            │
 resolver)         │            ├── @infra-tools/agentic-ui-copilot-skill  (Path 2a, NEW)
                   │            │     GitHub Copilot Extensions webhook
                   │            │
                   │            └── @infra-tools/agentic-ui-mcp            (already shipped)
                   │                 Claude Desktop · Cursor · Continue · Zed
                   │
                   └── audit chain + capability registry shared by ALL surfaces above
```

Every NEW adapter package consumes the same `AgenticBackend`
interface ([projects/agentic-ui/src/lib/types/agentic-message.ts](../../projects/agentic-ui/src/lib/types/agentic-message.ts))
and translates our internal event shapes (`tool-call-*`,
`widget-render`, `text-delta`) into the target ecosystem's native
shapes.

---

## 3. Path 1 — Microsoft Teams

### 1a. Teams **Tab** (full-page iframe embed)

**What.** Ship the existing `demo-ediscovery-shell` (or any
`@infra-tools/agentic-ui` host) as a Teams Tab. The Angular SPA runs
inside an iframe that Teams renders in a channel / group chat / 1:1
chat sidebar.

**How.**

1. Add a Teams app manifest (`manifest.json`) declaring the tab
   capability + the deployed Render URL.
2. Wire `microsoft-teams-js` (or `@microsoft/teams-js@2`) to read the
   Teams **context** at boot: `tenantId`, `userPrincipalName`,
   `theme` (light/dark/contrast). Bridge that into the existing
   `provideAgenticUi` config so the catalog sees a real Teams tenant
   id instead of the demo `'ediscovery'` fixture.
3. Theme alignment: the shell already supports CSS variables; bind
   them to `prefers-color-scheme` + Teams's `theme` event so dark
   mode follows Teams.
4. Auth: the Teams JS SDK gives us an AAD SSO token (silent flow).
   Inject it into `AuthService` so the catalog `AUTH_MODE=oidc` path
   accepts the bearer.

**Trade-offs.** Lowest cost (no new code path, just packaging).
Chat surface still looks like our Angular UI, not a Teams-native
conversation — operators get the familiar `<mvk-chat-shell>` in a
Teams tab, not the Teams chat composer.

**Effort.** 3–5 days (1 dev-week including SSO end-to-end).

**Deliverables.**

- `examples/demo-ediscovery-teams-tab/` — new example
- Teams app manifest + icons
- `provideTeamsContext()` factory inside the shell that maps Teams
  context to catalog `principal`
- Cookbook entry [docs/cookbook/teams-tab.md](../../docs/cookbook/teams-tab.md)

### 1b. Teams **Bot** + Adaptive Cards (chat-native surface)

**What.** Operators chat with the agent **inside Teams** (channel
or 1:1). Tool results render as **Adaptive Cards** posted by a Bot
Framework bot. Same tools, same audit chain — different chrome.

**How.**

1. New package `@infra-tools/agentic-ui-teams-bot`. Wraps
   `AgenticBackend.run(...)` and translates our event stream into
   Bot Framework activities.
2. New optional render hint on `ToolResultRenderHints`:
   ```ts
   readonly adaptiveCard?: object;  // raw Adaptive Card 1.5 schema
   ```
   Tools that want a Teams-native render emit the AC schema
   alongside the existing `components` and `markdown` fields. Mirror
   of the existing `html` MCP hint (ADR-006).
3. The bot subscribes to the message-stream signal, picks the
   highest-fidelity render hint per turn (AC > markdown), posts to
   the Teams conversation reference via `BotFrameworkAdapter`.
4. **Card-only fallback for tools that don't emit AC.** A generic
   converter renders `{name, props}` widget specs as a simple AC
   card with the props shown as a fact set + a "Open in tab"
   button that deep-links to the Teams Tab (Path 1a) for the rich
   surface.
5. Persona / persona scope: the bot reads the Teams user's AAD
   group claims and maps them via the catalog's `role-mappings`
   table (already in place from M3) into a runtime persona before
   instantiating the chat ref.

**Trade-offs.** Native Teams UX, but rich generative-UI (forms,
workflows, approvals) downgrade to Adaptive Card facsimiles. Same
trade we already made for MCP (ADR-006). Tools authored without an
`adaptiveCard` hint look spartan in Teams but work — generic
fallback. Polishing per-tool AC schemas is a follow-up.

**Effort.** 3 weeks (1 dev × 3w) including SSO, conversation state
persistence, and ~6 AC mappers for the eDiscovery tools.

**Deliverables.**

- `projects/agentic-ui-teams-bot/` — new Angular-CLI library
- `examples/demo-ediscovery-teams-bot/` — Express server hosting
  the bot endpoint
- 6 hand-written AC mappers for the core eDiscovery tools
- ADR-041 (this slice anchors the contract additions)

### 1c. Microsoft **Copilot Studio** connector

**What.** Customers use Microsoft 365 Copilot as their primary
agent surface. Our catalog's tools are exposed to Copilot Studio
as **custom actions** via a Connector. A Microsoft Copilot user
asking *"open the custodian intake page"* gets the action invoked
via the Connector → our agent server runs the tool → the user lands
on the eDiscovery shell.

**How.**

1. New sync job: walks the catalog's `/v1/catalogs/{tenant}/tools`
   list and publishes each as a Copilot Studio Connector action
   (uses the **Power Platform Connector** OpenAPI shape). Schema
   translation: our Zod schemas → OpenAPI 3 (already half done —
   the catalog server emits OpenAPI for `@hono/zod-openapi`).
2. Authentication: an Azure AD enterprise app registration for the
   connector, with admin consent for the tenant's catalog scope.
3. Each Connector action's "implementation" URL points at our agent
   server endpoint `/copilot-studio/tool/{toolName}` which runs the
   handler with the Copilot Studio user context.
4. Card responses use the same Adaptive Card schemas from Path 1b
   — Copilot Studio renders AC natively.

**Trade-offs.** Highest reach (every M365 Copilot user); hardest
to ship. Tool schema translation has corner cases — Copilot Studio
doesn't model union types or refinements the way our Zod schemas
do. Auth model is Azure-AD-centric; OAuth-2 mapping to our
catalog's IAM is non-trivial.

**Effort.** 5–6 weeks (1 dev × 5w + 1w for the Azure AD app + admin
consent dance). Requires a Microsoft Partner Center listing if we
want to publish the Connector publicly.

**Deliverables.**

- `tools/copilot-studio-sync/` — sync job (node script)
- Connector OpenAPI manifest + Azure AD app registration
- `/copilot-studio/tool/*` route family in the agent server
- ADR-042 (deferred; specifics depend on the spike outcome)

---

## 4. Path 2 — GitHub Copilot

### 2a. GitHub **Copilot Extension** (chat skill)

**What.** Our agentic UI's tool surface available inside GitHub
Copilot Chat — across VS Code, JetBrains, github.com — via the
[Copilot Extensions](https://docs.github.com/copilot/building-copilot-extensions)
protocol. A developer asking Copilot Chat *"place a legal hold for
project phoenix"* invokes our tools through the extension.

**How.**

1. New package `@infra-tools/agentic-ui-copilot-skill`. Wraps an HTTP
   webhook that Copilot Chat calls with `{messages, tools}` — the
   shape is nearly identical to OpenAI Chat Completions.
2. Translate Copilot's SSE event stream into our `AgenticEvent`
   shapes and feed `runUntilSettled` (already exported). Translate
   the result events back into Copilot's expected SSE chunks.
3. Auth: GitHub App-style installation, scoped per organization /
   tenant. Same `principal` plumbing as the catalog already does
   for OIDC.
4. Manifest publishing: ship as a `github-copilot-extension`
   manifest in the eDiscovery repo, optionally listed on GitHub
   Marketplace.

**Trade-offs.** Reaches every GitHub Copilot user (large
developer audience); only text + markdown (no rich generative UI
in Copilot Chat). Our forms and workflows degrade to markdown
prompts that the developer reads + answers via follow-up turns.

**Effort.** 2 weeks (1 dev × 2w) including the GitHub App
registration + a marketplace listing draft.

**Deliverables.**

- `projects/agentic-ui-copilot-skill/` — new library
- `examples/demo-ediscovery-copilot/` — Express server hosting
  the webhook
- GitHub App manifest + Marketplace listing copy
- Cookbook entry [docs/cookbook/github-copilot-extension.md](../../docs/cookbook/github-copilot-extension.md)

### 2b. GitHub Copilot **Workspace** custom agent

**What.** Copilot Workspace is GitHub's spec-driven agent
environment tied to Issues + Pull Requests. A custom agent could
register our tools as automation steps inside Workspace spec
sessions.

**Trade-offs / status.** Workspace's extensibility API is still
maturing as of 2026-05; the surface is GitHub-Issues-tied which
doesn't map cleanly to an eDiscovery workflow. Defer until the
API stabilises and we have a concrete adopter ask.

**Effort.** TBD. Spike first, no commitment.

---

## 5. Architecture seams enumerated

Every new path uses **at most** these contract additions; nothing
else moves:

| Change | Where | Stability | Notes |
|---|---|---|---|
| Add `adaptiveCard?: object` to `ToolResultRenderHints` | [projects/agentic-ui/src/lib/types/tool-result.ts](../../projects/agentic-ui/src/lib/types/tool-result.ts) | additive, public API per ADR-010 D4 | Mirrors existing `html` hint for MCP |
| New `origin` field on `AuditAppendInput` | [platform/agentic-catalog-server/src/repository/audit-repo.ts](../../platform/agentic-catalog-server/src/repository/audit-repo.ts) | additive | Lets the audit row carry `'teams-bot'`, `'copilot-skill'`, etc. |
| New `provideTeamsContext()` factory | new file in `projects/agentic-ui/src/lib/platform/` | additive | Reads `microsoft-teams-js` context, maps to catalog principal |
| New `/copilot-studio/tool/{toolName}` route family | `platform/agentic-catalog-server` or a sibling server | additive | Only required for Path 1c |

No removals. No breaking changes. ADR-010 D4 honoured.

---

## 6. Phased delivery

| Phase | Slice | Effort | Cumulative effort | Outcome |
|---|---|---|---|---|
| **P0** | Teams Tab embed (Path 1a) | 1 wk | 1 wk | eDiscovery demo running inside Teams; SSO end-to-end; theme follows Teams |
| **P1** | `agentic-ui-teams-bot` + AC render hint (Path 1b) | 3 wk | 4 wk | Teams chat replaces our chat shell as the conversation surface; 6 hand-AC'd tools |
| **P2** | `agentic-ui-copilot-skill` (Path 2a) | 2 wk | 6 wk | GitHub Copilot Chat invokes our tools across VS Code / JetBrains / github.com |
| **P3** | Copilot Studio connector (Path 1c) | 5 wk | 11 wk | Microsoft 365 Copilot users hit our tools enterprise-wide |
| **P4** (optional) | Copilot Workspace custom agent (Path 2b) | TBD | — | Defer pending Workspace API stability |

P0 + P2 = **3 weeks total** and unlocks both ecosystems at demo
quality. Recommend this as the first deliverable; P1/P3 follow if
adopter signal warrants.

---

## 7. Test discipline

- Each new adapter package has a vitest harness with a stub
  `AgenticBackend` that emits canned events; the adapter must
  produce the expected target-ecosystem output (AC JSON, Copilot
  SSE chunks).
- One end-to-end integration test per surface, gated behind
  `INTEGRATION=1` so it doesn't run on every PR — needs real
  Teams / GitHub credentials in CI secrets.
- The existing lib + catalog test suites must stay green at every
  commit boundary. Library changes are strictly additive (new
  optional fields), so no existing test should fail.
- Catalog audit-chain integrity is verified after each adapter's
  end-to-end test by re-walking the chain — guards against
  origin-tagging regressions.

---

## 8. Cross-cutting concerns

### Identity & tenant mapping

Each surface has its own identity model:
- **Teams Tab / Bot:** AAD `tenantId` + `userPrincipalName`
- **Copilot Studio:** AAD app registration + signed-in user claims
- **GitHub Copilot Extension:** GitHub App installation id + user
  login

Our catalog has a single `tenants` table + `role-mappings` keyed
on JWT claims (ADR-016). Each adapter needs a **claim-translation
layer** that maps the surface's claims into the catalog's
principal. The role-mappings table already supports this — we add
new claim paths per surface, not new tables.

### Audit fan-in

Every adapter's tool-call dispatch goes through the catalog's
audit endpoint. Each adapter sets `origin` on the audit row so the
ops console's activity feed can filter by surface
(`origin: 'teams-bot'`, `origin: 'copilot-skill'`, …). The
existing `chainHash` integrity walk works unchanged.

### Generative UI fidelity matrix

| Capability | Angular surface | Teams Tab | Teams Bot (AC) | Copilot Studio (AC) | GitHub Copilot (markdown) |
|---|---|---|---|---|---|
| F1 forms | ✓ | ✓ | partial | partial | text fallback |
| F1-dyn dynamic forms | ✓ | ✓ | text fallback | text fallback | text fallback |
| F2 live data | ✓ | ✓ | partial | partial | text fallback |
| F3 workflows | ✓ | ✓ | partial (1 card per step) | partial | text fallback |
| F4 approvals | ✓ | ✓ | ✓ (AC has actions) | ✓ | manual y/n in chat |
| F5 long-running | ✓ | ✓ | progress card refresh | progress card refresh | poll status command |
| F6 multi-modal | ✓ | ✓ | image attachments via AC | partial | dropped |

Tools that need rich Angular interactivity (the F3 workflow
wizard, the F1 composition predicates) deep-link from the AC card
into the Teams Tab — operator clicks "Open in tab" and continues
on the full Angular surface.

### Cost discipline

Each external surface is another LLM call per turn. Two layers of
gating:

1. **Per-surface token cap.** Each adapter passes a max-tokens
   ceiling to the backend; over-budget calls reject early.
2. **Per-tenant rate limit.** The existing usage-meter table
   (M3 / ADR-018) already tracks `tool.invoke` quantities; the
   adapter writes the `origin` so the host can enforce per-surface
   quotas.

### Failure UX

When the agent has no tool that fits the user's ask:

- **Teams Tab:** same as Angular shell — chat panel shows the
  conversational reply.
- **Teams Bot:** post a text reply + a "Switch to web app"
  deep-link card.
- **Copilot Studio:** Copilot Studio handles "no match" natively;
  we return a structured "no_tool_match" response.
- **GitHub Copilot:** stream the model's text reply; Copilot Chat
  shows it in-line.

---

## 9. Risks & open questions

1. **Adaptive Card schema drift.** Microsoft pushes AC 1.6 in
   2026-Q3; our cards target 1.5. Risk of degraded rendering in
   newer Teams clients. Mitigation: lock to a tested AC version
   per adapter; bump deliberately.
2. **Copilot Studio's tool schema does not preserve Zod
   refinements.** We may lose constraint checks (e.g.,
   `z.string().min(2)`) when translating to Connector OpenAPI.
   Mitigation: tools server-side re-validate every input; never
   trust the connector's schema enforcement.
3. **GitHub Copilot Extensions auth flow is GitHub-App-specific.**
   Our existing OIDC plumbing assumes JWT bearers. New code path
   to wrap GitHub App JWTs into our `principal` shape.
4. **Multi-tenancy in Teams**: a Teams Tab installed in multiple
   tenants needs the tab URL to be cross-tenant capable — our
   Render deployment ships per-environment, so we'll need a
   per-tenant config endpoint at boot.
5. **Persona resolution.** Each surface has different identity
   sources for persona inference. Currently the demo hard-codes a
   `lead-counsel` persona; production deployments need a real
   resolver per surface.

---

## 10. Decision needed

Pick the first target audience:

| Pick | Audience | Phases | Why |
|---|---|---|---|
| **Teams-first** | Internal users on Microsoft 365 / Teams | P0 → P1 | Quickest path to a real Teams demo; AC fallback works for 80% of tools |
| **GitHub-first** | Developers on GitHub Copilot Chat | P2 | Reaches a developer audience that values text-stream agents; lowest fidelity but widest reach |
| **Enterprise-first** | MS Copilot Studio admins | P0 → P3 (skip P1) | Highest reach long-term but slowest to ship; requires admin consent + Connector listing |

Concrete next steps once the target is picked:

- **Teams-first:** scaffold `examples/demo-ediscovery-teams-tab/`,
  add the manifest, wire `microsoft-teams-js` context. ~3 days to
  a working demo.
- **GitHub-first:** scaffold
  `projects/agentic-ui-copilot-skill/`, implement the webhook
  protocol, register a GitHub App. ~5 days to local Copilot Chat
  hitting the eDiscovery tools.

ADR-041 records the contract additions (the `adaptiveCard` render
hint, the `origin` audit field, `provideTeamsContext()`). Per-path
ADRs (042+) cover the specifics of each adapter; deferred until
the path is chosen.

---

## Definition of done (overall plan)

- [ ] ADR-041 ratifies the contract surface (this commit).
- [ ] At least one of P0 / P1 / P2 shipped end-to-end with a live
      demo URL operators can hit.
- [ ] Catalog audit chain integrity verified across surfaces — a
      mutation issued via Teams Bot and one via GitHub Copilot
      both land in `catalog_audit` with correct `origin` tags.
- [ ] Cookbook entry per shipped path.
- [ ] No regressions in existing test suites; total catalog +
      ops-console test count strictly grows or stays.
