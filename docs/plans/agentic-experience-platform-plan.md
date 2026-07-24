# Agentic Experience Platform (AEP) plan — verified & refined

**Status:** Refined & **implementation in progress** · refinement of an external
"Enterprise Agentic Experience Platform" proposal, re-grounded against the real codebase.
**Date:** 2026-07-24 · **Decider:** sahas

> ## Implementation status (branch `claude/aep-architecture-plan-xisko5`)
>
> The AEP core is built and tested — all six seams landed additively (ADR-010 D4), each with vitest
> coverage; the full agentic-ui suite (1069 tests) and catalog-server suite (215 tests) stay green.
>
> | Seam | Status | Where |
> |---|---|---|
> | **A** Capability dependency graph (`requires`/`produces` + `resolveCapabilityGraph`) | ✅ shipped | `lib/registries/capability-graph.ts` |
> | **B** Prompt/Skill/Knowledge/Memory/Workflow/Navigation registries | ✅ shipped | `lib/registries/*` |
> | **C** Experience Registry (approval-gated) | ✅ shipped | `lib/experience/experience-registry.ts` |
> | **D** Experience Planner + agent-context + `experience` layout source | ✅ shipped | `lib/experience/*` |
> | **F** Catalog `/experiences` API + `010`/`011` migrations | ✅ shipped | `platform/agentic-catalog-server/*` |
> | **E** `agentic-experience-studio` app — experiences (list/create/edit/cytoscape graph/plan/approvals), login+guard, and authoring studios for **every** registry kind (Prompt/Skill/Knowledge/Memory/Workflow/Navigation) + Policy | ✅ shipped | `platform/agentic-experience-studio/*` |
>
> **Remaining (tracked in the app README, both need external infra):** a real OIDC **redirect** flow
> against an identity provider (the login screen accepts a pasted JWT today, matching ops-console), and
> function-of-state workflow branches (the editor covers string/terminal `next`). Ops-console remains
> untouched by design.

> **What this document is.** An external vision (drafted in a general-purpose assistant) proposed
> turning `@infra-tools` into a "Registry-Driven Agentic Experience Platform." This document
> **verifies** that proposal against the actual repository, corrects the factual errors, removes the
> parts already shipped, and **refines** what remains into an additive, ADR-governed program that
> fits the platform's real architecture, vocabulary, and non-goals.
>
> **Companion docs (authoritative — this plan defers to them):**
> [platform-evolution-plan.md](./platform-evolution-plan.md) (v3 three-tier strategy · M1–M8) ·
> [ADR-047 coordination layer](../adr/0047-agentic-ui-coordination-layer.md) (self-serve ↔ agent) ·
> [ADR-046 layered layout engine](../adr/0046-layered-layout-engine.md) ·
> [ADR-044 dashboard registry](../adr/0044-dashboard-registry.md) ·
> [ADR-038 semantic search / pgvector](../adr/0038-catalog-semantic-search-pgvector.md) ·
> [ADR-040 OPA policy](../adr/0040-opa-policy-integration.md) ·
> [registries-vs-industry.md](../architecture/registries-vs-industry.md) ("don't add more registries") ·
> [platform-seams.md](../architecture/platform-seams.md) (the permanent contract surface) ·
> [ediscovery-dynamic-ui-plan.md](./ediscovery-dynamic-ui-plan.md) (F1–F6, shipped through F6).

---

## 0. Verification verdict — the external proposal vs. reality

The proposal is **strategically aligned** with the project's existing direction (registry-first,
AI-native, capability-driven, control-plane tiering) but contains material factual errors and
proposes rebuilding subsystems that already ship. Scorecard:

| # | Proposal claim | Verdict | Reality in this repo |
|---|---|---|---|
| 1 | `@infra-tools` namespace with AG-UI/A2UI/agent runtime/MCP/registries/OPA/OTel/streaming/multi-agent | ✅ **Correct** | 11 published packages under `@infra-tools/*`; runtime is `@infra-tools/agentic-ui` (Angular 21). All named subsystems exist. |
| 2 | "Registry becomes primary source of capabilities; DB never the primary source of UI" | ✅ **Already the design** | 16 registries on a uniform `RegistryBase`; catalog server stores *capability metadata*, never rendered component implementations. |
| 3 | Introduce ~18 registries (Component, Tool, Workflow, Skill, Policy, Prompt, Knowledge, Memory, Experience, Layout, Dashboard, Action, DataProvider, Navigation, Renderer, MCP …) | ⚠️ **Partly redundant** | 16 already exist (Tool, Component, Capability, Backend, MFE, Action, Intent, Form, DataSource, Validation, Persistence, Layout, SchemaTransformer, Approval, Operation, Trigger, Dashboard, Playbook). ADR guidance: **"Don't add more registries — add governance hooks."** Only **6** proposed registries are genuinely new (see §3). |
| 4 | "Registry Graph" with capability→capability dependency edges the planner traverses | ❌ **Does not exist** | `RegistryEntry` has **no** `requires`/`dependsOn`. The only graph is a cytoscape **containment** view in the ops-console (grouping by source, not dependencies), off the runtime bundle. This is a real, net-new gap. |
| 5 | "Experience Planner" producing a unified `ExperiencePlan` (layout+components+forms+tools+policies+workflow) | ❌ **Does not exist** (primitives do) | No unified planner. Planning is delegated to the LLM via `AgentContextProvider.compose()` → agent-emitted `layout-render`/`widget-render` events. `LayoutResolver`, `IntentRegistry`, workflow/playbook factories each own one slice. Genuine gap — but built *on* existing primitives, not greenfield. |
| 6 | "Experience Registry" resolving business intent → capabilities | ❌ **Net-new** (partial substrate) | No Experience concept. `IntentRegistry` is the nearest (naive 1:1 substring router). Legitimately new. |
| 7 | **"Spring Boot backend architecture"** as a deliverable | ❌ **Factually wrong** | There is **zero Java** in the repo. The backend is `agentic-catalog-server`: **Hono + Postgres (RLS) + jose JWT/JWKS + pgvector + optional OPA sidecar**. "Spring Boot" exists only as an *optional client-side* `SpringBootMfeRegistrySource` adapter that consumes an adopter's external Spring registry. Replace this deliverable with "Node/Hono control-plane architecture + Spring Boot adapter parity." |
| 8 | "Semantic capability discovery" as future work | ✅ **Already shipped** | pgvector + `EmbeddingProvider` (openai/cohere/ollama/noop), `GET /v1/catalogs/:tenant/capabilities/search?q=` cosine search (ADR-038). |
| 9 | "Self-serve"/Formly framing (proposal assumes Formly-JSON-in-DB as the baseline) | ⚠️ **Wrong baseline for this repo** | This platform repo has **no Formly** and no DB-form loader. It ships `FormRegistry` + runtime-composed forms (F1, closed-AST `if` DSL). "Self-serve" is existing vocabulary (ADR-047 = "closing the self-serve ↔ agent gap"). This is a verification note only — **no Self-Serve migration is in scope for this plan.** |
| 10 | Dynamic dashboards, dynamic forms, user preferences separated from registry metadata | ✅ **Largely shipped** | `DashboardRegistry` + conversational/live/drillable dashboards (ADR-044); F1 composable forms; layered preference tiers (`user-saved`/`matter-default`/`org-default`) in `LayeredLayoutStore` (ADR-046). |
| 11 | "Platform Studio" admin app (Registry Explorer, Experience/Prompt/Policy/Dashboard/Navigation Studio, Marketplace, Telemetry, Audit, Governance, Publishing) | ⚠️ **New app — kept out of ops-console** | `agentic-ops-console` ships topology, editors, realtime, audit — but it is **intentionally left untouched** here: it still needs to mature to enterprise grade and its UX needs rework, so we do **not** pile authoring surfaces onto it. The Studio/authoring surfaces land in a **new dedicated app** (`platform/agentic-experience-studio`), purpose-built for enterprise UX. |
| 12 | Governance separation (registries dev-owned, experiences business-owned, prefs user-owned, data app-owned) | ✅ **Endorse** | Consistent with `owner`/`lifecycle`/`scopes` metadata + scope-policy gate + TSC governance model. Formalize, don't rebuild. |
| 13 | Enterprise reqs: multi-tenant, MCP, A2A, OTel, OpenFeature, OPA, RBAC/ABAC, audit, streaming, caching, HA, versioning | ✅ **Mostly shipped/planned** | Multi-tenant RLS, MCP (3 sides), OTel sink, OPA (ADR-040), audit hash-chain, SSE streaming, `TileResultCache`, semver gating all exist. A2A + OpenFeature are Tier 3 "wait-and-see" in ROADMAP — keep them there. |

**Net:** ~65% of the proposal is already built or explicitly planned. The valuable, genuinely-new core
is **four seams**: (1) a **capability dependency graph**, (2) an **Experience Registry**, (3) an
**Experience Planner** over existing primitives, and (4) a small set of **new capability registries**
(Prompt, Skill, Knowledge, Memory, Workflow-as-registry, Navigation). Everything else is *governance
and studio surfacing* (in a new dedicated app, not ops-console) on top of shipped infrastructure. The proposal's biggest risk is
**greenfield framing** — it would have teams rebuild `LayoutResolver`, `DashboardRegistry`,
`FormRegistry`, and the catalog server. This plan forbids that.

### Non-negotiable constraints the refinement inherits

- **ADR-010 D4 — zero breaking changes through v1.x.** Every item here is additive: new optional
  registries, new `provideX` factories, new opt-in `RegistryEntry` fields. No existing seam changes shape.
- **Runtime non-goals** (platform-evolution-plan): **no Temporal / NATS / OPA / OpenSearch inside the
  runtime tier.** OPA stays a sidecar the *control plane* calls; the runtime never embeds it.
- **P1 embedded-first.** The default adopter wires three `provideX` calls and needs no server. Every
  new capability must degrade to in-memory with zero external deps.
- **Bundle budget.** Runtime FESM is capped (~720 KB, low headroom). Graph/planner heavy code lands in
  the **control plane / the new experience-studio app**, not the runtime bundle (cytoscape-off-the-runtime precedent, ADR-037).
- **Governance gate.** New public API / new registry shape = RFC + 7-day comment + TSC vote
  (GOVERNANCE.md). This document is the pre-RFC; each numbered seam below becomes its own RFC.

---

## 1. Refined vision

**Evolve `@infra-tools` from "a library an LLM can drive" into an Agentic Experience Platform where a
planner composes complete enterprise experiences at runtime from registry capabilities — additively,
on the primitives already shipped.**

The proposal's vision statement is retained almost verbatim because it matches the project's own
"post-chat surfaces" trajectory (the agent "escaped the chat rail" — P0–P5, already shipped). The
refinement changes *how* we get there: not a new platform, but **three additive seams** layered onto the
existing three tiers (runtime / control plane / ecosystem) from platform-evolution-plan.

The AI-native framing is correct and already partially real: the agent emits `layout-render` /
`widget-render` events rather than "load form 123." The gap is that this reasoning is **fully delegated
to the LLM prompt** today; the Experience Planner adds a **deterministic, auditable, testable** layer
between goal and render.

---

## 2. Where the vision already lives (so we don't rebuild it)

| Vision pillar | Already shipped | Reference |
|---|---|---|
| Registry-first, capability-driven | 16 registries, uniform `RegistryBase`, metadata backbone (`source`/`scopes`/`tags`/`owner`/`lifecycle`/`requiredHostVersion`) | `registries/registry-base.ts`, `types/registry-defs.ts:17` |
| Generative UI at runtime | `widget-render` events + `{components:[{name,props}]}` tool-result convention → `ComponentRegistry` + `*ngComponentOutlet` | `chat/run-orchestrator.ts:528` |
| Dynamic layout / workspaces | `LayoutResolver` 11-source precedence merge; `<mvk-workspace-layout>` slot composition | ADR-046, `layout/resolver/` |
| Dynamic dashboards | `DashboardRegistry`, conversational/live/drillable tiles, `TileResultCache` | ADR-044 |
| Dynamic forms | `agenticForm({composition})` + closed-AST `if` DSL (F1) | `factories/agentic-form.ts`, `composition/` |
| Workflows / wizards | `agenticWorkflow()` step graphs; `PlaybookRegistry` versioned tool-call sequences | `factories/agentic-workflow.ts`, ADR-045 |
| Approvals / review / case surfaces | `ApprovalRegistry` (HITL), `<mvk-review-queue>`, `<mvk-timeline-canvas>`, `<mvk-cal-workbench>` | F4, ADR-009 |
| Search / copilots / investigations | eDiscovery flagship: search/review/production MFEs + orchestrator + specialists | `examples/demo-ediscovery-*` |
| Semantic capability discovery | pgvector + multi-provider embeddings; `/capabilities/search` | ADR-038 |
| Multi-tenant control plane | `agentic-catalog-server` (Hono + Postgres RLS + JWT + OPA + usage meter + audit chain) | `platform/agentic-catalog-server/` |
| User preferences separated from metadata | Layered tiers `user-saved`/`matter-default`/`org-default`/`agent` in `LayeredLayoutStore` | ADR-046 D2/D3 |
| Governance metadata + scope gate | `setScopePolicy`, `owner`, `lifecycle`, catalog authorizer deny-list | ADR-008, platform-seams.md |
| MCP (consumer/server/WebMCP) + external surfaces | 3-sided MCP, Teams, Copilot Studio | ADR-049/050, 041/042 |

**Consequence:** the AEP program is ~6 new seams + a new dedicated authoring app, **not** 30
greenfield deliverables.

---

## 3. Genuinely-new work (the AEP core)

Six seams, each additive, each its own RFC. Ordered by dependency.

### 3.1 — Seam A: Capability dependency graph (`requires` metadata + resolver)

The single biggest missing primitive. Today `RegistryEntry` carries no dependency channel and there is
no traversal. Add:

```ts
// types/registry-defs.ts — additive fields on RegistryEntry (all optional)
export interface CapabilityRequirement {
  readonly kind: 'tool' | 'component' | 'form' | 'dataSource' | 'capability'
    | 'prompt' | 'skill' | 'knowledge' | 'policy' | string;
  readonly name?: string;            // exact capability, or…
  readonly tag?: string;             // …any capability carrying this tag (late binding)
  readonly optional?: boolean;       // graph traversal continues if unmet
  readonly reason?: string;          // audit/explanation string
}

export interface RegistryEntry {
  // …existing fields unchanged…
  readonly requires?: readonly CapabilityRequirement[];  // NEW — omit = leaf (today's behavior)
  readonly produces?: readonly string[];                 // NEW — semantic outputs (e.g. 'conflict-status')
}
```

- **Resolver** ships in the runtime as a *pure function* (no cytoscape, bundle-safe):
  `resolveCapabilityGraph(root: RegistryEntry, registries: RegistrySet): CapabilityGraph` — a DAG of
  `{ nodes, edges, unmet, cycles }`. Late binding via `tag` matches the proposal's
  "multiple implementations of the same capability."
- **Visualization** (dependency edges, not just containment) lands in the **new dedicated
  experience-studio app** (§3.5), which renders `source→target` edges from `requires`. Off the runtime
  bundle. (Ops-console keeps its own separate containment/topology view; it is not modified. The
  `buildGraphElements` shape can be reused as prior art, but no ops-console code changes here.)
- **Backwards compatible:** entries without `requires` are leaves — identical to today.
- **Governance:** conflict/cycle detection reuses the existing `conflictPolicy` machinery on `RegistryBase`.

This is the substrate for the proposal's "planner traverses the graph instead of loading static workflows."

### 3.2 — Seam B: New capability registries (only the ones that don't exist)

Per registries-vs-industry.md, we add registries **only** where the concept has no home. Adding all of
these still keeps us within the "mature plugin platform" band (VS Code has 50+). Each is a trivial
`RegistryBase<TDef>` subclass — the cost is the `TDef` shape + cookbook, not new machinery.

| New registry | Why it's genuinely new | Notes |
|---|---|---|
| **PromptRegistry** | Prompts are inline strings today; no versioned/approval-gated prompt catalog | Reuse template approval state machine (`draft→review→approved`) from `TemplateRegistryBase`. Powers "Prompt Studio." |
| **SkillRegistry** | No first-class "skill" (a named, reusable reasoning+tool bundle) | A skill = `{ tools[], prompt, requires[] }`. Distinct from Playbook (deterministic sequence) — a skill is agent-selectable. |
| **KnowledgeRegistry** | No knowledge-source catalog (RAG corpora, doc stores) | Metadata only (name, kind, connector, scopes). Retrieval stays adapter-side; no OpenSearch in runtime. |
| **MemoryRegistry** | Already on ROADMAP Tier 1.4 ("Long-term memory registry") | Adopt the roadmap design directly; don't invent a parallel one. |
| **WorkflowRegistry** | `WorkflowDef` + `agenticWorkflow()` exist but there's **no registry** for them (they synthesize `FormDef`s) | Promote workflow to a first-class registered, versioned, discoverable capability. |
| **NavigationRegistry** | Navigation is app-hardcoded; no capability-driven nav | Enables MFEs to contribute nav entries (proposal requirement) + "Navigation Studio." |

**Explicitly NOT added** (already covered — adding them would violate ADR guidance):
Component, Tool, Dashboard, Layout, Action, Intent, Form, DataSource (= "DataProvider"), Persistence,
Approval, Operation, Trigger, Playbook, SchemaTransformer, Capability, Backend, MFE.

**Policy "registry":** policy stays where it is — OPA bundles server-side (ADR-040) + `ApprovalRegistry`
+ scope policies + `LayoutPolicy`. We do **not** add an in-runtime PolicyRegistry (would pull policy
evaluation into the bundle; violates the no-OPA-in-runtime non-goal). "Policy Studio" edits OPA bundles
via the catalog `/policy/bundles` API.

**Renderer "registry":** not added. Rendering is already `ComponentRegistry` + `LayoutRegistry` +
backend adapters + `mcp-ui` inbound rendering (ADR-049). A separate RendererRegistry is redundant.

**MCP "registry":** not added as a runtime registry. MCP servers are catalogued as `agents` in the
control plane (migration `007_agents.sql`, kind includes `mcp`) and consumed via the existing MCP bridge.

### 3.3 — Seam C: Experience Registry

An **Experience** is business intent decoupled from implementation (proposal's core idea, endorsed).

```ts
export interface ExperienceDef extends RegistryEntry {
  readonly id: string;                         // 'legal-intake', 'vendor-onboarding'
  readonly title: string;
  readonly goal: string;                       // NL goal the planner reasons over
  readonly intents?: readonly string[];        // IntentRegistry ids that trigger it
  readonly requires: readonly CapabilityRequirement[];  // uses Seam A
  readonly defaultLayout?: string;             // LayoutTemplate name (optional seed)
  readonly policies?: readonly string[];       // OPA rule paths / approval policy ids
  readonly personas?: readonly string[];       // scope gate
  readonly version: string;                    // semver; reuse template version chains
}
```

`ExperienceRegistry extends RegistryBase<ExperienceDef>`. Approval-gated (reuse
`TemplateRegistryBase`). This is what "Experience Studio" composes and what the Planner consumes.

### 3.4 — Seam D: Experience Planner

The orchestrating layer the proposal wants — but **hybrid**, not a replacement for the LLM. Two modes:

1. **Deterministic pre-plan** (new): `ExperiencePlanner.plan(input): ExperiencePlan`. Pure, testable,
   auditable. Resolves an `ExperienceDef` (or a matched intent) through the Seam-A graph into a
   concrete bundle, evaluates scope/policy gates, seeds a layout.
2. **LLM refinement** (existing): the plan is serialized into the `AgentContextProvider` XML block; the
   LLM personalizes/streams via today's `layout-render`/`widget-render` events. Nothing about the
   current run-loop changes.

```ts
export interface ExperiencePlanInput {
  goal: string; intent?: string;
  user: { id: string; persona: string; permissions: readonly string[] };
  context: Record<string, unknown>;            // route, selection, matter, conversation
  registries: RegistrySet;
}
export interface ExperiencePlan {
  experienceId: string;
  layout: SlotMap;                             // seeds LayoutResolver at 'experience' source
  components: readonly string[];
  forms: readonly string[];
  tools: readonly string[];                    // narrows the per-turn TOOL_FILTER
  policies: readonly string[];
  workflow?: string;
  prompts: readonly string[];
  unmet: readonly CapabilityRequirement[];     // gaps surfaced, not hidden
  rationale: readonly AppliedRule[];           // audit: why each choice
}
```

- **Integration:** the plan's `layout` enters `LayoutResolver` as a **new precedence source**
  `'experience'` (weight between `agent`=1000 and `user-saved`) — additive to the 11-source ladder, no
  change to existing weights. The plan's `tools` feed the existing `TOOL_FILTER` seam. The plan's XML
  goes through `AgentContextProvider` via a new `ExperiencePlanContextContributor`.
- **Determinism + audit:** `rationale` reuses `AppliedRule`/`LayoutAuditTracker` shape so the whole plan
  is replayable in the audit chain. This is the enterprise-grade differentiator over "LLM emits a layout."
- **Bundle:** planner core is small (traversal + filtering). Heavy semantic matching (embedding the goal
  to rank experiences) calls the **existing** catalog `/capabilities/search` endpoint — no new runtime deps.

### 3.5 — Seam E: Experience Studio (new dedicated app — **not** ops-console)

Ship a **new dedicated authoring app**, `platform/agentic-experience-studio`, purpose-built for
enterprise-grade UX. It is the single home for all authoring/Studio surfaces:

- **Experience Studio** — compose `ExperienceDef`s from registry capabilities, preview the resolved
  capability graph (Seam A dependency-edge viz), dry-run the planner, route through the approval state
  machine.
- **Prompt / Skill / Navigation authoring** — CRUD over the new registries (§3.2) via the catalog API.
- **Policy authoring** — edit OPA bundles through the existing catalog `/policy/bundles` API (no OPA in
  the client bundle).

**Ops-console (`agentic-ops-console`) is deliberately left untouched by this plan.** It still needs to
mature to enterprise grade and its UX needs rework, so we do not build new authoring load onto it. It
keeps its existing role (topology, realtime, audit) and evolves on its own track. The new studio app is
independent: it talks to the same catalog server over HTTP/SSE and reuses no ops-console code (it may
borrow patterns as prior art, but changes nothing there).

### 3.6 — Seam F: Persistence & API for Experiences (control plane)

Add to `agentic-catalog-server` (Hono + Postgres, following the exact existing pattern):

- Migration `010_experiences.sql` — `experiences` table (tenant-scoped, RLS, same shape as
  `capabilities`: id/tenant_id/body JSONB/lifecycle/owner/tags/version/soft_deleted_at).
- Routes `/v1/catalogs/:tenant/experiences` — GET list, GET/POST/PATCH/DELETE, `POST /:id/plan`
  (server-side dry-run), reusing `bearerAuth` + `requireTenantScope` + `withTenantScope` (RLS) +
  `catalog_audit` append + `publishCatalogEvent`. Prompts/skills/knowledge/memory catalogued as
  additional `capabilities.kind` values — **no new tables** for those (they're capability metadata).

---

## 4. The 30 requested deliverables — refined & mapped

Each proposal deliverable, corrected to the real codebase. "Ship" = build; "Reuse" = already exists;
"Correct" = proposal was wrong.

1. **Platform vision** — Reuse §1 here + platform-evolution-plan §1. Not greenfield.
2. **High-level architecture** — Reuse the three-tier model (runtime / control plane / ecosystem). AEP
   adds Seams A–F, no fourth tier.
3. **Registry architecture** — Reuse `RegistryBase`. Add 6 registries (§3.2) + `requires`/`produces`
   metadata (§3.1). Do **not** add the 12 that exist.
4. **Registry Graph** — **Ship Seam A** (dependency edges + resolver in runtime; viz in the new studio app). Genuine gap.
5. **Experience Registry** — **Ship Seam C.** Genuine gap.
6. **Planner architecture** — **Ship Seam D** (hybrid deterministic + LLM). Genuine gap.
7. **AG-UI runtime evolution** — Additive: `'experience'` layout source, `ExperiencePlanContextContributor`,
   plan-narrowed `TOOL_FILTER`. Run-loop (`runUntilSettled`) unchanged.
8. **A2UI runtime evolution** — Reuse existing A2UI backend + `mcp-ui` inbound rendering (ADR-049). Add
   an A2UI mapping for `ExperiencePlan` → component tree. No rewrite.
9. **Experience Studio** — **Ship Seam E** as a **new dedicated app** (`platform/agentic-experience-studio`).
   Ops-console is untouched.
10. **Platform Studio** — the **new dedicated authoring app** hosts all Studio modules
    (Experience/Prompt/Policy/Navigation + graph viz). Ops-console (topology/audit/realtime) stays a
    **separate, unchanged** app that matures on its own track — we do not add authoring tabs to it.
11. **Dynamic dashboards** — **Reuse** `DashboardRegistry` (ADR-044). Wire dashboards as planner outputs.
12. **Dynamic forms** — **Reuse** F1 composable forms + `FormRegistry`. Reusable blocks already the model.
13. **User preference architecture** — **Reuse** `LayeredLayoutStore` tiers + `PersistenceRegistry`
    adapters (memory/web/indexedDb/http). Formalize a `PreferenceStore` facade over existing tiers.
14. **Registry governance** — Reuse `owner`/`lifecycle`/`scopes` + scope policy + TSC/RFC model.
    Formalize the four-ownership split (registries=dev, experiences=business, prefs=user, data=app) in an ADR.
15. **Plugin architecture** — **Reuse** `defineCapabilityModule` + `loadRemoteCapabilities` + conflict
    policies + `onDispose` + activation events (registries-vs-industry.md ordering).
16. **Microfrontend integration** — **Reuse** Native/Module Federation. Add: MFEs contribute
    Experiences/Prompts/Skills/Nav via the extended `CapabilityManifest.exposes` (add `experiences`,
    `prompts`, `skills`, `knowledge`, `navigation` string-lists — additive).
17. **MCP integration** — **Reuse** 3-sided MCP (ADR-049/050). MCP servers catalogued as `agents`.
18. **AI planning model** — Seam D §3.4. Deterministic pre-plan + LLM refinement + semantic ranking via
    existing pgvector search. Fully auditable via `rationale`.
19. **Package structure** — §5 below. Mostly existing packages; 1 optional new package.
20. **APIs** — §6. Hono routes (existing pattern) + client `provideX` factories. **Not Spring Boot.**
21. **TypeScript interfaces** — §3 shows the real additive shapes on the real `RegistryEntry`.
22. **~~Spring Boot backend~~ → Control-plane backend** — **Correct.** Node/Hono + Postgres(RLS) + JWT +
    pgvector + OPA sidecar. Spring Boot only as the optional external MFE-registry adapter (parity per
    ADR-048). §7.
23. **Angular architecture** — Reuse Angular 21 standalone + signals + DI seams (platform-seams.md).
    Planner/Experience providers follow the `provideX` convention. §8.
24. **Persistence model** — §9. Extend existing migrations (`010_experiences.sql`); prefs in layered
    tiers; capability metadata (prompts/skills/knowledge/memory) as `capabilities.kind` rows.
25. **Security model** — Reuse JWT/JWKS + RLS + scope policy + OPA + audit hash-chain + RBAC (role
    mappings) / ABAC (OPA input). §10.
26. **Performance** — Reuse `TileResultCache`, `computed()` resolver, capability prefetch, activation
    events, SSE fan-out via pg LISTEN/NOTIFY. Planner memoized per (goal, persona, context-hash). §11.
27. **Caching strategy** — §11. Plan cache (control plane, TTL + capability-version invalidation),
    embedding cache, tile cache (existing), CDN for MFE manifests.
28. **Versioning strategy** — Reuse `requiredHostVersion` semver gate + template/dashboard/playbook
    version chains (`parentVersion`). Experiences reuse the same chain. §12.
29. **~~Migration from Self Serve~~** — **Out of scope.** Removed at the platform owner's direction.
    This platform repo has no Formly/DB-form baseline to migrate; any Self-Serve migration is a concern
    of a downstream enterprise app and is not part of this plan.
30. **Future roadmap** — §13. Slots into platform-evolution-plan M-milestones; A2A/OpenFeature stay Tier 3.

---

## 5. Package structure under `@infra-tools`

**No package explosion.** New capabilities land in the **existing** `@infra-tools/agentic-ui` runtime
(they're small registry subclasses + providers). One optional new package only if the planner grows heavy:

```
@infra-tools/agentic-ui                 # runtime — ADD: ExperienceRegistry, PromptRegistry,
                                        #   SkillRegistry, KnowledgeRegistry, MemoryRegistry,
                                        #   WorkflowRegistry, NavigationRegistry, capability graph
                                        #   resolver, ExperiencePlanner core, provideExperiencePlatform()
@infra-tools/agentic-ui-server          # ADD: server-side experience plan handler (optional)
platform/agentic-catalog-server         # ADD: /experiences routes + 010_experiences.sql (Hono)
platform/agentic-experience-studio      # NEW app — Experience/Prompt/Policy/Navigation authoring
                                        #   + dependency-edge graph view. Purpose-built for
                                        #   enterprise UX; INDEPENDENT of ops-console.
platform/agentic-ops-console            # UNCHANGED — explicitly out of scope. No AEP work lands
                                        #   here; it matures its enterprise UX on its own track.
@infra-tools/agentic-experience-planner # OPTIONAL new pkg — only if semantic planning + graph
                                        #   traversal exceed the runtime bundle budget; keeps
                                        #   heavy deps out of the core FESM (mirrors the
                                        #   cytoscape-off-the-runtime precedent, ADR-037)
```

Rationale: the runtime bundle budget (~720 KB) is the hard constraint. Registry subclasses are cheap;
if the planner needs client-side semantic ranking or graph libs, it moves to the optional package.

---

## 6. APIs

### Client (Angular `provideX` — matches platform-seams.md conventions)

```ts
provideExperiencePlatform({           // composite, mirrors provideAgenticPlatform()
  catalogUrl, tenantId, getToken,     // reuses catalog wiring
  planner: { mode: 'deterministic' | 'hybrid', semanticRanking?: boolean },
});
provideExperienceRegistry({ source }); // static | rest | catalog
provideCapabilityGraph();              // registers the resolver + 'experience' LayoutInput
```

### Control plane (Hono — extends existing `agentic-catalog-server`, **not** Spring Boot)

```
GET    /v1/catalogs/:tenant/experiences
GET    /v1/catalogs/:tenant/experiences/:id
POST   /v1/catalogs/:tenant/experiences
PATCH  /v1/catalogs/:tenant/experiences/:id
DELETE /v1/catalogs/:tenant/experiences/:id           # soft-delete + audit
POST   /v1/catalogs/:tenant/experiences/:id/plan      # server-side deterministic dry-run
GET    /v1/catalogs/:tenant/capabilities/search?q=&kind=  # EXISTS (ADR-038) — planner reuses
GET    /v1/catalogs/:tenant/stream                    # EXISTS — SSE catalog events
```

All new routes reuse `bearerAuth` + `requireTenantScope` + `withTenantScope` (RLS) + atomic
`catalog_audit` append + `publishCatalogEvent`. OpenAPI via `@hono/zod-openapi` (existing pattern).

---

## 7. Control-plane backend architecture (corrected from "Spring Boot")

**Reality:** `platform/agentic-catalog-server` — **Hono 4 + `@hono/node-server` + `@hono/zod-openapi`,
Postgres (pg) with row-level security, `node-pg-migrate` raw-SQL migrations, `jose` JWT/JWKS (OIDC),
optional pgvector, optional OPA sidecar, pino logging, ESM, deployed via Docker/Render.** Zero Java.

- **Multi-tenant:** every tenant-scoped table has RLS `current_setting('app.tenant_id')`; `withTenantScope`
  sets it per request; a second gate is `requireTenantScope` on the JWT.
- **AEP additions:** one migration (`010_experiences.sql`) + one route module (`experiences.ts`) +
  domain/repo pair (`experience.ts`, `experience-repo.ts`) following the exact `capability`/`agent` pattern.
- **Spring Boot's actual role:** `SpringBootMfeRegistrySource` (`mfe/spring-boot-mfe-registry.ts`) is a
  *client adapter* letting an adopter point the runtime at their **existing** Spring MFE registry. It is a
  supported federation source (platform-seams.md), not the platform's backend. The AEP plan keeps
  adapter parity (ADR-048) so a Spring-shop adopter can serve Experiences from their own backend if they
  implement the same REST contract — but we ship the reference server in Hono.

---

## 8. Angular architecture

- **Standalone components + signals + DI**, unchanged. Everything root-provided (`providedIn: 'root'`).
- New registries follow `RegistryBase` exactly; new providers follow `provideX` + `EnvironmentProviders`.
- `ExperiencePlanner` is an `@Injectable` consuming the registry set + `AgentContextProvider`; it emits
  into `LayoutResolver` (new `'experience'` source) and `TOOL_FILTER`.
- **No change to `runUntilSettled`, backends, or the event schema** — the planner sits *beside* the
  run-loop, feeding it context, not replacing it.
- Bundle discipline: heavy planner code behind the optional package or lazy `import()`.

---

## 9. Persistence model

| Data class | Store | Owner | Mechanism |
|---|---|---|---|
| Capability metadata (tools, components, prompts, skills, knowledge, memory defs, …) | Postgres `capabilities` (kind-discriminated) | Developer | catalog server, RLS |
| Experiences | Postgres `experiences` (new, RLS) | Business | catalog server, approval-gated |
| User preferences (pinned widgets, theme, saved layouts, hidden cards) | `LayeredLayoutStore` `user-saved` tier / `PersistenceRegistry` adapters | User | client (indexedDb/http), **never** in registry metadata |
| Business data (matters, documents, cases) | Adopter's application DB | Application | out of platform scope |
| Audit | Postgres `catalog_audit` hash-chain | Platform | append-only, tamper-evident |
| Plans (cached) | Control-plane cache (Redis/pg) + client memo | Platform | TTL + version invalidation |

This realizes the proposal's four-ownership governance split on infrastructure that already exists.

---

## 10. Security model

Reuse in full: **JWT/JWKS** (jose, `bearerAuth`), **Postgres RLS** (tenant isolation), **scope policy**
(`setScopePolicy` filters every registry read — the LLM never sees capabilities the persona can't use),
**OPA** (ABAC, `/policy/decide` → sidecar; RBAC via `role_mappings` groups→persona), **audit hash-chain**
(`/audit/verify`), **signed MFE packages** (ecosystem tier, Sigstore — platform-evolution-plan).

**AEP-specific:** the Planner evaluates scope + OPA gates **before** emitting a plan, and records the
decision in `rationale` → audit chain. An experience a persona may not run is never planned, and the
denial is auditable. This is stronger than the LLM-emits-layout model (which relies on prompt-time tool
filtering only).

---

## 11. Performance & caching

- **Plan cache:** memoize `plan(goal, persona, context-hash)` — client-side `computed()` + control-plane
  cache. Invalidate on capability-version bump (reuse `requiredHostVersion`/version chains) or catalog
  SSE event.
- **Reuse:** `TileResultCache` (dashboards), single-`computed()` `LayoutResolver`, capability prefetch +
  activation events, SSE fan-out via pg LISTEN/NOTIFY (multi-replica), embedding search topK.
- **Graph traversal:** the Seam-A resolver is O(V+E) pure function; memoized per experience version.
- **Bundle:** heavy code out of runtime FESM (optional package / new experience-studio app), per ADR-037 precedent.

## 12. Versioning strategy

Reuse the existing minimal semver matcher (`semver-match.ts`) + `requiredHostVersion` gate +
`parentVersion` version chains (templates/dashboards/playbooks). Experiences and the new registries adopt
the **same** chain semantics and approval state machine (`draft→review→approved→deprecated`). Multiple
implementations of one capability resolve via Seam-A `tag`-based late binding + conflict policy. No new
versioning machinery.

## 13. Future roadmap (slots into platform-evolution-plan M1–M8)

| Milestone | AEP work |
|---|---|
| Near (with control-plane M-tier) | Seam A (graph metadata + resolver), Seam B (PromptRegistry, WorkflowRegistry, NavigationRegistry) |
| Mid | Seam C (Experience Registry) + Seam F (catalog `/experiences` + schema migration `010`) |
| Mid+ | Seam D (Experience Planner — deterministic, then hybrid), Seam E (Experience Studio — new dedicated app) |
| Later | SkillRegistry, KnowledgeRegistry, MemoryRegistry (align to ROADMAP Tier 1.4), semantic experience ranking |
| Tier 3 (unchanged — wait-and-see) | A2A protocol, OpenFeature flags, computer use, agent handoffs, external workflow engines |

Cadence follows GOVERNANCE.md: each seam = one RFC + 7-day comment + TSC vote before implementation.

---

## 14. Risks & guardrails

| Risk | Guardrail |
|---|---|
| Greenfield rebuild of shipped subsystems | This plan forbids re-implementing LayoutResolver/DashboardRegistry/FormRegistry/catalog server. Seams are additive only. |
| Registry sprawl | Only 6 new registries, each with a clear no-home justification; ADR-guidance honored (governance hooks over new registries elsewhere). |
| Bundle-budget breach | Graph viz + heavy planner deps live in the new experience-studio app / an optional package, never the runtime FESM. |
| Piling onto an immature admin app | Ops-console is explicitly out of scope; all authoring lands in the new dedicated studio app so ops-console can mature its enterprise UX independently. |
| Runtime non-goal violation (OPA/OpenSearch in bundle) | Policy stays sidecar; knowledge/retrieval stay adapter-side; runtime holds metadata only. |
| Planner opacity | Deterministic pre-plan + `rationale` in the audit chain; LLM only refines, never silently decides scope. |
| Breaking change | Every field optional; every source additive; ADR-010 D4 verified per seam. |
| Scope creep vs. platform-evolution-plan | AEP is a subset of the control-plane + coordination-layer tiers, not a parallel program. |

---

## 15. What to do next

1. Socialize this verification + refinement; decide go/no-go on the AEP core (Seams A–F).
2. If go: open RFC-A (capability dependency graph) first — it unblocks C, D, E.
3. Land Seam B registries opportunistically (cheap, independently useful).
4. Keep A2A / OpenFeature / external workflow engines in ROADMAP Tier 3 until a real adopter asks.

**Bottom line:** the external proposal is a good north star but assumes a greenfield that doesn't exist.
~65% is already built. The enterprise-grade, production-ready path is six additive seams on top of the
16-registry runtime and the Hono control plane — not a Spring Boot rebuild, not 18 new registries, and
not a replacement for the LLM-driven render loop.
