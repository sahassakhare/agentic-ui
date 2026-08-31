# ADR-051 — Agentic Experience Platform (registry-driven experience composition)

> **Status**: Accepted · implemented on branch `claude/aep-architecture-plan-xisko5` (six seams A–F, additive).
> **Predecessors / related**: [ADR-002](./0002-layered-registry-system.md) (layered registry system) · [ADR-008](./0008-registry-scope-policy.md) (scope policy) · [ADR-010 D4](./0010-platform-principles-and-license.md) (zero breaking changes; optional plugins outside core) · [ADR-014](./0014-registry-governance-metadata.md) (governance metadata) · [ADR-038](./0038-catalog-semantic-search-pgvector.md) (semantic capability search) · [ADR-040](./0040-opa-policy-integration.md) (OPA) · [ADR-044](./0044-dashboard-registry.md) (dashboard registry) · [ADR-046](./0046-layered-layout-engine.md) (layered layout engine) · [ADR-047](./0047-agentic-ui-coordination-layer.md) (coordination layer — the self-serve ↔ agent gap) · [ADR-048](./0048-backend-adapter-parity-contract.md) (backend adapter parity).
> **Plan**: [docs/plans/agentic-experience-platform-plan.md](../plans/agentic-experience-platform-plan.md) (verification of an external proposal + the refined program + implementation-status table).

## Context

The platform can already render UIs an LLM drives — 16 registries on a uniform `RegistryBase`, generative widgets, layered layout resolution (ADR-046), and the coordination layer that closes the "self-serve ↔ agent" gap (ADR-047). What it could **not** do was compose a *complete enterprise experience from a business goal*. An agent (or an admin) still had to know which form, which tools, which layout to assemble; there was no first-class notion of "accomplish this goal," no dependency wiring between capabilities, and no deterministic, auditable layer between a goal and the rendered UI.

An external "Enterprise Agentic Experience Platform" proposal asked for exactly that — but assumed a greenfield (a Spring Boot backend, ~18 net-new registries) that does not match this repo. The [plan doc](../plans/agentic-experience-platform-plan.md) verifies the proposal against reality (backend is Node/Hono, ~15 registries already exist, semantic search already ships) and distills the genuinely-new work into **six additive seams**. This ADR records the decisions taken to implement them.

Constraint carried forward from [ADR-010 D4](./0010-platform-principles-and-license.md): every change is **additive** — new optional registries, new `provideX` factories, new *optional* `RegistryEntry` fields. No existing seam changes shape. Runtime non-goals hold: **no OPA / OpenSearch / workflow engine inside the runtime bundle**; policy stays a sidecar the control plane calls.

## Decision

Six seams. Each is independently adoptable; together they compose a goal into a rendered, governed experience.

### ADR-051-A — Capability dependency graph

`RegistryEntry` gains two **optional** fields: `requires?: CapabilityRequirement[]` and `produces?: string[]`. A `CapabilityRequirement` selects a target by exact `name` **or** by `tag` (late binding to multiple implementations), with `optional` and `reason`. A pure function `resolveCapabilityGraph(root, lookup)` walks those edges into a DAG — `{ nodes, edges, unmet, cycles, truncated, order }` — with cycle detection, a `maxDepth` bound, and order-independent completeness (a node first reached at the bound is re-expanded if later reached in-bounds). No Angular / signals / external deps, so it stays bundle-cheap and unit-testable. `createCapabilityLookup(sources)` builds a lookup over the live registries. This is the substrate that lets the platform "traverse the graph instead of loading static workflows."

### ADR-051-B — Six new capability registries

Add `PromptRegistry`, `SkillRegistry`, `KnowledgeRegistry`, `MemoryRegistry`, `WorkflowRegistry`, `NavigationRegistry` — trivial `RegistryBase<TDef>` subclasses filling conceptual gaps with no prior home (prompts were inline strings; skills, knowledge sources, memory providers, standalone workflows, and nav had no registry). Per [registries-vs-industry.md](../architecture/registries-vs-industry.md) ("don't add more registries; add governance hooks"), we add **only** where the concept is genuinely homeless — and each new registry inherits the full `register / list / signal / removeBySource / setScopePolicy` machinery plus the Seam-A `requires`/`produces`. `CapabilityManifest.exposes` is extended so MFEs can contribute them. Each has a validating factory (`agenticPrompt` / `agenticSkill` / `agenticKnowledge` / `agenticMemory` / `agenticNavigation`) — the sanctioned, throw-at-author-time construction path matching `agenticTool` / `agenticForm`.

**Explicitly NOT added**: Policy, Renderer, MCP registries. Policy stays OPA-sidecar + `ApprovalRegistry` + scope policy (pulling policy evaluation into the bundle violates the no-OPA-in-runtime non-goal); rendering is already `ComponentRegistry` + `LayoutRegistry` + `mcp-ui`; MCP servers are catalogued as `agents`.

### ADR-051-C — Experience Registry

An **Experience** is business intent decoupled from implementation: `ExperienceDef` (a goal, the capabilities it `requires`, `personas` / `requiredPermissions`, an optional `defaultLayout`, advisory `policies`). Because it extends `RegistryEntry` it is a first-class capability — in the dependency graph, persona-scopable, federation-symmetric. `ExperienceRegistry extends RegistryBase<ExperienceDef>` and layers the `draft → review → approved` approval state machine reused from ADR-046 D6. Approval lives in a **lazy overlay** keyed by name: the base state comes from the stored def, transitions layer on top, and the overlay is seeded only by `transition` (never at register) so a dropped `first-wins` re-registration can't de-approve a live experience; `removeBySource` prunes the overlay. `agenticExperience(def)` validates the shape at author time.

### ADR-051-D — Experience Planner

`ExperiencePlanner.plan(input)` is a **deterministic pre-plan** that sits *beside* the LLM run-loop, not replacing it. It (1) resolves an `ExperienceDef` by explicit id, matched intent, or goal substring; (2) evaluates an **access gate before any resolution** — approval state, `personas`, `requiredPermissions` (in-runtime ABAC against `user.permissions`); (3) traverses the Seam-A graph into a concrete bundle (components / forms / tools / dataSources / prompts / knowledge / memory / skills / workflow / layout), expanding skills into their tools; (4) surfaces `unmet` requirements rather than hiding them; (5) emits an audit `rationale`. `policies` are **advisory pass-through** — forwarded into the plan for the downstream policy layer (OPA sidecar) to enforce, *not* evaluated in-runtime.

Integration is additive:
- The plan flows into the agent context as an `<experience-plan>` XML block via `ExperiencePlanContextContributor` (so the LLM personalizes, rather than re-deriving scope).
- The plan's `defaultLayout` seeds `LayoutResolver` at a **new `experience` precedence source** (weight 900 — below the volatile `agent` layer at 1000, above `user-saved` at 800), via `ExperienceLayoutInput`.
- `ExperiencePlanStore` holds the active plan; `provideExperiencePlatform({ includePlanContext?, includeLayoutInput? })` wires both, matching the `provideAgentContext` idiom.

**Observability**: the planner emits `agentic.experience.plan` / `agentic.experience.access_denied` / `agentic.experience.unresolved`, and approval transitions emit `agentic.experience.approval_transition`, through the existing `AGENTIC_TELEMETRY_SINK`. Access-control decisions are never silent.

### ADR-051-E — Experience Studio (new app, not the ops console)

Authoring lands in a **new dedicated app**, `platform/agentic-experience-studio`, purpose-built for enterprise UX and independent of the ops console (which is intentionally left untouched to mature on its own track). It talks to the same catalog server over HTTP and reuses no ops-console code. It covers: experiences (list / create / edit / **cytoscape dependency-graph viz** / server plan dry-run / approval workflow), a generic capability studio for every new kind (Prompt / Skill / Knowledge / Memory / Workflow / Navigation), and a Policy Studio (OPA rego bundles). The dependency-**edge** graph is the view the ops-console **containment** topology (ADR-037) deliberately lacks.

### ADR-051-F — Experience persistence in the Node/Hono control plane

Experiences persist in the **existing** `agentic-catalog-server` (Node/Hono + Postgres RLS + JWT + audit chain + SSE) — not a new stack. A migration adds a tenant-scoped `experiences` table; routes add `/v1/catalogs/:tenant/experiences` (CRUD + `/transition` approval + `/plan` direct-requirement dry-run), following the capability/agent pattern exactly (parameterized SQL, RLS, atomic `catalog_audit` write per mutation, `publishCatalogEvent`). A second migration widens the `capabilities.kind` CHECK to admit the six new kinds. Full transitive graph planning stays in the runtime planner; the server `/plan` validates *direct* requirements (kind-aware, case-normalized) with optimistic-concurrency-guarded transitions. **Spring Boot** remains only the optional client-side MFE-registry adapter (ADR-048 parity), not the platform backend.

## Consequences

### Positive
- A business goal resolves to a rendered, governed experience through a **deterministic, auditable** layer — scope decisions live in testable code, not the LLM prompt. An experience a persona/permission may not run is never planned, and the denial is telemetry-visible.
- The registry-first, capability-driven vision is real: experiences, prompts, skills, knowledge, memory, workflows, and nav are all first-class capabilities — scopable, federation-symmetric, dependency-linked.
- Everything is additive; existing adopters see no diff. The runtime FESM stays lean (graph viz + heavy planning live in the studio app / optional package, per the ADR-037 cytoscape precedent).

### Negative / trade-offs
- The registry set grows by six (+ Experience). Justified per registry against "no homeless concept"; the count still sits well inside the mature-plugin-platform band (VS Code 50+).
- A **real OIDC redirect** flow and **function-of-state** workflow branches need external infra and are out of scope (the studio accepts a pasted JWT; the workflow editor covers string/terminal `next`).

### Performance

`ExperiencePlanner.plan()` is **memoized** (plan §11): keyed on
`(resolvedExperience, persona, permissions, allowUnapproved)`, with synchronous
signal-based invalidation — a `computed` epoch reads every source registry plus
`ExperienceRegistry.approved()` (which tracks the entries, approval overlay, and
scope policy), so the whole cache is dropped the instant any of them changes, with
no stale-cache window (an effect would flush a tick late). Telemetry is emitted on
every call, cache hits included, so the access-decision audit trail stays complete
— only the expensive graph traversal is memoized.

### Neutral
- `policies` on an experience are advisory in-runtime — enforcement is the downstream OPA layer's job. This is intentional (non-goal: no OPA in the bundle) and documented on the field, but adopters must not assume declaring a policy enforces it in-runtime; use `personas` / `requiredPermissions` for in-runtime denial.

## Verification

Green across all three codebases: runtime `@infra-tools/agentic-ui` (1093 specs), `agentic-catalog-server` (220 specs), `agentic-experience-studio` (18 specs); all builds clean; ops-console untouched and still builds. Two adversarial production-readiness audits (backend + runtime) were run before merge; all correctness / security / integrity / observability findings were fixed (see the plan doc's status table and the hardening commits).

## Status

**Accepted.** Per [GOVERNANCE.md](../../GOVERNANCE.md), each seam is a candidate for its own RFC (new public API / new registry shape → RFC + comment period + TSC vote); this ADR + the plan doc are the design record the RFCs draw from.
