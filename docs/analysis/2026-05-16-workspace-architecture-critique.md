# Workspace architecture critique — gaps, opportunities, and over-engineering

**Date:** 2026-05-16 · **Scope:** `@infra-tools/agentic-ui` library + `examples/demo-ediscovery-shell` flagship demo · **Context:** post-ADR-046 (LayeredLayoutEngine) and ADR-047 (Agentic-UI Coordination Layer) ship.

This document captures an unvarnished read on the current state of the codebase. It is descriptive and prescriptive — what's there, what's missing, what is justified vs. speculative. Use as input to the next planning cycle; not a "to-do" list to clear in isolation.

---

## 1. State of the union — what's well-shaped

Before the criticism, the things that are honestly good:

- **Reactive precedence model.** `LayoutResolver.active()` is a single `computed()` that subscribes transitively to every `LayoutInput`'s signal reads. The 11-source precedence ladder (weights 0–1000, slot-level merge, eviction semantics) is genuinely the right primitive for "user preference + agent intervention + context signals" — closer to a small rules engine without the runtime / DSL machinery a Drools-style approach would import.
- **Audit chain primitive parity.** `LayoutAuditTracker` reuses the `prevHash → chainHash` shape established by the tool-call audit trail. Same data model, same time-travel discipline, no parallel log. This is the single design choice that makes "show me what Sarah saw at 14:30Z" a real query rather than a wishlist.
- **Additive-only discipline held.** Across PR1→PR4 of ADR-046 and the seven decisions of ADR-047, ADR-010 D4 ("zero breaking changes") was preserved. Existing `setWorkspaceLayout`, `<mvk-workspace-layout>`, `provideLayoutPolicy`, `DashboardRegistry.register` consumers see no diff. This unlocks future cap-raises without rugpull risk.
- **Test surface is honest.** 918/918 specs pass; no `it.skip` / `xit` / `describe.skip` blocks. No silent-disabled tests.
- **Registry layering is coherent.** 19 registries, each with `RegistryBase` semantics (register / list / get / signal / removeBySource / setScopePolicy). The pattern is genuinely uniform — adding a new registry is ~30 lines of base-class extension.

---

## 2. Gaps — features promised, half-shipped, or quietly absent

### 2.1 ADR-047 demo-side UI affordances are partial

ADR-047 D4 + D5 + D6 documented user-side surfaces: **"Save as my preference"**, **Reset hierarchy menu**, **attribution banner**. The lib infrastructure (`LayeredLayoutStore.writeToTier`, `LayoutAuditTracker.chain`) is in place; the workspace banner in [pages/workspace/workspace-demo.component.ts](examples/demo-ediscovery-shell/src/app/pages/workspace/workspace-demo.component.ts) renders the buttons, but two real gaps remain:

- **No `UserSavedLayoutInput`.** The Save button writes into the `user-saved` tier of `LayeredLayoutStore`, but nothing reads from that tier on subsequent boots. The lib has the tier; there's no `LayoutInput` that materializes saved-tier reads as `LayoutRule`s fed back to `LayoutResolver`. Until that exists, "Save as my preference" is write-only — survives reload but doesn't drive the resolver.
- **Reset menu calls `removeFromTier` but UI doesn't re-resolve.** Clicking "Reset to my saved" clears the agent layer; the resolver's signal recomputes. But "Reset to matter default" and "Reset to org default" remove tiers that aren't being read by any input today. The hierarchy is decorative — only the agent + route + persona layers actually drive output.

### 2.2 `RECENT_TOOL_CALLS_SIGNAL` is provider-less

`RecentToolCallsContextContributor` exists in [lib/layout/agent-context/extra-contributors.ts](projects/agentic-ui/src/lib/layout/agent-context/extra-contributors.ts), the injection token is defined, the contributor reads from it — but `app.config.ts` never binds `RECENT_TOOL_CALLS_SIGNAL` to any source. So the `<recent-tool-calls>` fragment never appears in the agent's context block.

The closest existing signal is the audit chain via `appendAudit` in `demo-ediscovery-shared`. A 20-line factory could `computed()` the last N audit events into the expected shape, but it's not wired.

### 2.3 `SelectionStore` is infrastructure without exercise

D7 of ADR-047 introduced `SelectionStore` + `SelectionLayoutInput`. The lib piece is sound. The demo has:
- No selection-rule registrations in `provideLayoutResolver({ selectionRules: [...] })`.
- No click handlers in `pages/documents/` or `pages/custodians/` calling `selectionStore.set(...)`.
- No `selectionStore.clear()` on `NavigationEnd`.

End result: the *"click a document → workspace pivots to preview + tags"* flow that motivated D7 doesn't work yet. The demo could ship 5–10 lines of wiring in the documents list component and have the canonical *"without a prompt, the canvas reshapes on selection"* moment working.

### 2.4 Cookbook pages promised in ADR-046 are absent

ADR-046 §"Implementation notes" committed to four cookbook deliverables — one per PR:

| Promised | Actual |
|---|---|
| `enterprise-layout-engine.md` (PR1) | Not present |
| `precedence-and-storage-tiers.md` (PR2) | Not present |
| `layout-audit-and-time-travel.md` (PR3) | Not present |
| `template-catalog-and-approvals.md` (PR4) | Not present |

The existing [`docs/cookbook/post-chat-surfaces-tour.md`](docs/cookbook/post-chat-surfaces-tour.md) covers §17–22 (the *previous* tour) but doesn't reference ADR-046/047 by number, doesn't walk through `LayoutResolver`, and doesn't show the precedence model. Adopters reading the cookbook will not discover D1–D7.

### 2.5 Agent-server-side context propagation untested

PR1b modified `injectAgenticChat` to prepend a system-role message with `AgentContextProvider.compose()`. The lib code is correct. But:

- **No spec verifies it reaches the wire.** The chat-shell spec coverage exists but doesn't assert the `<context>` block lands in the outgoing `messages` array of a real or mocked backend `.run()` call.
- **The Gemini agent (in `examples/demo-ediscovery-server`) doesn't reference `<context>` in its system instruction.** It treats system messages opaquely. If the agent ignored the block silently, no test would catch it.

The empirical fix earlier (`fb61f14` — "tools are idempotent state-setters; always re-call") is still load-bearing because the agent can't be assumed to use the context block intelligently.

### 2.6 Bundle-cap headroom exhausted

CI cap raised 660 → 720 KB for ADR-046 (PR2). ADR-047 consumed the 32 KB headroom that was budgeted for "one more capability slice". The lib FESM is currently at ~720 KB / 720 KB cap. **Any further additive feature will trigger another cap raise.**

There's a tree-shaking lever (see §3.2) that could reclaim ~10–15 KB without functional change.

### 2.7 No version-diff / no undo for layouts or dashboards

`DashboardDef.parentVersion` chains versions and the audit chain captures every state. But:
- No diff view comparing v2 ↔ v3 of a saved dashboard.
- No "Ctrl+Z to undo the agent's last layout change."

Both are explicitly out-of-scope per ADR-046; flagged here because they will be the next user-visible asks once the current set lands.

### 2.8 No conflict resolution between agent + user concurrent edits

Today: last-write-wins, with agent always winning by weight. No "your edits are pending — accept agent's change?" affordance. Rare in the demo (no drag-builder yet), but inevitable once D4 dashboard-builder-with-tile-drag lands.

---

## 3. Over-engineering — speculative weight that doesn't pay rent yet

### 3.1 `IntentRegistry` + `SchemaTransformerRegistry` — exported but unused

Both registries are in `public-api.ts`, both extend `RegistryBase`, both have zero references in the demo and zero `inject(IntentRegistry)` or `inject(SchemaTransformerRegistry)` calls outside their own files.

Two paths forward:
- **Document intent + keep:** add a one-paragraph "future use" comment in each registry's file referencing the eventual integration. Costs ~20 lines of doc per registry.
- **Move to a deferred-features module:** export from a sub-path like `@infra-tools/agentic-ui/experimental` so the main bundle doesn't pay for symbols the demo never imports.

The bundle-cap pressure (§2.6) gives this work near-term value: kicking experimental registries out of the main FESM is likely a 5–10 KB win.

### 3.2 `registry-defs.ts` is a 1085-line monolith

[`projects/agentic-ui/src/lib/types/registry-defs.ts`](projects/agentic-ui/src/lib/types/registry-defs.ts) contains the union of every registry-entry shape: `ToolDef`, `ComponentDef`, `FormDef`, `ApprovalDef`, `OperationDef`, `DataSourceDef`, `LayoutDef`, `DashboardDef`, `PlaybookDef`, `TriggerDef`, `PersistenceDef`, `IntentDef`, `SchemaTransformerDef`, `ActionDef`, `CapabilityDef`, and more.

Smell: every consumer who imports *any one* of these pulls in *all of them* through the type-only export. With `import type` and `sideEffects: false`, this is mostly a developer-experience cost (jumping into the file lands you in 1085 lines), but the AOT build does emit each interface as a `.d.ts` declaration that touches the build cache more than necessary.

**Suggested split:** one file per domain (`tool-defs.ts`, `form-defs.ts`, `approval-defs.ts`, etc.) reexported through `registry-defs.ts` (or directly from `lib/types/index.ts`). Mechanical change. Cohesion ↑, jump-to-definition ↑, ~0 KB FESM impact.

### 3.3 Five `provideLayoutAudit` config flags for a single sink

`provideLayoutAudit({ sink, attribution, eager })` plus the recently fixed `ENVIRONMENT_INITIALIZER` is fine. But `provideAgentContext({ includeRoute, includePersona, includeLayoutState, includeSelection, includeAvailableTemplates, includeOverrideStack, includeRecentToolCalls, includeMatter, extraContributors })` is **nine config flags** for what amounts to "which built-in contributors do you want?".

Two cleaner shapes:
- Take a single `contributors: ['route', 'persona', 'layout-state', ...]` array. Adopters spell out the set; lib defaults to a sensible 4–5.
- Or split into `provideAgentContext()` (always-on essentials) + individual `provideXxxContextContributor()` opt-ins for the rest.

Either ergonomics shift would remove ~20 lines from the lib + make the demo's `provideAgentContext({ includeMatter: true })` line read as "I want matter context" rather than "I'm flipping flag 8 of 9".

### 3.4 Two parallel "make this run at boot" idioms

The demo has both:
- `provideEnvironmentInitializer(() => { ... })` — used 5×, mostly for catalog wiring.
- `provideAppInitializer(() => ...)` — used 5×, mostly for federation discovery.

Plus the new `ENVIRONMENT_INITIALIZER` token in `provideLayoutAudit` (post-fix). The library has clear semantics for when to use each, but the demo mixes them without comment. A short cookbook entry (or just a comment block at the top of `bootAgenticCapabilities`) explaining "environment = pre-router DI; app = post-router but pre-render" would save the next contributor a stack-trace dive.

### 3.5 Speculative generality in `httpPersistenceStore`

The HTTP adapter ships with `urlForKey`, `init`, `missingIs404`, and `fetcher` knobs. None of these are exercised by the demo (which uses `memoryStore` for all tiers). Test coverage is good. But the adapter is ~150 lines of generality that nothing live consumes.

Two ways to read this:
- **Justified:** the seam was the entire point of ADR-046 D3. Adopters bring their own server.
- **Over-engineered:** until at least one adopter has shipped an HTTP-backed tier, the shape is hypothesis. The 4 customization knobs are educated guesses about what real adopters need.

Recommendation: keep, but flag with a `// FUTURE — first adopter feedback will likely reshape these knobs` block at the top of the adapter. Avoid additive features here until a real adopter pulls them.

### 3.6 D7 `SelectionStore.patchMetadata`

A specific over-shoot: `SelectionStore` ships with `set`, `clear`, `patchMetadata`. The `patchMetadata` method is tested but not used anywhere — neither in the demo nor in any contributor. It exists "in case adopters want to update metadata without replacing kind/ids".

Cost: ~10 lines of method + ~10 lines of spec. Trim if nothing exercises it in the next ~2 weeks.

---

## 4. Opportunities — high-ROI next moves

Ranked by user-perceived value per unit of effort.

### Tier 1 — close the loop on what's almost-done (~1 PR each)

1. **Wire `UserSavedLayoutInput`.** Make "Save as my preference" actually round-trip through the resolver on next boot. Estimated: one new `LayoutInput` class + one new key in the storage namespace + 30 lines in `provideLayoutResolver`. Closes §2.1.
2. **Bind `RECENT_TOOL_CALLS_SIGNAL`.** A `computed()` over the audit chain's last 10 entries. ~20 lines in `app.config.ts`. Closes §2.2.
3. **Wire selection clicks in documents + custodians lists.** `selectionStore.set({ kind: 'document', ids: [doc.id] })` on row click; `selectionStore.clear()` on `NavigationEnd`. Register one selection rule. Closes §2.3.
4. **Write the four cookbook pages.** Each one walks through a working flow in the demo. Estimated 300–500 lines each. Closes §2.4.
5. **Split `registry-defs.ts` by domain.** Mechanical refactor; improves IDE ergonomics + paves the way for §3.1. Closes §3.2.

Together: ~1 week of focused work; lights up D1–D7 as a coherent, demo-visible story.

### Tier 2 — design + ship (~2-4 weeks)

6. **D8 approval gate.** Per ADR-047 §"Out of scope," approval for matter-default / org-default writes routes through `ApprovalRegistry`. Pattern exists; surface UX is the work.
7. **Version diff view for dashboards.** `parentVersion` is captured; a tile-by-tile diff renderer would close the §2.7 gap.
8. **Layout cookbook adopter case study.** First external HTTP-backed `httpPersistenceStore` use. Drives §3.5 from "spec" to "validated".

### Tier 3 — strategic (~next major version)

9. **Tree-shaking refactor.** Move experimental registries (`IntentRegistry`, `SchemaTransformerRegistry`, anything else dead at FESM emission time) into a `/experimental` secondary entry. Reclaim 10–15 KB; create new bundle headroom for future capability slices.
10. **Drag-drop tile builder.** Out-of-scope per ADR-046 but the natural next user-visible delta for `/dashboards`. Significant UI work; would benefit from a focused ADR before code.
11. **Multi-user co-presence.** Explicitly out-of-scope; flagged here so the next planning cycle has it on the radar.

---

## 5. Specific risks to watch

### 5.1 Bundle-cap pressure compounds

The 720 KB cap is the second raise in this codebase (660 → 720 for ADR-046 PR2). The next raise will be the **third** since the platform's initial 200 KB baseline. There's a slow drift toward "the lib bundles everything; adopters tree-shake on the wire" — which works in theory but degrades the *advertised* surface size adopters use to decide whether to import.

**Mitigation:** before the next cap raise, ship §3.1's experimental-module split. Reset the budget conversation.

### 5.2 Agent-server-side context propagation drift

PR1b ships the `<context>` block in the wire. The Gemini server doesn't *use* it (no instruction tweak). If the server is ever swapped for a model that strictly parses system messages, the block becomes load-bearing — and there's no spec catching its absence. **Mitigation:** add a backend-level spec that asserts the system message lands.

### 5.3 ADR sprawl

We now have 47 ADRs. ADR-046 and 047 are dense. Future adopters reading the index will face a wall of architecture. **Mitigation:** add a top-level `docs/adr/INDEX.md` grouping by lifecycle phase (foundations / capability registry / agent surfaces / coordination layer) and marking which decisions are still load-bearing vs. superseded.

### 5.4 Demo affordances drift from lib intent

Several lib-side features (selection rules, recent-tool-calls signal, full reset hierarchy) are in the lib but invisible in the demo. New adopters who study the demo as the canonical example will not discover these features. **Mitigation:** treat demo wiring as part of the ADR's "implementation notes" — a feature isn't shipped until the demo exercises it.

---

## 6. Recommended sequencing for the next planning cycle

1. **Stabilize before extending.** Close the §2.1 + §2.2 + §2.3 gaps. They are 1-day-each fixes that turn "infrastructure present" into "experience visible."
2. **Document what shipped.** Four cookbook pages (§2.4) — even rough drafts are better than zero.
3. **Reclaim bundle headroom.** Split `registry-defs.ts` (§3.2) + move experimental registries (§3.1). Buys runway for the next feature.
4. **Then design D8 + version diff + drag-builder.** With the foundation cleanly visible and bundle pressure relieved, the next major addition has a coherent shape to fit into.

This sequencing avoids the trap of stacking new ADRs on top of half-shipped ones — which is the recurring cause of the gaps catalogued in §2.

---

## 7. Honest open questions

Carrying forward for discussion:

- Is `IntentRegistry` ever going to be wired? If so, by whom and when? If not, deprecate.
- Is the 720 KB cap a hard limit on the lib's role, or an artifact of "this is what the demo needs"? If the lib's identity is "all the primitives an enterprise agentic UI might need," the cap should grow; if it's "core primitives, adopters compose," the cap should shrink and `/experimental` should pull weight.
- Should `httpPersistenceStore` ship with the lib at all, or live in a separate `@infra-tools/agentic-ui-http-store` package? Same question for any future server-side adapter.
- Does the demo deserve to be split? `examples/demo-ediscovery-shell` is one of three eDiscovery demos (`-production`, `-review`, `-search` are MFEs); the shell is starting to bear the weight of demonstrating *every* feature, which makes it both the canonical reference and the messy kitchen.

Answers to these unblock the next round of decisions.

---

**Generated:** 2026-05-16. **Author:** post-ADR-047 ship review. **Status:** descriptive — not a plan, an input to the next plan.
