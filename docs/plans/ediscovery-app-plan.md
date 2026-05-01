# Plan: enterprise eDiscovery example application

> **Status**: **Phases 0–7 shipped** · Phase 8 (library `RegistryEntry.scopes`) optional / deferred.
>
> | Phase | Theme | Commit |
> |-------|-------|--------|
> | 0 + 1 | Foundation + collection specialist | [`8791d20`](../../#) |
> | 2 | Federate review remote | [`0ce7ebb`](../../#) |
> | UX | Enterprise-grade UX overhaul | [`8b71cbb`](../../#) |
> | 3 | Production remote + click-to-nav | [`e88f447`](../../#) |
> | 4 | Search remote + tool-filter activation | [`7cb29fe`](../../#) |
> | 5 | Chain of custody + tamper-evident audit | [`2c0a2c6`](../../#) |
> | 6 | MCP server for analyst workstations | [`47af4cd`](../../#) |
> | 7 | Persona permission shim | [`074e509`](../../#) |
>
> Apps shipped under `examples/`: `demo-ediscovery-{shared,server,shell,review,production,search,mcp}`. Open `:4300` for the host shell.
>
> **Why this plan**: the existing example apps (demo-monolith, demo-multi-agent, demo-shell + remotes, demo-feature-tour, demo-mcp-server) are deliberately small to keep each one inspectable. They demonstrate single concepts in isolation. They do **not** show what `@maverick/agentic-ui` looks like under real enterprise load: dozens of tools per matter, multi-tenant data isolation, regulatory audit trails, per-role permissions, federated remotes from independent teams, MCP integration for analyst workstations.
>
> An eDiscovery application exercises every load-bearing library feature simultaneously and is a recognisable, regulated, complex domain — the right shape to validate the architecture and to give consumers a reference of "this is what the library looks like at scale."

## Why eDiscovery

eDiscovery (electronic discovery) is the legal-tech process of identifying, collecting, processing, reviewing, and producing electronic documents in response to litigation or regulatory investigation. The domain has properties that make it a natural fit for agentic UI:

| Property | Why it exercises the library |
|---|---|
| **Multiple distinct domains** — collection, processing, review, production, legal hold, search | Natural fit for MFE federation; each domain is a separate team in real deployments |
| **Heavy structured data** — documents, custodians, matters, productions, privilege logs | Tools + widgets get serious workout; tool count quickly hits 50+ per matter |
| **Multi-step workflows** — "find emails between A and B about project X, redact PII, produce as TIFF with Bates 1000–9999" | Multi-agent orchestration: a coordinator delegates to domain specialists |
| **Regulatory requirements** — chain of custody, audit trail, defensibility | Exercises ThreadStateStore, telemetry, structured logging, the production-deployment cookbook |
| **Real enterprise scale** — millions of documents per matter | Stress-tests federation prefetch + per-turn tool filtering |
| **Analyst workflows outside the chat** — privilege review in a desktop tool, dashboarding | Natural fit for MCP server-side: paralegals using Claude Desktop / Cursor + the same `ToolDef`s |
| **Multiple personas** — paralegal, associate, lead counsel, vendor, opposing-party reviewer | Validates the permission-scope direction (Tier 1.6 candidate from `registries-vs-industry.md`) |
| **Visual document review** — side-by-side native vs image, redaction overlays, threading | Validates rich generative UI — beyond a card, full document viewers |

## Scope of this plan

This is a planning document only. It defines:

1. The product surface (workflows, personas, entities)
2. The architecture (which library features each piece exercises)
3. The phased implementation roadmap (eight phases over an estimated 5–7 weeks for one contributor)
4. Per-phase acceptance criteria
5. Risks and the production-grade boundary

It does **not** start implementation. After review and acceptance, an ADR-007 (or per-phase ADR series) will codify any decisions that diverge from existing library shape.

## Product surface

### Personas

| Persona | What they do | Tools they care about |
|---|---|---|
| **Paralegal** | Initial document review, tagging, privilege flagging | Document search, tag application, redaction-mark-up |
| **Associate (junior counsel)** | Privilege review, deeper coding, draft productions | Bulk tag, privilege log management, production preview |
| **Lead counsel** | Strategic decisions, sign-off on productions, dashboarding | Reports, status overviews, compliance proofs |
| **Litigation-support engineer** | Custodian intake, processing, technical setup | Custodian onboarding, data-source health, processing queue |
| **Vendor reviewer** (external) | Same as paralegal but scoped to assigned doc set | Same tools, scoped data — exercises permission boundaries |

### Core entities

```ts
interface Matter {
  id: string;                    // 'M-2026-0042'
  name: string;                  // 'In re Acme Corp Securities Litigation'
  client: string;
  partnerInCharge: string;
  status: 'active' | 'closed' | 'on-hold';
  numberRange: string;           // 'ACME-0000001 to ACME-9999999' (Bates ranges reserved)
  createdAt: string;
}

interface Custodian {
  id: string;                    // 'CUST-4321'
  matterId: string;
  name: string;
  email: string;
  department: string;
  hasLegalHold: boolean;
  collectionStatus: 'pending' | 'in-progress' | 'complete';
  documentCount: number;
}

interface Document {
  id: string;                    // 'DOC-7891234'
  matterId: string;
  custodianId: string;
  bates?: string;                // 'ACME-0001234' once produced
  fileName: string;
  fileType: string;
  fileSize: number;
  hash: string;                  // sha256 (chain of custody)
  authoredBy?: string;
  authoredAt?: string;
  modifiedAt?: string;
  contentSnippet: string;        // first 500 chars
  tags: ReadonlyArray<string>;   // 'responsive', 'privileged', 'hot', 'redact'
  privilegeReason?: string;      // 'attorney-client', 'work-product'
  redactions: ReadonlyArray<RedactionSpan>;
  productionSet?: string;
}

interface RedactionSpan {
  page: number;
  bbox: [number, number, number, number];   // x,y,w,h
  reason: 'pii' | 'privilege' | 'confidential';
  appliedBy: string;
  appliedAt: string;
}

interface ProductionSet {
  id: string;                    // 'PROD-001'
  matterId: string;
  name: string;
  format: 'native' | 'tiff' | 'pdf' | 'load-file';
  batesPattern: string;          // 'ACME-{seq:07d}'
  documents: ReadonlyArray<string>;     // doc ids
  status: 'draft' | 'review' | 'finalized' | 'delivered';
  createdAt: string;
  finalisedAt?: string;
}

interface LegalHold {
  id: string;
  matterId: string;
  custodianIds: ReadonlyArray<string>;
  scope: string;                 // 'all email and documents pertaining to Project X'
  issuedAt: string;
  acknowledgedAt?: string;
  releasedAt?: string;
}

interface AuditEvent {
  id: string;
  matterId: string;
  actor: string;                 // user / agent identifier
  action: string;                // 'document.tag', 'production.finalise', etc.
  target: { type: string; id: string };
  before?: unknown;              // for diffable changes
  after?: unknown;
  reason?: string;               // user-provided justification (compliance)
  timestamp: string;
}
```

### Workflows the agent helps with

| Workflow | Sample prompt | Tools / actions invoked |
|---|---|---|
| **Custodian intake** | *"Add Sarah Chen from Engineering as a custodian on the Acme matter and place her under legal hold"* | `addCustodian`, `placeLegalHold` |
| **Targeted search** | *"Find all emails between Sarah Chen and the CFO about Project Phoenix between Jan and March 2025"* | `semanticSearch`, `filterByDateRange`, `filterByCustodians` |
| **Privilege review** | *"Flag all documents that look attorney-client privileged based on the privilege patterns we set up"* | `runPrivilegeReview`, `markPrivileged`, `addToPrivilegeLog` |
| **Redaction** | *"Redact all SSNs and dates of birth from the responsive set"* | `runRedactionPattern`, `applyRedaction` |
| **Production assembly** | *"Create a production set called PROD-002 with all responsive non-privileged documents from January using TIFF format and Bates pattern ACME-{seq:07d}"* | `createProductionSet`, `assignBatesNumbers`, `exportProductionSet` |
| **Compliance reporting** | *"Generate the chain-of-custody report for the production we delivered yesterday"* | `generateChainOfCustodyReport`, `dataSourceQuery('audit_log')` |
| **Legal hold tracking** | *"Show me which custodians haven't acknowledged their legal hold notice"* | `listLegalHolds`, `filterByAcknowledged` |
| **Dashboarding** | *"What's the status of the Acme matter? How many docs reviewed, productions in flight, holds pending?"* | `matterSnapshot` (uses several DataSources) |

## Architecture

### Topology

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  demo-ediscovery-shell  (host, port 4300)                                         │
│   <mvk-chat-shell>  ·  matter-coordinator agent  ·  4-pane review layout          │
│   • discovers + loads remotes via MfeRegistryClient                               │
│   • prefetchCapabilities for tool-budget at 100+ tools/matter                     │
│   • provideToolFilter(keywordToolFilter({maxTools:12}))                           │
│   • permission scopes (paralegal / associate / lead / engineer)                   │
└──────┬─────────────────┬─────────────────┬─────────────────┬─────────────────────┘
       │                 │                 │                 │
   ┌───▼────────────┐ ┌──▼─────────────┐ ┌─▼────────────┐ ┌──▼─────────────┐
   │  collection    │ │  review        │ │  production  │ │  search        │
   │  remote :4301  │ │  remote :4302  │ │  remote :4303│ │  remote :4304  │
   │                │ │                │ │              │ │                │
   │  tools:        │ │  tools:        │ │  tools:      │ │  tools:        │
   │  addCustodian  │ │  searchDocs    │ │  createProd  │ │  semanticSrch  │
   │  placeLegalHld │ │  tagDocument   │ │  redactDoc   │ │  filterByDate  │
   │  releaseHold   │ │  markPrivlgd   │ │  assignBates │ │  TAR-classify  │
   │  custodian-    │ │  applyTag      │ │  exportProd  │ │  histogram     │
   │  intake form   │ │  document-     │ │              │ │                │
   │                │ │  preview widget│ │  bates-rules │ │  dataSource:   │
   │  widgets:      │ │  redaction-    │ │  validation  │ │  documentIndex │
   │  custodianCard │ │  editor widget │ │              │ │  embedding     │
   │  holdCard      │ │  reviewProgress│ │  widgets:    │ │                │
   │                │ │                │ │  prodConfig  │ │                │
   │  forms:        │ │  actions:      │ │  batesPreview│ │                │
   │  custodianForm │ │  openDocument  │ │              │ │                │
   │  holdNotice    │ │  applyTag      │ │  forms:      │ │                │
   │                │ │                │ │  productionF │ │                │
   └────────────────┘ └────────────────┘ └──────────────┘ └────────────────┘
       │                 │                 │                 │
       └────────────┬────┴─────────────────┴─────────┬───────┘
                    │                                │
   ┌────────────────▼───────────────────┐ ┌──────────▼────────────────────────────┐
   │  demo-ediscovery-server  :4311      │ │  demo-ediscovery-mcp                  │
   │  /agents/matter-coordinator/run     │ │  (separate MCP server for Claude     │
   │                                     │ │   Desktop / Cursor — exposes review  │
   │  matter-coordinator (orchestrator)  │ │   tools to analyst workstations)     │
   │  ├─ collection-specialist           │ │                                       │
   │  ├─ review-specialist               │ │  Mounted as MCP server in:           │
   │  ├─ production-specialist           │ │   ~/Library/Application Support/     │
   │  └─ search-specialist               │ │   Claude/claude_desktop_config.json  │
   │                                     │ │                                       │
   │  Per-matter ThreadStateStore        │ │  Same tool definitions as the shell. │
   │  (Redis or sqlite for the demo)     │ │  Single source of truth.             │
   │                                     │ │                                       │
   │  Audit-log telemetry sink           │ │                                       │
   └─────────────────────────────────────┘ └───────────────────────────────────────┘
```

### Library features each piece exercises

| Feature | Where it shows up |
|---|---|
| **All 13 registries** | Tool/Component (every remote), Capability/Backend/MFE (federation), Action (openDocument navigation, applyTag, applyRedaction), Intent (pre-LLM routing for "show me this matter"), Form (custodian intake, production config, hold notice), DataSource (documentIndex via REST, audit log, custodian directory), Validation (Bates pattern conformance, privilege markers), Persistence (review session state, draft productions), Layout (split-pane document viewer), SchemaTransformer (load-file ↔ document model) |
| **Conflict policies** | `'namespace'` policy on host's `ToolRegistry` — multiple teams may register `tagDocument` (review remote) vs `legacy.tagDocument` (legacy-review remote during cutover); both coexist |
| **`onDispose` lifecycle** | Review session cleanup: when the user navigates away from a document, the review remote's tool dispose hook releases the document lock (chain-of-custody requirement) |
| **Tool filter** | At 100+ tools per matter, `keywordToolFilter({maxTools: 12})` keeps the LLM context bounded; reference impl is enough for the demo |
| **`prefetchCapabilities`** | Host loads only tool *names* at boot from each remote's `capabilities.json`. Bundle hydrates lazily when the user actually invokes a domain |
| **`ThreadStateStore`** | Per-matter sticky-routing state externalised. Demo uses an in-memory adapter; cookbook entry shows the Redis/Postgres path for a real deployment |
| **Telemetry sink** | Every tool call emits a structured event the audit log consumes. The cookbook entry shows wiring to OTel + Langfuse |
| **MCP server-side adapter** | A separate `demo-ediscovery-mcp` Node binary exposes the review tools to Claude Desktop / Cursor / Zed. Paralegals can run privilege review from their analyst workstations without opening the web app |
| **MCP UI** (`html` field) | Document preview cards rendered as styled HTML for MCP UI hosts |
| **`createSpecialist` + `registerSpecialists`** | Wires four domain specialists under the coordinator |

### Persona-scoped permissions

This is the one library *gap* the example will hit head-on: we don't yet ship permission scopes (it's listed in [`registries-vs-industry.md`](../architecture/registries-vs-industry.md) as a Tier 1.6 governance hook). The eDiscovery demo is the natural place to actually need them — a vendor reviewer must NOT see the `releaseLegalHold` tool, even if it's registered.

The plan handles this two-step:

1. **Phase 0–7** ship the demo with a *manual* permission shim — a `provideToolFilter` decorator that drops tools the current user's role doesn't allow. Works today; clear escape valve.
2. **Phase 8 (optional)** ships the actual `RegistryEntry.scopes` field + policy hook on `RegistryBase` per the architecture doc, validated against the demo's exercise. This phase has higher uncertainty and is split out so it doesn't block earlier phases.

## Phased implementation plan

Eight phases. Each phase is independently shippable — the demo works end-to-end at the end of every phase, just with progressively more capability.

### Phase 0 — Foundation (~3 days) ✅ shipped

Domain models, mock data, agent server skeleton.

- [x] `examples/demo-ediscovery-shared/` — framework-agnostic package with the entity types (`Matter`, `Custodian`, `Document`, etc.) + a small mock data layer (~200 sample documents, 5 custodians, 1 active matter)
- [x] `examples/demo-ediscovery-server/` — Hono server, single `EchoAgent` ("not yet implemented") agent at `/agents/coordinator/run`, structured logging, `/health`
- [x] `examples/demo-ediscovery-shell/` — Angular host with `<mvk-chat-shell>`, dual-pane layout (chat sidebar + matter dashboard), points at `/agents/coordinator/run`
- [x] `angular.json` entries; CI prod-build

**Acceptance** ✅: shell loads on port 4300, dashboard shows the sample matter with custodians and document count, chat returns echo replies. No tools yet. Build green.

### Phase 1 — Coordinator + collection specialist (~4 days) ✅ shipped

First specialist with real tools. No federation yet — collection tools registered inline in the host.

- [x] `demo-ediscovery-server/`:
  - `coordinator-agent.ts` — `OrchestratorAgent` with one specialist
  - `collection-specialist` — `GeminiAgent` with prompt focused on custodian/legal-hold flows
  - Per-matter `ThreadStateStore` (in-memory, demonstrates the abstraction)
- [x] `demo-ediscovery-shell/` agentic config:
  - `addCustodianTool`, `listCustodiansTool`, `placeLegalHoldTool`, `releaseLegalHoldTool`, `acknowledgeLegalHoldTool` (5 tools — added `acknowledge` for the lifecycle)
  - `custodianCard`, `legalHoldCard` widgets
  - `custodianIntakeForm` — schema-driven form via `<mvk-form-renderer>` for richer onboarding
- [x] Sample prompts: *"Add Sarah Chen as a custodian"*, *"Place a legal hold on her"*, *"Show me the hold status"*

**Acceptance** ✅: prompts above work end-to-end. Custodian appears in dashboard. Legal hold renders as a status card. Tested against Gemini.

### Phase 2 — Federate review remote (~5 days) ✅ shipped

Extract review tools to their own MFE remote. Validates federation at the eDiscovery scale.

- [x] `examples/demo-ediscovery-review/` — Native Federation remote on port 4302
  - `searchDocumentsTool`, `tagDocumentTool`, `markPrivilegedTool`, `addToPrivilegeLogTool`
  - `documentPreviewWidget`, `tagPanelWidget`, `reviewProgressWidget`
  - `openDocumentAction` (deferred to Phase 3 — landed alongside `openProduction` once `/documents/:id` route existed)
  - Standalone UI at :4302 (the "remote is also an app" pattern)
- [x] `demo-ediscovery-server/` — adds `review-specialist` to the coordinator's `subAgents`
- [x] `demo-ediscovery-shell/` — `provideStaticJsonMfeRegistry` discovery; `mfes.json` registers the remote

**Acceptance** ✅: prompts like *"Find all emails between Sarah Chen and the CFO about Project Phoenix"*, *"Tag DOC-1234 as responsive"*, *"Mark DOC-5678 as attorney-client privileged"* work.

### Phase 3 — Federate production remote (~4 days) ✅ shipped

Production assembly is the most workflow-heavy domain. This phase exercises forms, validation, and chained tool calls.

- [x] `examples/demo-ediscovery-production/` — Native Federation remote on port 4303
  - `createProductionSetTool`, `assignBatesNumbersTool`, `redactDocumentTool`, `exportProductionSetTool`
  - `productionConfigForm` — Bates pattern, format selection, scope filter (registered via secondary `./RegisterForm` exposed entry)
  - `redactionEditorWidget` (HTML5 canvas overlay coloured by reason)
  - `batesPreviewWidget`, `productionSummaryWidget`
- [x] `demo-ediscovery-server/` — `production-specialist` added; chained-tool-call patterns ("create the production set, then assign Bates numbers, then export")
- [x] `Validation` exercised — `validateBatesPattern` called pre-register inside `createProductionSet`

**Acceptance** ✅: prompt *"Create production PROD-002 with all responsive non-privileged docs from January, TIFF format, Bates ACME-{seq:07d}"* drives the full chain.

### Phase 4 — Federate search + advanced retrieval (~4 days) ✅ shipped

Tool filtering becomes load-bearing here. Multiple search modalities.

- [x] `examples/demo-ediscovery-search/` — Native Federation remote on port 4304
  - `semanticSearchTool`, `filterByDateRangeTool`, `filterByCustodiansTool`, `runTARClassifierTool`
  - `documentIndex` `DataSourceDef` — registered via secondary `./RegisterDataSource` entry
  - `dateHistogramWidget`, `searchResultPanelWidget`, `tarScoresWidget`
- [x] `demo-ediscovery-server/` — `search-specialist` added; total tool count = 17 (4 specialists × ~4 tools)
- [x] `demo-ediscovery-shell/` — `provideToolFilter(keywordToolFilter({ maxTools: 12, floor: 5 }))` activated

**Acceptance** ✅: prompts like *"Find documents semantically similar to..."*, *"Run TAR classification on the unreviewed set"* work. The filter narrows 17 tools per turn.

### Phase 5 — Compliance + audit trail (~3 days) ✅ shipped

Production-grade defensibility. Every tool call becomes an audit event.

- [x] **Tamper-evident chain hash** — `appendAudit` auto-stamps `chainHash` + `prevHash` on every event. `verifyAuditChain` re-walks the chain. ([`hash.ts`](../../examples/demo-ediscovery-shared/src/hash.ts), [`audit-chain.ts`](../../examples/demo-ediscovery-shared/src/audit-chain.ts))
- [x] `generateChainOfCustodyReport` tool — walks the matter's chain, filters to events touching the production set, audit-logs the report itself
- [x] `chainOfCustodyReport` widget — KPI strip + per-event hash table with click-through to `openX` actions
- [x] Audit Trail page — live integrity badge with three states (verified / broken / empty) + chain head display
- [ ] Cookbook entry — deferred (the `production-deployment.md` already exists; eDiscovery-specific deployment guide is Phase 8 sweep)

**Acceptance** ✅: prompt *"Generate the chain-of-custody report for production PROD-XXX"* returns a verifiable audit trail.

### Phase 6 — MCP server-side for analyst workstations (~3 days) ✅ shipped

Paralegals run their privilege review in Claude Desktop or Cursor without opening the web app.

- [x] `examples/demo-ediscovery-mcp/` — Node-only MCP server using `@maverick/agentic-ui-mcp`
  - 5 tools: `searchDocuments`, `tagDocument`, `markPrivileged`, `addToPrivilegeLog`, `runTARClassifier`
  - All write through shared `appendAudit` — Phase 5's chain covers MCP-driven mutations too
  - `beforeCall` + `afterCall` log to stderr (visible in Claude Desktop's MCP log file)
  - Per-user attribution via `MVK_USER` / `MVK_MATTER` env vars
  - HTML render hints (`text/html;profile=mcp-app`) on three widgets: search results, document detail, TAR scores
- [ ] Cookbook entry — deferred to Phase 8 doc sweep

**Acceptance** ✅: Claude Desktop config snippet works; mounted server shows 5 tools; prompts run the same handlers as the web app, with results rendered as MCP-UI HTML cards.

### Phase 7 — Permission shim (consumer-side) (~2 days) ✅ shipped

A *manual* permission scope implementation using existing primitives, ahead of the library shipping `RegistryEntry.scopes`.

- [x] `demo-ediscovery-shell/` — `personaToolFilter` composed with `keywordToolFilter` via the `TOOL_FILTER` injection token + `useFactory`. Allow-lists for the full 17-tool surface:
  - Lead Counsel — full access (17/17)
  - Associate — review + draft productions (13/17)
  - Paralegal — read + tag + TAR (8/17)
  - Lit-Support — custodians + holds (6/17)
  - Vendor Reviewer — scoped read + tag (4/17)
- [x] Header persona menu — live tool-count badge per role; switching role updates the next agent turn's tool list
- [ ] Cookbook entry — deferred to Phase 8 doc sweep

**Acceptance** ✅: switching role in the dropdown visibly changes the count badge; sensitive ops hidden from non-counsel roles.

### Phase 8 — Library `RegistryEntry.scopes` (optional) (~3 days)

Promote the consumer-side shim into a first-class library feature, validating the architecture in the architecture doc.

- [ ] Add `RegistryEntry.scopes?: readonly string[]` field
- [ ] Add `RegistryBase` policy hook: `setScopePolicy(policy: (entry, scopes) => boolean)` — registry consults the policy on every `register()` and `get()`
- [ ] Migrate `demo-ediscovery-shell/`'s manual filter to the new API
- [ ] Update [`registries-vs-industry.md`](../architecture/registries-vs-industry.md) — move scopes from "gap" to "shipped"
- [ ] ADR-008: permission scopes design + integration with the existing `conflictPolicy` / `onDispose` patterns

**Acceptance**: removes ~40 lines of consumer-side filter logic in `demo-ediscovery-shell/`. All existing tests pass. Documented diff between the consumer-side shim (Phase 7) and the library-side feature.

## Effort estimate summary

| Phase | Description | Effort |
|---|---|---|
| 0 | Foundation: models, mock data, server, shell | 3 days |
| 1 | Coordinator + collection specialist + first tools | 4 days |
| 2 | Federate review remote | 5 days |
| 3 | Federate production remote | 4 days |
| 4 | Federate search + tool filter activation | 4 days |
| 5 | Compliance + audit trail | 3 days |
| 6 | MCP server for analyst workstations | 3 days |
| 7 | Persona-scoped permission shim (consumer-side) | 2 days |
| 8 | (optional) library `RegistryEntry.scopes` | 3 days |
| **Total** | (Phases 0–7) | **28 days ≈ 5–6 weeks** for one contributor |
| (with Phase 8) | | ~7 weeks |

## Production-grade boundary

Same line we drew with the existing demos. The example app is **library-grade demonstrative** — not a deployable eDiscovery product. Specifically what it WILL and WILL NOT include:

| Will include | Will NOT include |
|---|---|
| Full library-feature exercise (all 13 registries, MFE federation, MCP, multi-agent) | A real document storage backend (mock data only — ~1000 sample docs in memory) |
| Production-grade `ThreadStateStore` + telemetry patterns documented | A real legal-hold notification system (no actual emails sent) |
| Audit trail data model + sample report | SOC-2 compliance, regulatory certification |
| Permission scopes (Phase 7 shim, Phase 8 library) | Real authentication / SSO / SAML — `beforeCall` stub auth only |
| MCP integration for analyst workflows | Vendor portal isolation, multi-tenant data residency |
| Cookbook entries on each domain | Performance for >10K documents (mock layer not optimised) |

Stated up-front so consumers know exactly what's library-validation vs what's their own eDiscovery vendor's responsibility.

## Risks

| Risk | Mitigation |
|---|---|
| **Scope creep** — eDiscovery is a deep domain; engineers will want to add features (concept clustering, near-duplicate detection, OCR pipelines) | Phase boundaries are firm. Per-phase acceptance criteria prevent drift. Out-of-scope items go in a `docs/plans/ediscovery-future-work.md` parking lot |
| **Mock data not representative** — 1000 docs may hide real-scale issues | Phase 4 specifically exercises the tool filter at 30+ tools; Phase 5 audit trail exercises at scale-of-actions. Real-document-volume testing is explicitly out of scope (added to risk parking lot for v2) |
| **Library gaps surface** — we may discover the library can't actually express something legitimately needed | This is the *point* of the demo. Each gap becomes either a Tier 1.6+ roadmap item or an ADR. Phase 7's permission shim is already a known example |
| **Compliance ambiguity** — what level of "defensibility" is library-grade? | The chain-of-custody report demonstrates the *pattern*. Real defensibility (court-admissible audit logs) is a vendor-side concern explicitly excluded |
| **MCP UI fidelity** — paralegals doing privilege review need richer document viewers than HTML can sandbox-render | Phase 6 limits MCP UI to summary cards + simple previews; full review still happens in the web app. The cookbook entry documents the rendering ceiling clearly |
| **Phase 8 might not land** — permission scopes touch all 13 registries; the library refactor is non-trivial | Phase 7 (consumer-side shim) is independent and complete on its own. Phase 8 is explicitly optional and time-boxed to 3 days; if it overruns, we ship 0–7 and revisit |

## Cross-references

- [`docs/architecture/registries-vs-industry.md`](../architecture/registries-vs-industry.md) — the governance gaps Phase 7 + 8 address.
- [`ROADMAP.md`](../../ROADMAP.md) — Tier 1 / 2 features the demo exercises.
- [`docs/cookbook/production-deployment.md`](../cookbook/production-deployment.md) — the deployment patterns Phase 5 documents at eDiscovery scale.
- [`docs/cookbook/federation-at-scale.md`](../cookbook/federation-at-scale.md) — the prefetch + tool-filter patterns Phase 4 puts under load.
- [`docs/cookbook/mcp-server.md`](../cookbook/mcp-server.md) — the MCP server pattern Phase 6 reuses.
- [`docs/adr/0006-mcp-server-side-adapter.md`](../adr/0006-mcp-server-side-adapter.md) — the MCP design Phase 6 builds on.

## How to start (concrete next step)

If this plan is accepted:

1. Convert this doc to ADR-007 (or keep as a separate planning doc and add a tracking issue).
2. Begin Phase 0 — scaffold `examples/demo-ediscovery-{shared,server,shell}` per the existing `examples/demo-multi-agent` shape.
3. Open a `[Phase 0]` PR per the same conventions as ADR-006's six-phase delivery.

Each phase's PR includes: source + tests + cookbook entry + CHANGELOG entry. Phase boundaries are designed to be reviewable in isolation; no phase commits to scope decisions in subsequent phases.
