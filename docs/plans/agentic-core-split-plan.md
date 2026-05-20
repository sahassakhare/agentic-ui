# `@infra-tools/agentic-core` split — RFC + plan

> **Date prepared**: 2026-05-20
> **Status**: Draft RFC — **do not implement**. Awaiting approval to proceed (or reject).
> **Predecessor**: senior-architect review on 2026-05-20 (in-chat) recommended this split; [docs/plans/library-hardening-plan.md](./library-hardening-plan.md) explicitly deferred it as "warrants its own plan + RFC."
> **Audience**: maintainers + anyone evaluating the lib for a non-Angular adopter context.

---

## Honest framing first

Before laying out scope, the value of this split is **smaller than the earlier architectural review pitched**. An audit before writing this plan turned up:

- 7 of 9 sibling `@infra-tools/agentic-ui-*` packages have **zero** imports from `@infra-tools/agentic-ui`. They're already independent.
- The two consumers are **`agentic-ui-mcp`** (3 type-only imports — erase at compile time, no Angular in MCP's runtime bundle) and **`agentic-ui-opa-authorizer`** (true runtime Angular consumer, intentionally — it's a registry plugin).
- npm peerDependencies are warnings, not errors. A non-Angular shop CAN install `@infra-tools/agentic-ui` and import types only; TypeScript compiles, runtime stays clean (the Angular code is never loaded).

So the real payoff is narrower than "decouple non-Angular adopters from Angular." It's:

1. **Declarative cleanliness** — non-Angular adopters import from a package that doesn't *advertise* Angular peer-deps in `package.json`. Removes a friction point at evaluation time.
2. **Type contract becomes shareable** — the type + schema surface (`AgenticEvent`, `agenticEventSchema`, `ToolDef`, `MessageContent`) becomes consumable by Go/Python/Rust agent backends via codegen tools that read `.d.ts`.
3. **MCP / server / catalog packages can import their type contracts from a slimmer package** — even though the runtime impact is zero today, the package boundary becomes honest.
4. **Future framework adapters** — if a React or Vue or vanilla-web port is ever in scope, it imports `@infra-tools/agentic-core` and writes its own UI layer. Without the split, those ports start by forking the entire repo.

That's it. The "save 100KB on install" framing the in-chat review used isn't true. The benefits above are real but modest. **You should approve this work only if (3) and (4) are on your roadmap.**

---

## What this plan covers

A three-package split, executed across three slices. Each slice is independently mergeable and reversible up to the publish point.

| # | Slice | Scope | Effort | Risk |
|---|---|---|---|---|
| **C1** | New `@infra-tools/agentic-core` package extracting pure types + Zod schemas + protocol contracts | 1.5 days | low |
| **C2** | Move backend adapters (AG-UI, Hashbrown, A2UI) + orchestrator pure logic to core | 2–3 days | medium |
| **C3** | Adopt the new core surface in agentic-ui (re-exports) + sibling packages | 1 day | low |

Total estimated effort: **4.5–5.5 days**. Smaller than L1 (3–4 days for parity work) but larger than any of L2–L6. The complexity is in (a) deciding the package boundary precisely and (b) preserving federation singleton compatibility — both are design questions answered up front in this plan.

---

## The boundary question

The hard problem in this split is "what counts as 'core'?" There are three plausible boundaries; the plan picks one and documents why.

### Boundary A — Truly framework-agnostic (no `@angular/*` at all)

What goes in core: types + Zod schemas only. Pure data contracts. No DI, no signals, no orchestration.

- **Pro**: real "use this from any framework" story.
- **Con**: the orchestrator + backends use Angular's `signal()` and `inject()`. Without those, we'd have to fork the signal primitive (use `signal-polyfill` or `@preact/signals-core`) and replace `InjectionToken` with our own DI mini-shim. Both are real engineering with their own ongoing maintenance.
- **Verdict**: too much surface to invent from scratch for the payoff. **Rejected.**

### Boundary B — Angular-core primitives allowed, no DOM/CDK/template

What goes in core: types + schemas + backend interfaces + backend adapters + orchestrator pure logic. Allowed to depend on `@angular/core` (signals + InjectionToken + inject) but not `@angular/common` or `@angular/cdk` or `@angular/forms`.

- **Pro**: most of the lib's pure logic is portable as-is. Only the components (`<mvk-chat-shell>`, `<mvk-widget-container>`, etc.) stay in `agentic-ui`.
- **Con**: "core" still requires Angular as a peer. Non-Angular shops can't actually use it without bringing in Angular's runtime. The "framework-agnostic" pitch is half-true at best.
- **Verdict**: pragmatic and shippable in 4–5 days. The right call **only if** the goal is "publish a slimmer package boundary," not "support non-Angular adopters end-to-end."

### Boundary C — Pure TypeScript core + Angular bindings package

Two packages: `@infra-tools/agentic-core` (zero Angular deps, uses signal-polyfill or a custom event-emitter for reactivity) + `@infra-tools/agentic-ui` (Angular bindings that wrap core).

- **Pro**: the actual "framework-agnostic" outcome.
- **Con**: massive rewrite. Every `signal()` and `computed()` and `effect()` site in the lib (50+ call sites) replaced. Custom DI shim. Ongoing maintenance for the signal compatibility layer. Federation singleton story doubles (two packages, both must be shared).
- **Verdict**: **defer.** This is a 4–6 week project if approached seriously. Revisit when the React/Vue port is greenlit.

**This plan adopts Boundary B.** The split is honest about the constraint (Angular core is required), publishes a slimmer surface for non-UI consumers, and leaves Boundary C as a future option without burning time on it today.

---

## What lands where under Boundary B

### `@infra-tools/agentic-core` contents

```
projects/agentic-core/src/
├── types/
│   ├── agentic-event.ts           # AgenticEvent discriminated union
│   ├── agentic-event-schema.ts    # Zod discriminated union (from L3)
│   ├── agentic-message.ts         # AgenticMessage + MessageContent
│   ├── agentic-backend.ts         # AgenticBackend + AgenticRunInput interface
│   ├── backend-capabilities.ts    # BackendCapabilities flags
│   ├── registry-defs.ts           # ToolDef + ComponentDef + ApprovalPolicy + ...
│   └── tool-context.ts            # ToolContext (signal + LRO surface)
├── backends/
│   ├── ag-ui/                     # AG-UI adapter (HttpAgent + converters + event-mapper)
│   ├── hashbrown/                 # Hashbrown adapter
│   └── a2ui/                      # A2UI adapter
├── chat/
│   ├── run-orchestrator.ts        # orchestrator (Angular signal used as state stream)
│   └── message-utils.ts           # pure helpers
├── telemetry/
│   └── telemetry-sink.ts          # AgenticTelemetrySink interface + NoopTelemetrySink
├── testing/
│   ├── conformance-suite.ts       # backend-conformance harness
│   ├── fake-agentic-backend.ts    # deterministic backend
│   └── in-memory-telemetry-sink.ts
└── public-api.ts
```

### What stays in `@infra-tools/agentic-ui`

```
projects/agentic-ui/src/lib/
├── chat/
│   ├── chat-shell.component.ts        # <mvk-chat-shell> (Angular component)
│   └── inject-agentic-chat.ts         # injectAgenticChat() — uses inject(), signals
├── components/
│   ├── widget-container.component.ts  # <mvk-widget-container>
│   ├── form-renderer.component.ts     # <mvk-form-renderer>
│   ├── workflow-renderer.component.ts # <mvk-workflow-renderer>
│   ├── approval-card.component.ts
│   └── ... (all 16 post-chat-surface components)
├── registries/                        # registry classes (Angular @Injectable)
├── providers/                         # provideAgenticUi, provideAgUiBackend, etc.
├── platform/                          # provideAgenticPlatform + catalog services
├── otel/                              # provideAgenticTelemetry
├── layout/                            # LayoutResolver, LayoutAuditTracker, etc.
├── iam/                               # AGENTIC_ACTIVE_PERSONA token
├── factories/                         # agenticTool, agenticForm, ...
├── mfe/, mfe-module-federation/       # federation seams (use inject())
└── public-api.ts                      # re-exports from core PLUS Angular bindings
```

### The dependency direction

```
@infra-tools/agentic-core       (peer: @angular/core, zod)
        ▲
        │  imports types + schemas + backends
        │
@infra-tools/agentic-ui         (peer: @angular/common, @angular/core, @angular/cdk, ...)
        ▲
        │  unchanged for existing adopters — same imports work
        │
   adopter app
```

`agentic-ui` re-exports the core surface so existing adopters' imports keep working. The split is **transparent at the import-site level**; only `package.json` peer-deps change for the core-only consumer.

---

## Pros

1. **Honest package surface.** Non-UI consumers (`mcp`, `server`, server-stores, server-registrar) currently import types from a package that advertises `@angular/common` + `@angular/cdk` peer-deps. They don't actually need them. After C3, those packages depend on a package whose `package.json` matches their actual surface.

2. **Backend adapters get conformance test enforcement at the right layer.** Today the conformance suite (L5) lives in `agentic-ui/src/lib/testing/`. After C1, it lives in `agentic-core/src/testing/`. Any adopter writing a custom backend (Path A in our backend story: "bring your own protocol") imports the harness from core, not from the Angular package.

3. **Type contract becomes consumable by non-TypeScript tooling.** A Go agent server importing the Zod schema as JSON Schema (via `zod-to-json-schema`) can do so from `agentic-core` without pulling Angular type definitions into its toolchain.

4. **L1 (backend parity) lands cleaner.** Slice L1 of `library-hardening-plan.md` does lift-and-share work for backend converters. Doing C1 + C2 first means L1's shared canonical layer lives in `agentic-core` from day one — no later migration.

5. **Future-proofs a React/Vue port without committing to it.** Boundary C (the real framework-agnostic split) becomes a localized rewrite of `agentic-core` later — replace `signal()` calls with a portable primitive, drop `@angular/core` peer — rather than an across-the-codebase refactor.

6. **MCP package size shrinks (marginally).** `agentic-ui-mcp`'s `package.json` peer-dep section can drop the implicit Angular peer (currently transitive through `@infra-tools/agentic-ui`). Real install-time saving for Claude Desktop / Cursor / Zed integrators: low double-digit kB; symbolic clarity: higher.

---

## Cons

1. **Two packages where one used to be — version coordination cost.** Today `agentic-ui` ships on a unified 1.2.x line. After the split, `agentic-core` and `agentic-ui` versions need to stay in lockstep or adopters get type-mismatch errors. Either (a) commit to lockstep semver (always release both together), or (b) accept that bumping `agentic-core` minor forces `agentic-ui` to bump and vice versa. Adds release-process complexity.

2. **Federation singleton story doubles.** ADR-005 mandates single primary entry per package for Native Federation singleton sharing. Two packages → two singletons that both need `shareAll` in the host's federation config. Module Federation host configs (which adopters write themselves) get one more entry. Documented, not insurmountable, but real friction.

3. **Imports look slightly different in adopter code (transition period).** Existing imports `from '@infra-tools/agentic-ui'` keep working because the Angular package re-exports core. But adopters writing new code post-split will be unclear: should I import `ToolDef` from `agentic-core` or `agentic-ui`? Either works; lint rules + docs need to nudge.

4. **Two `npm publish` steps per release.** The publish workflow gains a new entry; the GH Actions matrix runs a second tsc build. Pipeline time: +10–15 seconds per release. CI cost: marginal.

5. **The "Angular core required" caveat undercuts the marketing.** A package called `agentic-core` that requires `@angular/core` as a peer will confuse readers who expect "core" to mean "framework-agnostic." Naming + README copy work to make the distinction clear; otherwise we ship a footgun.

6. **The OPA authorizer plugin doesn't move.** It's the one true Angular runtime consumer among the 9 siblings. It stays depending on `agentic-ui`. So even after the split, the "Angular siblings depend on the Angular package" claim isn't fully clean.

---

## Risks

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | Federation singleton drift — host pinned to `agentic-core@1.2.5` + remote pinned to `agentic-core@1.3.0` produces runtime registry mismatch | medium | high | Strict semver discipline + ADR-014 host-version check extended to enforce both `agentic-core` and `agentic-ui` versions in the federation manifest |
| R2 | Existing adopters' build breaks because re-export shape changes subtly (e.g. exporting a class as `export *` vs named) | low | high | C3 includes a build-and-test pass against the eDiscovery demo + all 9 sibling packages before publish; any drift caught pre-publish |
| R3 | Tooling that introspects `package.json` peer-deps trips on the new shape (TypeDoc, Compodoc, IDE auto-import suggestions) | medium | medium | Pre-publish: run `npm run docs:api` and `npm run docs:compodoc` against the split, fix any drift |
| R4 | `agentic-core` ships test utilities (`FakeAgenticBackend`, `InMemoryTelemetrySink`) that adopters accidentally import in production — same exposure as today but a different package boundary to police | low | low | Keep the `@test-utility` JSDoc tags from L6.2; add the same convention to `agentic-core/public-api.ts` |
| R5 | Decision to do Boundary B blocks future Boundary C work because of accumulated technical debt in the Angular-signal coupling | low | medium | Document Boundary C as the long-term direction in this plan; mark Angular-signal usage in core with `// CORE: signal-dependency` comments so the future migration has a TODO map |
| R6 | The split is implemented, shipped, and we discover no one actually consumes `agentic-core` directly (everyone keeps importing from `agentic-ui` out of habit) | medium | low | Acceptable; the architectural cleanup has standalone value even if direct adoption is rare. Track via npm download stats. |

---

## Sequencing options

### Option 1 — Land C1 + C2 + C3 immediately, before L1

C1 extracts the canonical type + schema layer into `agentic-core`. L1 (backend parity) then writes its shared canonical converter helpers in `agentic-core` from day one, not in `agentic-ui` later to migrate.

- **Pro**: avoids one migration pass.
- **Con**: blocks L1 for ~5 days while the split lands and stabilizes.
- **Pick this if**: you want the architectural cleanup to compound with L1's work.

### Option 2 — Finish L1 (backend parity) first, then C1–C3

L1 lifts AG-UI's converters into a shared layer **inside** `agentic-ui`. After L1 ships, C1–C3 moves that shared layer (already isolated) into `agentic-core` with minimal rework.

- **Pro**: L1 ships in 3–4 days uninterrupted; ADR-048 (backend parity contract) lands; conformance suite enforces parity (already done via L5).
- **Con**: a small migration pass when C2 lands (move the shared converters from `agentic-ui/src/lib/backends/_shared/` to `agentic-core/src/backends/_shared/`).
- **Pick this if**: backend parity is the higher-priority outcome.

### Option 3 — Defer indefinitely

Don't split. Live with `agentic-ui-mcp` and the seven currently-independent siblings importing types from a package that advertises Angular peers. Adopters install Angular even when they don't ship Angular code; lint warnings stay.

- **Pro**: zero implementation cost.
- **Con**: the package surface stays honest only to Angular adopters; non-Angular evaluators see Angular peer-deps and form an opinion before reading READMEs.
- **Pick this if**: the realistic adopter base is Angular-only.

**Recommendation: Option 2.** L1 is the larger user-visible win, ships on its own timeline, and feeds C1–C3 efficiently with the shared converter layer already isolated.

---

## Decisions needed before any code lands

1. **Boundary commitment.** Confirm Boundary B (Angular-core allowed, no DOM/template) is the right scope. If you want Boundary C (truly framework-agnostic), this plan needs to be replaced with a 4–6 week one. Decision: **B / C / defer**.
2. **Sequencing.** Option 1, 2, or 3 above. Decision: **1 / 2 / 3**.
3. **Naming.** `@infra-tools/agentic-core` — confirms the name. Alternatives considered: `@infra-tools/agentic-protocol` (clearer that it's about the wire contract), `@infra-tools/agentic-runtime` (clashes with the "runtime tier" framing in README). Decision: **agentic-core / agentic-protocol / other**.
4. **Versioning model.** Lockstep (same major+minor; both bump together) or independent (each follows its own semver)? Decision: **lockstep / independent**.
5. **OPA authorizer migration.** Today it imports runtime symbols from `agentic-ui`. Does it stay on `agentic-ui`, move to `agentic-core` (would require core to keep `RegistryBase` runtime), or split into a sub-plugin per package? Decision: **stay / move / split**.
6. **MCP migration.** `agentic-ui-mcp` currently imports types from `agentic-ui`. Should C3 migrate it to `agentic-core` in the same PR, or as a follow-up minor bump of MCP? Decision: **same PR / follow-up**.

---

## Acceptance signals (per slice)

- **C1**: `projects/agentic-core/` builds; published locally as `1.2.1-rc.0`; `dist/agentic-core/` contains a single FESM entry; `package.json` peer-deps list `@angular/core` and `zod` only (no `@angular/common`, no `@angular/cdk`).
- **C2**: `runConformance` from `agentic-core` produces the same report against `FakeAgenticBackend` as the pre-split version did. All 944 lib tests pass. AG-UI / Hashbrown / A2UI backend specs (after L1 lands them) run against the core-located adapters.
- **C3**: `agentic-ui/public-api.ts` re-exports everything in `agentic-core/public-api.ts` so existing imports work unchanged. `agentic-ui-mcp` builds with `@infra-tools/agentic-core` as its type dep (decision 6 dependent). eDiscovery demo + all 9 sibling packages build clean.
- **Cross-cutting**: TypeDoc + Compodoc rebuild without drift. The `.github/workflows/publish.yml` workflow gains a `agentic-core-v<X.Y.Z>` tag prefix.

---

## Explicit non-goals

- Replacing Angular signals with a framework-agnostic signal primitive. **Boundary C work.** Out of scope.
- Custom DI shim to replace Angular's `InjectionToken`. Out of scope.
- React / Vue / Svelte adapter packages. Out of scope (this plan only sets up the foundation that would make them possible).
- Renaming `@infra-tools/agentic-ui` to something more specific (e.g. `agentic-ui-angular`). Out of scope; existing adopters import from `agentic-ui` and that name stays.
- Removing the test utilities from the public-api surface. Already handled by L6.2's `@test-utility` JSDoc tags; same convention copied to `agentic-core`.

---

## Open questions to resolve in review

1. Is the "honest framing" admission at the top of this plan accurate? The audit shows 7/9 siblings have zero agentic-ui imports — does that match your read?
2. Boundary B preserves Angular-core as a peer. Is that acceptable, or does the value-prop only become real at Boundary C?
3. Sequencing recommendation is Option 2 (L1 first). Anything pulling in the other direction?
4. Anything I missed in the risks register? R6 (no one actually adopts the new package directly) is the one I'm most uncertain about — would value a second read.

---

## What I'm asking for

- Approval to proceed (per slice; each slice independently approvable).
- Decisions on the six items in **"Decisions needed"** above.
- Or rejection — Option 3 (defer indefinitely) is a defensible answer given the modest payoff.
