# ADR-048 — Backend-adapter parity contract

> **Status**: Accepted (shipped in slice L1 of [docs/plans/library-hardening-plan.md](../plans/library-hardening-plan.md), 2026-05-20).
> **Predecessor**: [ADR-001](./0001-agentic-backend-abstraction.md) (the `AgenticBackend` interface) + [ADR-013](./0013-run-state-provider.md) (the `state` reasoning-context field).
> **Supersedes**: nothing; this is a new contract layered on top of existing ADRs.

## Context

The library advertises three protocol adapters as production-shaped surfaces: AG-UI (`@ag-ui/client` via `provideAgUiBackend`), Hashbrown (`provideHashbrownBackend`), and A2UI (`provideA2uiBackend`). The README pitches them as interchangeable:

> *works against AG-UI, Hashbrown, or A2UI without rewriting application code.*

A 2026-05-20 senior-architect review found that pitch was false in practice. Concrete diffs vs AG-UI before slice L1:

| Concern | AG-UI (pre-L1) | Hashbrown (pre-L1) | A2UI (pre-L1) |
|---|---|---|---|
| Tool schemas on the wire | full Zod → JSON-Schema via `convertToolsToAgUi` | dropped — only `{name, description}` posted | dropped — same |
| `state` field threaded (per ADR-013) | yes | no — host context lost | no — host context lost |
| Inbound event deserialization | typed `mapAgUiEvent` translator | `obj as unknown as AgenticEvent` cast | same cast |
| Malformed wire payload handling | not exercised | could corrupt run state | could corrupt run state |
| Sibling spec files | 3 (converters + event-mapper + obs-bridge), 298 LOC | **0** | **0** |
| `ui-action` dispatcher correctness | n/a | n/a | hardcoded `threadId: ''`, `runId: ''` — audit attribution broken |

Tool calling silently failed against Hashbrown / A2UI because the LLM saw tool names but no argument schema. Any non-empty `AGENTIC_RUN_STATE_PROVIDER` context (persona, route, matter) was dropped on the floor. A single malformed event from a misbehaving backend could corrupt the orchestrator's run state via the unchecked cast. A2UI's action effects ran with empty audit attribution.

The conformance harness landed in slice L5 (capability-gated checks for `clientTools`, `generativeUi`, `uiActions`, `multiModal`) but no normative document said what an adapter must DO to pass it. This ADR is that document.

## Decision

**Every published backend adapter ships against a single parity contract.** The contract has four required behaviours, codified as ADR-048-1 through ADR-048-4.

### ADR-048-1 — Tools posted with full JSON-Schema parameters

Every adapter that advertises `BackendCapabilities.clientTools: true` MUST serialize each `ToolDef` for the wire using its `schema` (Zod) converted to JSON-Schema. Posting `{name, description}` only is non-conforming.

The lib ships `serializeToolsForWire(tools: ToolDef[])` in `lib/backends/_shared/canonical-messages.ts`. It targets `jsonSchema7` — broadly compatible with OpenAI / Gemini / Anthropic tool specs. Adapters that need a different target write their own converter.

### ADR-048-2 — `state` threading (per ADR-013)

Every adapter that advertises `BackendCapabilities.clientTools: true` MUST include the host's `input.state ?? {}` in the request body. Backends that don't consume `state` ignore it server-side; backends that do (the AG-UI reference stack via `AGENTIC_RUN_STATE_PROVIDER`) receive persona / route / matter context.

The default `{}` is the v1.2 compatibility shim — existing apps that don't register an `AGENTIC_RUN_STATE_PROVIDER` see no wire-level change.

### ADR-048-3 — Validated event deserialization

Every adapter MUST parse inbound wire events through `agenticEventSchema.safeParse(...)`. Malformed events emit `agentic.run.malformed_event` telemetry (with `agentic.backend.id`, `agentic.event.type`, `agentic.event.parse_errors`) and are dropped. `as unknown as AgenticEvent` casts are non-conforming.

The lib ships `parseAgenticEventStrict(line, ctx)` in `lib/backends/_shared/canonical-events.ts` for NDJSON-line backends; AG-UI's `mapAgUiEvent` returns a strongly-typed `AgenticEvent` directly and flows through the orchestrator-side gate (slice L3) for the same protection.

### ADR-048-4 — Dispatcher attribution (A2UI-class adapters)

Adapters that emit `ui-action` events MUST thread the in-flight `threadId` and `runId` from `AgenticRunInput` into the `UiActionDispatcher.dispatch` call. Hardcoded empty strings are non-conforming.

This was the specific A2UI bug fixed in slice L1.3 — before, `ActionRegistry`-routed effects ran with `actionContext.threadId = ''`, breaking audit attribution.

## Enforcement

`runConformance` (`lib/testing/conformance-suite.ts`) is the enforcement mechanism. Capability-gated checks:

- `clientTools: accepts a non-empty state without crashing` — covers ADR-048-2.
- `schema: every event satisfies agenticEventSchema` — covers ADR-048-3 from the receive side; adapters that yield events through `parseAgenticEventStrict` cannot fail this.
- `uiActions: any ui-action events carry actionId + op + payload` — covers ADR-048-4's wire validity; the dispatcher-side fix is checked by the adapter's own spec.

ADR-048-1 (tool schemas) does not have a conformance check yet because the harness can't easily inspect the outbound request body. The adapter's unit spec covers it (see `hashbrown-backend.spec.ts` + `a2ui-backend.spec.ts`).

## Consequences

### Positive

1. **Tool calling works equivalently across adapters.** An adopter writing a non-trivial Zod schema for a tool can now wire AG-UI or Hashbrown or A2UI and the LLM behind any of them sees the full argument shape.
2. **`AGENTIC_RUN_STATE_PROVIDER` works against any adapter.** The persona / route / matter context plumbing in `app.config.ts` no longer silently degrades when the backend isn't AG-UI.
3. **Malformed wire events become a logged degradation, not a crash.** Telemetry'd at `agentic.run.malformed_event`; dropped from the stream; the run continues.
4. **The README pitch becomes verifiable.** Pointing the conformance harness at any of the three adapters now produces a meaningful pass/fail report.

### Negative

1. **Adopter-side wire compatibility** — Hashbrown + A2UI servers that consumed the pre-L1 `{name, description}` shape on tools may need to handle `parameters` as an additional field. The schema is additive (extra field, never required by the lib), so well-behaved servers ignore it. Servers that strictly validate inbound shapes need an update.
2. **One new shared dependency** — the `_shared/` folder. Adopters writing a custom backend now import from `_shared/canonical-events.ts` for the validated-parse helper. Documented; not load-bearing for the adapter's own correctness.
3. **A2UI's dispatcher interface widened** — `UiActionDispatcher.dispatch` now receives `threadId`, `runId`, and `signal` in addition to the original `actionId`, `op`, `payload`. Adopters with custom dispatchers must update their signature. The default `UI_ACTION_DISPATCHER` already plumbs through.

### Neutral

1. AG-UI's behaviour is unchanged. Its converter already met ADR-048-1; ADR-013 was already wired; its event mapper translates rather than casts. The contract was authored against AG-UI's existing implementation.
2. **Reference server work is out of scope.** This ADR codifies what the client-side adapter must do. Whether Hashbrown's `flights42` reference servers or A2UI's spec-0.x servers consume the new wire fields is upstream-defined. The adapter is conformant as long as it POSTs the contract.

## Migration

For adopters using:

- **AG-UI**: no migration. Behaviour unchanged.
- **Hashbrown**: server-side may need to add (or tolerate) the `parameters` field on each `tools[]` entry and the `state` field on the request body. Tools without complex schemas keep working unchanged.
- **A2UI**: same as Hashbrown for tools + state. Custom `UiActionDispatcher` implementations gain three new fields in `dispatch({...})` — refactor or accept the extra fields via spread.

For adopters writing a custom backend:

1. Use `serializeToolsForWire(input.tools)` instead of `input.tools.map(t => ({name: t.name, description: t.description}))`.
2. Use `parseAgenticEventStrict(line, { telemetry, threadId, runId, backendId })` instead of casting.
3. Include `state: input.state ?? {}` in your request body.
4. If you emit `ui-action` events, dispatch with the live `threadId` + `runId`.

## Alternatives considered

1. **Don't standardize — let each adapter define its own wire.** Rejected: the README already promises interchangeability, so the alternative is rewriting the README. Stating a contract is cheaper than maintaining differentiated marketing.
2. **Auto-generate adapters from a single canonical converter.** Rejected: AG-UI's `@ag-ui/client` runtime types are nominal-typed and the auto-gen path produced more boilerplate than the per-adapter wrapper. Boundary chosen: shared helpers, adapter-owned wire shape.
3. **Move the parity work to a separate package.** Defers neatly to the (pending) [`agentic-core` split RFC](../plans/agentic-core-split-plan.md). If that split lands, `lib/backends/_shared/` migrates with the rest of the orchestration core; the parity contract migrates with it.

## Related

- [ADR-001](./0001-agentic-backend-abstraction.md) — `AgenticBackend` interface
- [ADR-013](./0013-run-state-provider.md) — `state` reasoning context
- [ADR-005](./0005-single-primary-entry.md) — single primary entry (affects how `_shared/` is published)
- [docs/plans/library-hardening-plan.md](../plans/library-hardening-plan.md) — six-slice plan; this ADR codifies the L1 outcome
- [docs/plans/agentic-core-split-plan.md](../plans/agentic-core-split-plan.md) — pending RFC; would relocate `_shared/` to a sibling package

## Status

Accepted 2026-05-20. Shipped in slice L1 of `library-hardening-plan.md`. All three published adapters conform.
