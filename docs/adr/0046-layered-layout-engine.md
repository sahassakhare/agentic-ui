# ADR-046 — LayeredLayoutEngine: context-driven, multi-tier, audit-grade workspace and dashboard composition

**Status:** Proposed · **Date:** 2026-05-15 · **Decider:** sahas
**Supersedes:** none · **Related:** ADR-002 (Layered registry system), ADR-008 (Registry scope policy), ADR-010 (Platform principles — zero breaking changes), ADR-043 (LayoutRegistry promotion), ADR-044 (DashboardRegistry), ADR-031 (`provideAgenticPlatform`), [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)

## Context

ADR-043 + ADR-044 established the *primitives* — `LayoutDef` with slot-based composition (`<mvk-workspace-layout>`), `DashboardDef` with tile-based composition (`<mvk-dashboard-canvas>`), agent-emittable via `setWorkspaceLayout` / `proposeDashboard` tools. The eDiscovery flagship demos them end-to-end (Phases A/B/C of the persistence work — commits `1ef2eab`, `01d191b`, `3019007`).

That stack is **demo-grade**, not enterprise-grade. The gaps:

| Concern | Today | Enterprise requirement |
|---|---|---|
| **Trigger model** | Only the chat prompt invokes layout/dashboard changes via tool call | Context signals (route, selection, matter phase, alert deadline, time-of-day) must drive layouts WITHOUT a prompt |
| **Precedence** | Per-persona only (single `LAYOUT_POLICY` token) | Org → Matter → Persona → User → Agent precedence, with deterministic conflict resolution |
| **Storage** | localStorage / IndexedDB (single device, single user) | Server-side per-user state, cross-device sync, offline-capable with reconcile, multi-tenant isolated |
| **Audit** | Tool-call chain-hash captures the agent's *intent*; user Reset / Commit / context-driven switches are NOT chain-events | Every layout mutation in the chain — for legal-discovery / regulated industries this is non-negotiable |
| **Catalog** | Hardcoded `HINT_PRESETS` in `dynamic-surface.tools.ts` | First-class `LayoutTemplate` / `DashboardTemplate` registry with approval workflow, sharing, version-pinning |
| **Agent awareness** | Stateless — Gemini doesn't know current layout / selection / route; idempotency-via-instruction (commit `fb61f14`) is a band-aid | Per-turn context injection so the agent reasons about live UI state and decides intelligently whether to re-emit a layout |
| **Schema evolution** | No migration — schema changes break old saved entries | Versioned slot-map shape with forward-migration; old entries upgrade automatically on rehydrate |
| **Observability** | Registry register/remove events emit telemetry; user interactions don't | Every layout decision (resolved → applied) emits structured telemetry with attribution chain |

A real-world example to ground the discussion. In an eDiscovery review workflow, a junior reviewer arrives at 9 AM Monday and opens the matter. Without typing a single prompt, the workspace should:

1. Open with the **org-default review layout** (privilege panel + tag tray + chain-of-custody) because the org admin set that as the baseline for all reviewers on matters in *review* phase.
2. Override to the **matter-specific layout** if the matter lead pushed a custom shape ("this matter needs PII redaction + foreign-language toggle visible at all times").
3. Layer the **persona density** on top (lead-counsel sees compact rows; paralegal sees comfortable spacing).
4. Restore **the reviewer's own saved tweaks** (they pinned the chain-of-custody panel; that pin survives).
5. Auto-switch to the **document-focused layout** the moment they click into a single document in the queue — no prompt, just selection state changing.
6. When the deadline-approaching trigger fires (45 min before privilege-log deadline), the **layout pivots** to highlight the unresolved-privilege view.
7. If the reviewer types *"show me the chain-of-custody for the selected privileged docs"*, the agent sees the current layout + selection + recent actions in its context and decides whether to layer an additional slot or refine an existing one — not blindly emit a fresh SlotMap.

Today none of this works without typing six different prompts. The agent is the only path to layout change, and the agent has no idea what's on screen.

The constraint: ADR-010 D4 holds. Every change here is **additive only**. Existing `<mvk-workspace-layout [slots]="..." />` consumers see no breaking change; existing `setWorkspaceLayout` tool behaviour preserved; existing `DashboardRegistry.register(def)` semantics preserved.

## Decision

Seven decisions, taken together they promote the layout + dashboard subsystem from "agent-driven mutator" to a layered, context-aware engine with audit-grade attribution. Each decision is its own seam — adopters can take some without all.

### D1 — `LayoutResolver` is the new brain; existing stores become inputs

Introduce a reactive Angular service that computes the *active* `SlotMap` from a set of signals. The current `WorkspaceLayoutStore` becomes one input among many, not the source of truth.

```ts
@Injectable({ providedIn: 'root' })
export class LayoutResolver {
  // Inputs — each one a signal, each one a "layer".
  private readonly inputs: LayoutInput[] = inject(LAYOUT_INPUTS);

  // Output — single computed SlotMap the workspace component binds to.
  readonly active = computed<ResolvedLayout>(() => this.resolve());

  private resolve(): ResolvedLayout {
    // Pure function — replayable, testable, deterministic given inputs.
    const matches = this.inputs
      .map((input) => input.evaluate())   // each input returns 0..N candidate rules
      .flat()
      .filter((rule) => rule.matches());

    // Sort by precedence (D2), pick highest-priority match per slot.
    return mergeRulesIntoSlotMap(matches);
  }
}

interface LayoutInput {
  /** Stable id for telemetry + audit attribution. */
  readonly id: string;
  /** Precedence weight (D2). Higher wins on conflict. */
  readonly weight: number;
  /** Returns 0..N candidate rules; rules carry slot definitions + an audit reason. */
  evaluate(): LayoutRule[];
}

interface LayoutRule {
  readonly id: string;
  readonly source: LayoutInputSource;   // 'route' | 'selection' | 'agent' | 'user-saved' | ...
  readonly slots: Partial<SlotMap>;     // partial — multiple rules merge
  readonly priority: number;            // within-source ordering
  readonly reason: string;              // audit-grade explanation
  matches(): boolean;
}
```

Built-in inputs registered by `provideLayoutResolver({...})`:

| Input | Reads | Emits rules when |
|---|---|---|
| `RouteLayoutInput` | `Router.events` | Route matches a registered pattern (`/documents`, `/holds/:id`, …) |
| `SelectionLayoutInput` | `SelectionStore.current()` | User selected something specific (single doc, multiple docs, custodian, hold) |
| `MatterPhaseLayoutInput` | `MatterStore.phase()` | Phase is `collection` / `review` / `production` / `closed` |
| `AlertLayoutInput` | `TriggerRunner.activeAlerts()` | Time-sensitive alert is firing |
| `PersonaLayoutInput` | `PersonaService.active()` | (always) — applies persona-level density / mode |
| `AgentLayoutInput` | existing `WorkspaceLayoutStore.slots()` | Agent emitted a SlotMap via `setWorkspaceLayout` |
| `UserSavedLayoutInput` | `UserLayoutStore.saved()` (new, see D3) | User saved a personal preference |
| `TimeOfDayLayoutInput` | `Clock.signal()` | Adopter-defined window (after-hours = compressed sidebar) |

Rules are pure data — the same evaluator function regardless of source. The lib ships the inputs and the resolver; adopters compose them.

### D2 — Precedence model: deterministic, transparent, override-able

Layer weights:

```
1000  agent-override          (volatile — user can Reset)
 800  user-saved              (the reviewer's personal pins / tweaks)
 600  matter-default          (matter lead pushed a custom shape)
 400  alert / selection / route ("contextual" inputs — auto-switch reasons)
 200  persona-default
 100  org-default             (the baseline org admin set)
   0  hardcoded fallback      (the lib's default for the route)
```

A `LayoutRule` from a higher weight overrides one from a lower weight for the same slot. Two rules at the same weight resolve by `priority` (within-source ordering), then registration order. Adopters can rewire weights via `provideLayoutResolver({ weights: {...} })`.

**Slot-level merge, not layout-level replace.** A user-saved rule can pin only the `sidebar` slot; matter-default contributes `primary`; persona-default contributes `footer`. The resolver merges per-slot. Replace-the-whole-layout is just a rule that names every slot.

**Eviction semantics.** Higher-precedence sources can emit a `evict: slot` rule that explicitly drops a lower-source contribution for that slot, rather than only override-with-something-else. Important for "the agent says hide the footer, don't replace it".

### D3 — Storage tiers map 1:1 to precedence layers

Each layer has a defined storage location:

| Layer | Storage | Adapter |
|---|---|---|
| `org-default` | Server-side, per-tenant, write-restricted to org-admin role | Custom `PersistenceRegistry` adapter `'org-store'` |
| `matter-default` | Server-side, per-matter, write-restricted to matter-lead role | Adapter `'matter-store'` |
| `persona-default` | Server-side, per-persona-per-tenant | Adapter `'persona-store'` |
| `user-saved` | Server-side per-user + local mirror for offline | Adapter `'user-store'` with conflict reconciliation |
| `agent-override` | Volatile (signal-only); persisted only as audit-trail entry | `WorkspaceLayoutStore` (existing) |

Server-side adapters all conform to the existing `PersistenceDef` shape (`{ read, write, remove, clear }`). The seam established in Phase C holds — adopters can plug Postgres / DynamoDB / Cosmos behind each name.

**Offline + reconcile.** `user-store` is the only layer that needs offline tolerance (the org/matter/persona layers are admin-controlled; if you can't reach the server you fall back to last-cached). User layer uses Last-Write-Wins with a `lastModified` timestamp per saved layout; a sketch of CRDT-style merging for conflicting saves across devices is in [Open Questions §1](#open-questions).

### D4 — Audit trail: every applied layout is a chain event

A new event kind `LAYOUT_APPLIED` joins the existing chain-hash trail ([ADR-009](./0009-approval-intercept-and-audit-hook.md) audit hook). Payload:

```ts
interface LayoutAppliedEvent {
  readonly kind: 'LAYOUT_APPLIED';
  readonly timestamp: string;
  readonly userId: string;
  readonly matterId: string;
  readonly route: string;
  readonly resolvedFrom: {
    readonly inputs: LayoutInputSource[];     // ['route', 'persona', 'user-saved']
    readonly rules: { id: string; source: LayoutInputSource; reason: string }[];
  };
  readonly slots: SlotMap;
  readonly prevHash: string;
  readonly chainHash: string;
}
```

Emitted by `LayoutResolver` on every `active()` signal recompute that produces a *changed* SlotMap (debounced to avoid noise during input-storm settle).

**Time-travel viewer.** Because every applied layout is in the chain with `prevHash → chainHash`, a viewer can replay the chain forward from any timestamp and render the workspace as-of that moment. Compliance-discovery defensible: *"prove the reviewer saw this exact privilege panel layout when she made the call at 14:32:01."*

**Audit shape parity with tool calls.** The chain integrator (existing `audit/chain.service.ts`) already accepts mixed event kinds. `LAYOUT_APPLIED` is just another kind alongside `TOOL_CALL`, `APPROVAL`, etc. No new infrastructure.

### D5 — Agent gets per-turn context block, not just the user's prompt

Today the agent receives `messages: [{ role: 'user', content: '...' }]`. Add a system context block injected before the user message:

```
<context>
  <route>/documents</route>
  <persona>lead-counsel</persona>
  <matter id="acme-2024-acquisition">phase: review</matter>
  <selection type="document" count="3">
    <doc id="doc-471" privileged="candidate" />
    <doc id="doc-482" privileged="yes" />
    <doc id="doc-491" privileged="no" />
  </selection>
  <current-layout>
    <input source="route">/documents → reviewQueue layout</input>
    <input source="selection">3 docs selected → multi-doc-review overlay</input>
  </current-layout>
  <recent-tool-calls>
    <call timestamp="2026-05-15T14:30:01Z">tagDocuments({ ids: [...], tag: 'PII-review' })</call>
    <call timestamp="2026-05-15T14:28:14Z">requestApproval({ ... })</call>
  </recent-tool-calls>
</context>
```

This block is built by a new `AgentContextProvider` service before every turn. Adopters extend the block by registering additional `ContextContributor`s — same registry pattern as the rest of the lib.

**Agent decision quality jumps measurably.** The model now knows whether re-emitting a SlotMap is necessary (it can see the current-layout block) or whether a slot-level refinement is enough. The `fb61f14` "always re-call" instruction becomes a fallback rather than the only safety net; the agent reasons from state.

### D6 — Layout / dashboard catalog: named, versioned, approval-gated

Two new registries built on the existing `RegistryBase`:

- `LayoutTemplateRegistry<LayoutTemplate>` — named, versioned, parameterizable layouts. An adopter publishes *"Privilege-review v3"* and matter leads / users instantiate it.
- `DashboardTemplateRegistry<DashboardTemplate>` — same for dashboards.

Templates carry an **approval state** (`draft` / `review` / `approved` / `deprecated`) with a workflow:

```
draft  →  review  →  approved  →  deprecated
              ↓
            rejected
```

Org admins approve templates; only approved templates appear in pickers by default (`'review'` state is filterable). Mirrors ADR-009 approval semantics.

Template fields beyond `LayoutDef` / `DashboardDef`:

```ts
interface LayoutTemplate extends LayoutDef {
  readonly approvalState: 'draft' | 'review' | 'approved' | 'deprecated';
  readonly approvalChain?: ApprovalEvent[];
  readonly author: { userId: string; tenantId: string };
  readonly visibility: 'private' | 'matter' | 'tenant' | 'public';
  readonly tags: string[];
  readonly description: string;
  readonly preview?: string;          // SVG / image URI
  readonly parameters?: TemplateParameter[];  // typed parameters for instantiation
}
```

`SaveAsTemplate` flow: user with a tuned workspace can `saveLayoutAsTemplate({ name, visibility, …})` — adds a `draft` template to the registry; goes through approval workflow if `visibility !== 'private'`.

### D7 — Schema versioning + forward migration

`SlotMap` and `DashboardDef` gain a `schemaVersion: 1 | 2 | …` field. The lib ships a registry of migrators:

```ts
interface LayoutMigrator {
  readonly from: number;
  readonly to: number;
  migrate(def: unknown): unknown;
}

// Lib provides built-in migrators for every shipped version bump.
// Adopters register custom migrators for their schema additions.
```

On rehydrate from any storage layer, the resolver runs the migration chain (`from → from+1 → from+2 → …`) until the entry is at current schema. Old saved layouts forward-migrate transparently; storage on next write is in current schema.

**No backwards migration.** Going *backwards* (current → old) is intentionally not supported — the audit trail (D4) captures the original entry, so "rollback to v1 shape" means "replay from chain", not "downgrade in-place".

## Consequences

**Adoption is incremental.** Each decision is its own seam — adopters can take D5 (agent context) without D2 (precedence), or D3 (server storage) without D6 (templates). The eDiscovery flagship demo lights up all seven over time; smaller adopters take what they need.

**The lib gains ~2 KLOC.** Estimated breakdown: D1 ~400, D2 ~150, D3 ~250 (adapters), D4 ~200, D5 ~300 (context provider + contributors), D6 ~400 (two registries + approval workflow), D7 ~150 (migration chain). Plus tests proportional.

**The eDiscovery flagship absorbs ~800 LOC of wiring.** Mostly per-route layout rules in `app.config.ts`, the server-side adapters for org/matter/persona/user stores (which the demo can mock with HTTP-against-local-JSON), and the audit-trail viewer page.

**Breaking-change surface is zero.** ADR-010 D4 holds throughout. Every change above is additive — existing consumers see no diff. Migration path for current eDiscovery wiring:

| Current code | Migrates to |
|---|---|
| `inject(WorkspaceLayoutStore).set(slots)` | Still works. Becomes an input to `LayoutResolver` with weight 1000. |
| `inject(WorkspaceLayoutStore).slots()` | Still works. Reads the agent-override layer specifically. |
| New `inject(LayoutResolver).active()` | The "live workspace" signal that the `<mvk-workspace-layout>` component binds to. Replaces direct subscription to the store for that one use. |
| `DashboardRegistry.register(def)` | Still works. Joins the new `host-default` precedence layer. |
| `ProposedDashboardStore.commit()` | Still works. Now persists to `user-store` adapter instead of raw localStorage when D3 is installed. |

**Performance impact.** `LayoutResolver.active` is a `computed()` — recomputes only when an input signal changes. Each input is itself a signal subscribing to a single source (route, selection, etc.). Worst case (every input fires simultaneously on initial mount) the resolver runs once and produces one SlotMap. Steady-state cost is dominated by the inputs' own change-detection, which is independent of this engine.

**Server-side latency budget.** `user-store` reads on boot must complete in under ~400 ms or the user sees a flash of pre-layered layout. Lib ships a local mirror (D3) so cold-start reads are instant; the server read is reconciliation, not blocking.

## Alternatives considered

### A. Keep the current model and document the gaps as a manual checklist for enterprise adopters

**Discarded.** The current model has no precedence resolution at all — the chat shell's `provideLayoutPolicy` is the only point of variation and it's persona-only. Without a resolver as a seam, every adopter rebuilds the same context-driven layer; the lib's role becomes documentation, not infrastructure. Misses the "load-bearing primitive" bar ADR-043 set for layouts.

### B. Make the agent the sole driver; everything is a prompt

**Discarded.** Fails on three counts. (1) Latency — every selection click would round-trip Gemini for a layout decision; ~3-second delay on a click that should be instant. (2) Cost — token-per-click economics don't work at enterprise scale. (3) Offline / no-key environments would have no layout response at all. The agent is one input, not the spine.

### C. Use a CSS / media-query approach for responsive context-switching

**Discarded.** Selection state, matter phase, alert firing — none are expressible as media queries. Even route is awkward (CSS can't read it cleanly). The signal-based resolver is the only honest path for the inputs that actually drive enterprise workflows.

### D. Build a dedicated rules-engine library (Drools / json-rules-engine)

**Discarded.** Overkill. Layout rules are predicates over a small set of typed inputs — 50 LOC of pure-function evaluation, no need for a runtime rules engine, no need for a DSL parser. Signal-based composition keeps the lib's character.

### E. Roll precedence into the existing `setScopePolicy` filter

**Discarded for the same reason ADR-043 §E declined `setLayoutPolicy = setScopePolicy`.** Scope policy is a filter ("which entries are visible"); precedence is a merge ("which contribution wins"). Conceptually distinct surfaces; conflating them would creep both.

### F. Put audit events (`LAYOUT_APPLIED`) on a separate audit log, not the existing chain

**Discarded.** The chain is already the compliance-defensible event log for tool calls + approvals. Forking layout audit to a parallel log fragments the discovery story ("was layout X applied while tool Y was running?" becomes a join across two logs). Chain integrator already supports mixed event kinds; one log wins.

## Implementation notes

Sequenced as four PRs targeting the v1 contract:

**PR1 — D1 + D5 (resolver + agent context).** The conceptual shift. Lights up context-driven layout without a prompt + makes the agent state-aware. ~700 LOC + ~250 LOC tests. Demo wiring in `examples/demo-ediscovery-shell` shows the `/documents` selection → multi-doc overlay flow without typing.

**PR2 — D2 + D3 + D7 (precedence + storage + migration).** The compliance / scale spine. Org/matter/persona/user/agent layers all working, each with its persistence adapter, schema versioned. ~750 LOC + ~300 LOC tests. Demo wiring includes mock HTTP adapters serving from a local JSON file so the demo doesn't require a real backend.

**PR3 — D4 (audit + time-travel viewer).** Chain integration + a new `/audit/layouts` route that lets a user scrub through the chain and see workspace state as-of any timestamp. ~400 LOC + ~150 LOC tests. Builds on the existing chain-hash visualizer.

**PR4 — D6 (template catalog + approval workflow).** Two new registries, the SaveAsTemplate flow, approval state machine, picker UI updates. ~600 LOC + ~250 LOC tests. Demo seeds 4-5 approved templates per role.

Total contract: ~2450 LOC library + ~950 LOC tests, plus ~1500 LOC of eDiscovery flagship demo wiring across the four PRs. Spread over 4–6 weeks of focused work.

**Cookbook deliverables (one per PR):**
- `enterprise-layout-engine.md` — the architecture tour (lands with PR1)
- `precedence-and-storage-tiers.md` — admin / matter-lead / user perspectives (PR2)
- `layout-audit-and-time-travel.md` — compliance-discovery angle (PR3)
- `template-catalog-and-approvals.md` — the marketplace pattern (PR4)

**Compodoc + Playwright deliverables:**
- Compodoc class index gains `LayoutResolver`, `AgentContextProvider`, `LayoutTemplateRegistry`, `DashboardTemplateRegistry`, the eight built-in input services, and the audit-event types.
- Playwright suite gains specs per PR — `12-context-driven-layouts.spec.ts`, `13-precedence-tiers.spec.ts`, `14-layout-audit-time-travel.spec.ts`, `15-template-catalog.spec.ts`.

## Open questions

Decide before each PR ships:

1. **User-saved layout conflict resolution across devices.** Last-Write-Wins with `lastModified` timestamp is the v1. Should v2 introduce CRDT-style per-slot merging (so two devices saving different slot tweaks both survive)? **Tentative:** ship LWW in PR2; revisit if telemetry shows real conflicts.

2. **Agent context block — server-side or client-side composition?** Building it client-side keeps the agent server stateless (every turn carries its own context) but adds ~2 KB to every chat HTTP body. Server-side composition needs the agent server to subscribe to UI state, which doesn't fit the current architecture. **Tentative:** client-side for PR1, evaluate server-side push-based context in a v2 if size becomes a problem.

3. **Approval workflow — synchronous or asynchronous?** Synchronous (admin reviews immediately, blocks user) vs asynchronous (admin notified, user gets `draft` template they can use privately, approval lifts visibility). **Tentative:** asynchronous in PR4 — matches the existing `ApprovalRegistry` async-by-default pattern.

4. **Time-travel viewer — full UI replay or just SlotMap snapshot inspector?** Full replay (re-render the workspace as-of any timestamp) is high-value for compliance but expensive (needs every chain event since the matter opened in memory). SlotMap snapshot inspector (show the resolved SlotMap as JSON / diagram at any timestamp) is much cheaper and covers 90% of the discovery use case. **Tentative:** ship snapshot inspector in PR3, full replay as a follow-on.

5. **Should `org-default` / `matter-default` / `persona-default` be three separate registries or one `LayoutTemplateRegistry` with a `precedence` field?** Three registries are conceptually cleaner but multiply the surface area. One registry with a `precedence` field is denser but conflates concepts. **Tentative:** one `LayoutTemplateRegistry` (D6) carrying the `precedence` field; the lib provides type-narrowed accessors (`LayoutTemplateRegistry.orgDefaults()`, `.matterDefaults()`, etc.) so consumers see three logical views over one registry.

6. **Lifecycle of `agent-override` rules.** Today they live until the user clicks Reset. Should they auto-expire (10 min? 1 hour? matter-phase change?) to prevent stale agent layouts from outliving their relevance? **Tentative:** TTL of 30 min, configurable via `provideLayoutResolver({ agentOverrideTtlMs })`; Reset always works.

7. **Telemetry granularity for resolver decisions.** Emitting `LAYOUT_RESOLVED` on every recompute is noisy (could fire dozens of times per minute during active interaction). Throttle? Sample? Only emit on *changed* output? **Tentative:** emit on changed output only, with a `resolved_inputs` count for debug. The chain event (D4) is the compliance log; telemetry is for ops/perf.

## Out of scope

Explicitly NOT in this ADR (carried to future ADRs if/when needed):

- **Multi-user co-presence on a workspace.** "Show me where Sarah is looking" is a separate feature with its own architecture; doesn't intersect with layout resolution.
- **Layout / dashboard A/B testing infrastructure.** The template catalog (D6) lets adopters publish multiple variants; experimentation framework on top is a separate concern.
- **Marketplace for cross-tenant template sharing.** D6 caps at within-tenant visibility (`private` / `matter` / `tenant`). A cross-tenant `public` registry would need IP / licensing / quality-gate machinery beyond this ADR.
- **Realtime push of org/matter-default changes.** Today admin-edited defaults take effect on next user reload. Realtime push (WebSocket / SSE) is a v2 nicety, not v1.
- **Layout-driven keyboard shortcuts.** Pillar of the post-chat-surfaces plan; doesn't intersect with resolution.

## Status

**Proposed.** Awaiting approval to start PR1 (D1 + D5 — resolver + agent context). PRs 2-4 sequence after PR1 lands and we have telemetry on real usage patterns.
