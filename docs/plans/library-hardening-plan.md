# Library hardening plan

> **Date prepared**: 2026-05-20
> **Scope**: `@infra-tools/agentic-ui` (core) + the nine sibling packages under `projects/agentic-ui-*`. Demo apps are out of scope except as evidence of library behavior.
> **Predecessor**: senior-architect review on 2026-05-20 (in-chat). The over-engineering cuts from that review are deliberately deferred — this plan focuses on closing the **honesty + safety + parity** gaps first.
> **Status**: Draft — awaiting per-slice approval. Slices are independent unless flagged.

---

## What this plan covers

Six slices, ordered by what most actively falsifies a load-bearing README claim today. Each slice is self-contained, commit-shaped, and exits with a measurable acceptance signal.

| # | Slice | Falsified claim today | Effort | Risk |
|---|---|---|---|---|
| **L1** | Backend-adapter parity (Hashbrown + A2UI catch up to AG-UI) | "works against AG-UI, Hashbrown, or A2UI without rewriting application code" | 3–4 days | medium |
| **L2** | Observability emit wiring | "AgenticTelemetrySink emit points are baked in from M1" | 2–3 days | low |
| **L3** | Wire-deserialization schema guards | Implicit: lib is rigorous about Zod | 1 day | low |
| **L4** | Orchestrator failure-mode coverage | "orchestration loop you don't write" | 2 days | low |
| **L5** | Conformance suite depth | "cross-backend conformance suite" | 1.5 days | low |
| **L6** | Sibling-package smoke e2e + public-API hygiene | adapters shipped without integration proof | 2 days | low |

Total estimated effort: **12–14 days of work**, mergeable as 6 commits + 1–2 ADRs (parity contract; emit semantics). No slice depends on another; L1 + L5 are mutually reinforcing (the conformance harness should validate parity).

The over-engineering cuts called out in the review (deprecate dead registries; trim unimplemented layout-precedence sources; extract domain-specific context contributors) are **explicitly deferred** to a follow-up plan once these honesty + safety gaps close. Cutting weight is cheap; falsified claims are expensive.

---

## Slice L1 — Backend-adapter parity (Hashbrown + A2UI catch up to AG-UI)

### What's broken today

Concrete diff against `AgUiBackend`:

| Concern | AG-UI | Hashbrown | A2UI |
|---|---|---|---|
| Message serialization | `convertMessagesToAgUi()` typed translator ([`converters.ts:28`](../../projects/agentic-ui/src/lib/backends/ag-ui/converters.ts)) | raw `input.messages` posted ([`hashbrown-backend.ts:58`](../../projects/agentic-ui/src/lib/backends/hashbrown/hashbrown-backend.ts)) | raw `input.messages` posted ([`a2ui-backend.ts:103`](../../projects/agentic-ui/src/lib/backends/a2ui/a2ui-backend.ts)) |
| Tool schema on the wire | full Zod → JSON-Schema via `convertToolsToAgUi()` ([`converters.ts:68`](../../projects/agentic-ui/src/lib/backends/ag-ui/converters.ts)) | **schemas dropped** — only `{name, description}` | **schemas dropped** — same |
| Event deserialization | `mapAgUiEvent()` typed translator with `extractWidgetRenders()` ([`event-mapper.ts`](../../projects/agentic-ui/src/lib/backends/ag-ui/event-mapper.ts)) | `obj as unknown as AgenticEvent` cast ([`hashbrown-backend.ts:98`](../../projects/agentic-ui/src/lib/backends/hashbrown/hashbrown-backend.ts)) | same cast ([`a2ui-backend.ts:146`](../../projects/agentic-ui/src/lib/backends/a2ui/a2ui-backend.ts)) |
| `state` field threading (ADR-013) | `state: input.state ?? {}` posted | not posted | not posted |
| Sibling spec files | 3 (converters, event-mapper, obs-bridge) — 298 LOC | **0** | **0** |
| Demo usage anywhere in repo | 16 demos | **0** | **0** |
| Dispatch correctness | n/a | n/a | TODO leaked: [`a2ui-backend.ts:53`](../../projects/agentic-ui/src/lib/backends/a2ui/a2ui-backend.ts) hardcodes `threadId: ''`, `runId: ''` with a comment pointing at a `PLAN.md §6.5` that doesn't exist |

The shipped behavior:
- Tool calling against a Hashbrown or A2UI backend silently drops the agent's tool schema. The LLM sees only tool names and a description string. Argument-shape correctness is unrecoverable.
- A malformed event from any non-AG-UI backend can corrupt the run state because the cast bypasses validation.
- `AGENTIC_RUN_STATE_PROVIDER` — the per-turn context plumbing from ADR-013 — works only against AG-UI. Adopters who switch backends lose persona / route / matter context with no warning.

### Approach

Three commits.

**L1.1 — Lift the AG-UI converters to a shared canonical layer.**
- New `lib/backends/_shared/canonical-messages.ts` + `canonical-tools.ts` exposing `toCanonicalMessage / toCanonicalTool` (the lib's wire shape — the existing `AgenticMessage` and `ToolDef` already are; this slice just guarantees the conversion path is uniform).
- AG-UI converters become thin wrappers that further translate canonical → AG-UI's specific shape.
- Hashbrown + A2UI gain wrappers that translate canonical → their target wire shape. **Open question to decide before coding**: does Hashbrown follow the OpenAI tool-call shape (most likely) and A2UI follow its own spec? Confirm against `flights42` reference servers cited in the Hashbrown adapter doc-comment before fixing the serializer.
- Acceptance: `convertMessagesToAgUi`, `convertMessagesToHashbrown`, `convertMessagesToA2ui` exist; each has a sibling `.spec.ts`; tools are converted with their `parametersSchema` (zod-to-json-schema) intact.

**L1.2 — Validated event deserialization across all three backends.**
- Define a discriminated Zod union `agenticEventSchema` in `lib/internal/events.ts` covering every `type` the orchestrator dispatches on (`run-started`, `run-finished`, `run-error`, `text-delta`, `text`, `tool-call-start/args/end`, `tool-result`, `widget-render`, `ui-action`, `state-delta`).
- Hashbrown + A2UI parse lines as `agenticEventSchema.safeParse(obj)`; on parse failure, emit `agentic.backend.malformed_event` telemetry (see L2) and drop the line.
- AG-UI gets the same validation pass after `mapAgUiEvent` for symmetry — currently it's typed but unchecked.
- Acceptance: every backend rejects malformed events via the same code path; no `as unknown as AgenticEvent` casts remain.

**L1.3 — `state` threading + A2UI dispatcher correctness.**
- Hashbrown + A2UI POST bodies include `state: input.state ?? {}`.
- A2UI dispatcher fix: thread the active `threadId` + `runId` from the in-flight `run()` through to `dispatch()` — the current empty-string placeholders are an audit-trail bug. The `UI_ACTION_DISPATCHER` token gains the `threadId`/`runId` arguments at call time, not factory time.
- Acceptance: an `ActionRegistry` effect fired by an A2UI `ui-action` event sees the right `threadId` + `runId` in its `ActionContext`; spec'd.

### ADR
New ADR-048 — **Backend-adapter parity contract.** Codifies: (a) every adapter MUST convert canonical → wire (no raw `input.*` posting); (b) every adapter MUST validate inbound events against the canonical Zod union; (c) every adapter MUST thread `state`; (d) any adapter that omits a capability sets the matching `BackendCapabilities` flag false so the chat shell can degrade gracefully.

### Out of scope
- Adding a `HashbrownBackend` or `A2uiBackend` to any demo. That's L6 (smoke e2e) — keep this slice's diff to the lib.
- Changing the wire shapes upstream of the lib (whatever Hashbrown / A2UI actually expect on the wire is what we serialize to).

---

## Slice L2 — Observability emit wiring

### What's broken today

[`README.md:234`](../../README.md) claims emit points are "baked in from M1." Grep across `projects/agentic-ui/src/lib/**` finds **26 references to `AgenticTelemetrySink`** and **zero `.emit()` callsites** in orchestrator + registries. `provideOtelTelemetry` is wired in **zero** demo `app.config.ts` files. Adopters wiring an OTel sink today see no traces.

This is the single most damaging falsified claim in the repo. It's not subjective.

### Approach

Two commits.

**L2.1 — Wire emit calls at the boundaries that actually exist.**
- `run-orchestrator.ts` — emit on: turn started, turn finished, turn errored (with error code + duration), tool-call started (with tool name + arg count), tool-call finished (success/error + duration), tool-call timeout, backend abort.
- `RegistryBase.applyReplace` — already emits `agentic.registry.register`. Also emit on `removeBySource` (currently silent).
- `loadRemoteCapabilities` — emit on remote-load success / failure with remote name + tool count + widget count.
- `ApprovalRegistry` + `OperationRegistry` — already have `AGENTIC_APPROVAL_AUDIT_HOOK` / `AGENTIC_OPERATION_AUDIT_HOOK` tokens; route those through the telemetry sink as well so adopters get one stream.
- All event names follow the existing `agentic.<domain>.<verb>` convention.
- Acceptance: at minimum 15 distinct event names emit from the lib's hot paths; an `InMemoryTelemetrySink` test fixture asserts the expected sequence for one full turn.

**L2.2 — Wire `provideOtelTelemetry` in a demo + verify end-to-end.**
- Add `provideOtelTelemetry({ serviceName: 'demo-monolith', endpoint: '...' })` to `examples/demo-monolith/src/app/app.config.ts`.
- Add a one-page cookbook entry under `docs/cookbook/observability.md` (update; the file exists) showing the wire-up and what a trace looks like.
- Optional: a Playwright/Vitest assertion against the OTel collector mock that a single turn produces ≥ N spans with the expected names. Soft target — if the OTel collector wiring is too heavy for CI, ship the cookbook and the unit-fixture from L2.1.
- Acceptance: a fresh clone of `demo-monolith` shows traces in whatever OTel viewer the cookbook recommends.

### Out of scope
- W3C trace-context propagation across SSE. That's a follow-up; ADR-001 already calls it out. This slice is about emit wiring in the host runtime.
- Cost / token observability (ADR-034 sketches the seam — separate plan once L2 lands).

---

## Slice L3 — Wire-deserialization schema guards

### What's broken today

Folded into L1 once that lands (L1.2 explicitly covers it). Kept as a separate slice here so it can ship independently if L1 stalls on the wire-format research.

### Approach

One commit. The discriminated `agenticEventSchema` Zod union exported from `lib/internal/events.ts`. Even before backends are switched to use it, `RunOrchestrator` validates events it consumes from any backend via `agenticEventSchema.safeParse` before dispatching; malformed events route to `AGENTIC_TELEMETRY_SINK` with `agentic.run.malformed_event` and are dropped.

### Acceptance
Existing tests pass unchanged; a new spec confirms that a backend yielding a malformed event causes the orchestrator to emit `agentic.run.malformed_event` and continue (not crash).

---

## Slice L4 — Orchestrator failure-mode coverage

### What's broken today

[`run-orchestrator.spec.ts`](../../projects/agentic-ui/src/lib/chat/run-orchestrator.spec.ts) covers text streaming + single tool execution + a couple of LRO/approval interactions. Missing:

| Failure mode | Coverage |
|---|---|
| Tool-call timeout (handler exceeds N seconds) | none |
| Tool-call abort mid-execution (signal fires after start) | none |
| Partial JSON / malformed tool args from the LLM | none |
| Concurrent tool calls (if the backend emits two `tool-call-start` before either finishes) | none |
| Backend `run-error` mid-stream after partial text | none |
| Abort *during* the orchestrator's tool-execution await | none |

Each is a real production failure mode. The lib's pitch is "orchestration loop you don't write" — these are the loops adopters are *not* writing.

### Approach

One commit, six new specs (or six new `it()` blocks in `run-orchestrator.spec.ts` — author's call). Each uses `FakeAgenticBackend` to script the exact event sequence. Acceptance: `run-orchestrator.spec.ts` exercises every branch of the orchestrator's switch + timeout + abort guards; coverage report shows the orchestrator file at ≥ 90% branch coverage.

### Out of scope
- Adding *new* failure-recovery features (retry-with-backoff, partial-rollback, etc.). This slice tests what's there. Adding behavior is a separate decision.

---

## Slice L5 — Conformance suite depth

### What's broken today

[`lib/testing/conformance-suite.ts:75-113`](../../projects/agentic-ui/src/lib/testing/conformance-suite.ts) covers:
- Lifecycle events (`run-started` → `run-finished` / `run-error`)
- Pre-aborted signal respect
- Thread/run ID pass-through

Does **not** cover:
- Streaming-text correctness — delta ordering, no overlaps, final `text` event reconciles
- Tool-call schema validity — args parse against the tool's `parametersSchema`
- Concurrent tool calls — if a backend advertises this capability via `BackendCapabilities`, it must demonstrate one
- Malformed-event resilience — sending a malformed event mid-stream should produce telemetry and not crash
- Multimodal capability — if `capabilities.multiModal` is true, the backend MUST accept a multipart message and route it correctly
- `state` field round-trip — if the adapter advertises `clientTools`, it MUST thread `state` per ADR-013

### Approach

One commit extending the harness with capability-gated checks. Pattern: each new check is registered with a `requires: keyof BackendCapabilities` flag; the harness skips checks the adapter doesn't advertise and asserts checks it does advertise.

This slice closes the loop with L1: an adapter that claims `clientTools: true` but fails the tool-schema check now fails the conformance suite. The parity contract has teeth.

### Acceptance
AG-UI passes all checks. Hashbrown + A2UI (post L1) pass all checks. A deliberately-broken `FakeAgenticBackend` configured to omit `state` threading fails the harness with a precise message.

---

## Slice L6 — Sibling-package smoke e2e + public-API hygiene

### What's broken today

Of the nine sibling packages, **five ship with zero end-to-end coverage** in this repo:

| Package | Unit tests | E2E proof in repo |
|---|---|---|
| `agentic-ui-server` | yes | wired in `demo-server` ✓ |
| `agentic-ui-server-stores` | yes | adapters tested in isolation; no catalog integration |
| `agentic-ui-server-registrar` | yes | claimed used by `demo-ediscovery-server` boot; no assertion |
| `agentic-ui-mcp` | yes | `demo-ediscovery-mcp` exercises end-to-end ✓ |
| `agentic-ui-teams-bot` | 21 | **none** |
| `agentic-ui-m365-agents` | 22 | **none** (just shipped 2026-05-19) |
| `agentic-ui-copilot-skill` | 17 | **none** |
| `agentic-ui-copilot-studio-connector` | 26 | **none** |
| `agentic-ui-opa-authorizer` | 4 | **none** |

Plus a public-API hygiene issue: `FakeAgenticBackend` is re-exported from [`public-api.ts:49`](../../projects/agentic-ui/src/public-api.ts) — test scaffolding that looks like production API. Some test-only types follow the same pattern.

### Approach

Two commits.

**L6.1 — One smoke e2e per black-box adapter.**
- `agentic-ui-teams-bot` + `agentic-ui-m365-agents`: a vitest smoke that mounts the middleware against a mock HTTP request, asserts (a) JWT verify passes with a test key, (b) a `message` activity produces a reply, (c) an `adaptive-card` event lands in the outbound payload. Mock the AAD token endpoint; mock the Bot Connector reply endpoint.
- `agentic-ui-copilot-skill`: a smoke that mounts the webhook, verifies the GitHub signature with a test key pair, exercises the SSE chunk emitter.
- `agentic-ui-copilot-studio-connector`: a smoke that runs the Zod-to-OpenAPI manifest generator against one real `ToolDef` and asserts the AAD JWT verifier accepts a test token.
- `agentic-ui-opa-authorizer`: a smoke that constructs the authorizer with a deterministic OPA bundle (or HTTP mock) and verifies one allow + one deny.
- Acceptance: each adapter has at least one named e2e test under its `src/**.spec.ts` (or a sibling `e2e/` directory if it needs more setup) that exercises the full request → middleware → handler → response path.

**L6.2 — Public-API hygiene pass.**
- Move `FakeAgenticBackend` and the test-only telemetry sinks (`InMemoryTelemetrySink`) under a `/testing` subpath export via the lib's `exports` map. `import { FakeAgenticBackend } from '@infra-tools/agentic-ui/testing'`.
- Audit the 124 exports in `public-api.ts`. For each export with zero references outside the lib's own `*.spec.ts`, decide: real API (keep), test util (move to /testing), or dead (remove). Quantify the result in the commit message.
- Acceptance: `import { FakeAgenticBackend } from '@infra-tools/agentic-ui'` no longer resolves; the move is documented in the changelog as a non-breaking subpath addition (existing imports route through a deprecated re-export for one minor cycle, then drop).

### Out of scope
- Real LLM-driven integration tests for the adapters — those need API keys and don't belong in unit CI. The smokes here mock the wire and assert routing correctness.

---

## Sequencing + decisions

**Independent slices**: L1, L2, L3, L4, L6 can land in any order.
**L5 depends on L1** (the parity checks need the new converters in place).
**L3 is folded into L1.2** if L1 lands first; otherwise it ships as its own commit.

**Decisions to make before code starts:**

1. **L1 wire shapes.** Confirm what Hashbrown reference servers (`flights42/server-{openai,google}.ts`) and the current A2UI spec actually expect on the wire. If neither has a stable canonical shape, document the assumption in ADR-048 and pin a version.
2. **L2 emit verbs.** Settle on the event-name vocabulary (`agentic.run.started`, `agentic.run.tool_call.started`, etc.) so OTel adopters can pre-build dashboards. One review-and-freeze pass before L2.1 lands.
3. **L4 timeout policy.** Does the orchestrator enforce a per-tool timeout by default, or does each `ToolDef` opt in? Decide before writing the timeout spec (the test sets the contract).
4. **L6.2 deprecation strategy for `FakeAgenticBackend` re-export.** One-cycle re-export with `@deprecated` JSDoc is the proposal — confirm before doing the public-API audit.

---

## Acceptance summary (one-line per slice)

- **L1** — Hashbrown + A2UI ship typed converters, validated event deserialization, and `state` threading; AG-UI's converter pattern is shared not duplicated.
- **L2** — `AgenticTelemetrySink.emit()` is called from ≥ 15 distinct hot-path call sites; one demo wires `provideOtelTelemetry` end-to-end; the README "baked in from M1" claim becomes a verifiable property.
- **L3** — A malformed event from any backend is caught at the orchestrator boundary, telemetry'd, and dropped — never crashes the run.
- **L4** — `run-orchestrator.ts` is at ≥ 90% branch coverage; every documented failure mode has a named test.
- **L5** — `runConformance` exercises every advertised `BackendCapabilities` flag; a deliberately-broken adapter fails with a precise message.
- **L6** — Every sibling package has at least one smoke e2e wiring its middleware; the public-API surface contains zero test utilities.

---

## What's not in this plan

- The over-engineering cleanup (deprecate dead registries; trim unimplemented layout sources; extract domain-specific context contributors). Deferred to a follow-up.
- ADR consolidation (3 duplicate ADRs, 6 historical-record ADRs). Documentation work; doesn't affect runtime.
- Splitting Angular runtime from a hypothetical `agentic-core` Node/SSR package. Architectural change; warrants its own plan + RFC.
- Demo-side hardening (eDiscovery persona enforcement, audit-chain HMAC, multi-matter routing). Out of scope per user direction.

Each of those is real work; none of them invalidates a README claim today. This plan prioritizes what does.
