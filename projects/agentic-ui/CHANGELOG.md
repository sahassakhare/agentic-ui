# Changelog

All notable changes to `@maverick/agentic-ui` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — first stable release

### Added
- Single primary entry exposing all public API. Tree-shaking is preserved via `"sideEffects": false`.
- **13 registries**, one uniform `Registry<TDef>` shape:
  - **Core**: `ToolRegistry`, `ComponentRegistry`, `CapabilityRegistry`, `BackendRegistry`, `MfeRegistryClient`.
  - **Extended**: `ActionRegistry`, `IntentRegistry`, `FormRegistry`, `DataSourceRegistry`.
  - **Seams**: `ValidationRegistry` (Zod default), `PersistenceRegistry` (memory + localStorage + sessionStorage), `LayoutRegistry`, `SchemaTransformerRegistry`.
- `AgenticBackend` abstraction with three concrete adapters: AG-UI (over `@ag-ui/client`'s SSE HttpAgent), Hashbrown (NDJSON), A2UI (with `ui-action` event class routed through `ActionRegistry`).
- `<mvk-chat-shell>` component with `injectAgenticChat()` controller built on Angular 21's `resource()` + signals; `<mvk-widget-container>` rendering by name via `*ngComponentOutlet`; `<mvk-form-renderer>` for schema-driven forms.
- MFE federation: `defineCapabilityModule({...})`, `loadRemoteCapabilities(...)` (Native Federation), `loadRemoteCapabilitiesMF(...)` (webpack Module Federation), `provideStaticJsonMfeRegistry`, `provideSpringBootMfeRegistry`.
- `mcpToolBridge({client})` to import MCP server tools into `ToolRegistry`.
- OpenTelemetry-backed `AgenticTelemetrySink` (`/otel` content via `provideAgenticTelemetry({kind: 'otel', providers})`) plus a zero-dep console fallback (`provideAgenticTelemetryConsole()`).
- 10 schematics: `ng-add`, `tool`, `widget`, `chat-shell`, `backend`, `agent-server`, `mfe-capability`, `action`, `intent`, `form`.
- Cross-backend conformance suite (`runConformance(backend)`) and `FakeAgenticBackend` for unit tests.
- **76 unit tests** across 12 spec files covering: registries CRUD + signal reactivity + MFE-aware teardown, run orchestrator (lifecycle / tool execution / generative-UI extraction), AG-UI converters + event mapper + observable-to-async-iterable adapter, static-JSON + Spring Boot MFE registry sources, defineCapabilityModule + apply, the cross-backend conformance suite against `FakeAgenticBackend`, and **schematic snapshot tests for all 10 generators** (ng-add, tool, widget, chat-shell, backend, agent-server, mfe-capability, action, intent, form).

### Architecture decisions
- [ADR-001](../../docs/adr/0001-agentic-backend-abstraction.md) — Pluggable backend abstraction.
- [ADR-002](../../docs/adr/0002-layered-registry-system.md) — Layered registry system.
- [ADR-003](../../docs/adr/0003-pluggable-mfe-registry-source.md) — Pluggable MFE registry source.
- [ADR-005](../../docs/adr/0005-single-primary-entry.md) — Single primary entry (no ng-packagr secondary entries).

### Compatibility
- Angular 21+
- Node 20.19+
- TypeScript 5.9+
- Zod 3.23+ (peer)
- RxJS 7.8.x (peer)

### Breaking changes from 0.x
- Secondary entry imports (`@maverick/agentic-ui/ag-ui`, `/hashbrown`, `/a2ui`, `/mfe`, `/mfe-module-federation`, `/otel`, `/testing`, `/components`) have been collapsed into the primary entry. Migration: `import { X } from '@maverick/agentic-ui/<sub>'` → `import { X } from '@maverick/agentic-ui'`.

### Known limitations
- `@angular-architects/native-federation` `includeSecondaries: true` does not emit per-secondary-entry chunks — this is *why* the lib is single-entry. Re-evaluate if/when fixed upstream.
- Webpack Module Federation runtime API is shipped (`loadRemoteCapabilitiesMF`) but the working-demo apps for that path are not in this release; the runtime API matches the Native Federation surface.
- A2UI adapter targets spec version `0.x`. Track the upstream spec for breaking changes.

## [Unreleased]

_Nothing yet._

## [1.2.0] — 2026-05-07

This minor release lands **six new capabilities** from the [r3 dynamic-UI plan](../../docs/plans/ediscovery-dynamic-ui-plan.md): runtime-composed forms, live data fetching from generative UI, guided multi-step workflows, human-in-the-loop approval, long-running operations, and multi-modal input. All additions are opt-in and backward-compatible — existing 1.0 / 1.1 consumers see zero behaviour change without explicit wiring.

The release is anchored by the same eDiscovery flagship reference application — every new capability surfaces as a working flow there: composable custodian intake, autocomplete-from-data-source on the supervisor picker, the `placeLegalHold` wizard, approval policies on `exportProductionSet` + `releaseLegalHold`, the `runTARClassifier` long-running tool, and a multi-modal composer. **211 → 287 lib tests** (+76).

### Added

#### F1 — Composable forms at runtime

- **`agenticForm({ composition: [...] })`** — declarative composition mode where the form is built at runtime from registered widgets. Each entry is `{ widget, section?, if? | predicate? }`; mutually-exclusive `if` (closed-AST DSL) and `predicate` (programmatic escape hatch); registration-time validation surfaces malformed input via `FormCompositionError` with `formName`, `entryIndex`, and `cause`.
- **Closed-AST `if` expression DSL** (`composition/composition-expression.ts`) — supports `===`, `!==`, `&&`, `||`, dotted access, parens, and string / number / boolean literals. Hand-rolled lex/parse/eval; no `eval()` / `Function()`. Own-property-only path resolution blocks `__proto__` / `constructor`. Bounded source length (1024) and recursion depth (32). Public exports: `parseCompositionExpression`, `evaluateCompositionExpression`, `CompositionExpressionError`.
- **`CompositionStore`** (`composition/composition-store.ts`) — renderer-scoped value store keyed by widget slot; signal-backed; `read / write / drop / isDirty / snapshot / clear / values` + `approvals`-style reactive view. `isDirty` rules per primitive type (false / null / "" / 0-length collections → clean; everything else dirty; checkbox `false` clean).
- **`COMPOSITION_SLOT`** injection token — section widgets opt in via `inject(COMPOSITION_SLOT, { optional: true })` to learn their slot key without needing a public `Input`. Delivered via per-section child injectors so widgets that don't care don't have to declare anything.
- **`<mvk-form-renderer>` composition branch** — discriminated dispatch on `def.composition`; per-slot child injector cache; predicate-flip detection effect that interrupts dirty-slot unmounts with an inline drop/keep banner; submit aggregation from `store.snapshot()`. `form.composition.evaluate_ms` histogram on the telemetry sink.
- See the [composable-intake-form cookbook](../../docs/cookbook/composable-intake-form.md).

#### F2 — Live data fetching from generated UI

- **`ComponentDef.dataSources?: readonly string[]`** — declarative dependency surface. `agenticWidget({ dataSources: [...] })` threads it through. Mount-time validation in `<mvk-widget-container>` and `<mvk-form-renderer>` composition path surfaces missing sources as inline placeholder citing the widget + missing names (instead of silently broken widgets at first call).
- **`DataSourceRegistry.getTyped<TQuery, TResult>(name)`** — typed adapter view; throws `UnknownDataSourceError` carrying the name + available names when missing. Wrapped adapter automatically emits `data_source.query_ms` histogram tagged with `name`, `kind`, and `ok` flag (sync, async-resolve, async-reject paths all instrumented).
- **`DataSourceRegistry.missing(required)`** — non-throwing diagnostic for mount-time validation.
- See the [widgets-with-live-data cookbook](../../docs/cookbook/widgets-with-live-data.md).

#### F3 — Guided multi-step workflows (provisional registry)

- **`agenticWorkflow({ name, description?, steps, onComplete })`** — factory for multi-step wizards. `WorkflowStep.next` is `string | null | (state) => string | null` (unconditional / terminal / branching). Validates at registration: non-empty steps, unique step ids, string `next` targets resolve, identifier shapes — `AgenticWorkflowError` cites the malformed step.
- **`<mvk-workflow-renderer>`** — mounts ONE step's widget at a time via `*ngComponentOutlet` + per-step child injector providing `COMPOSITION_SLOT = step.id`. Reuses `CompositionStore` from F1 so state aggregates across steps and survives Back navigation. Breadcrumb (active + visited classes), Back / Next / Submit controls, conditional-next error surfacing without advancing.
- **Telemetry**: `workflow.transition` counter (with from/to/direction) + `workflow.complete_ms` histogram (with ok flag).
- **Provisional registry shape**: per the r3 plan §9.3.3, F3 ships as `FormDef.workflow?` carried through `FormRegistry`. Promotion to a top-level `WorkflowRegistry` is an ARB decision when 3+ workflows demand it. The `agenticWorkflow({...})` call shape stays stable across either path.
- See the [interactive-workflows cookbook](../../docs/cookbook/interactive-workflows.md).

#### F4 — Human-in-the-loop approval

- **`agenticApproval({ tool, required, approverRoles, diffRenderer, signoffMessage })`** + **`ApprovalRegistry`** + **`<mvk-approval-card>`** — chat-shell intercept queues approval-gated tool calls, returns a synthetic `{queued: true, approvalId}` result with a `mvk-approval-card` widget reference so the chat renders the card inline. Card's diff renderer is a host-supplied widget receiving `APPROVAL_DIFF_INPUTS = { approvalId, args, signoffMessage }` via per-card injector — the literal arg payload that will execute on Approve, never an LLM-generated summary. Persona enforcement at the call site (card + queue page).
- **`AGENTIC_ACTIVE_PERSONA`** injection token — chat shell reads via this for intercept context. Default `() => ''` so libraries that don't model personas pay nothing.
- **`AGENTIC_APPROVAL_AUDIT_HOOK`** injection token + **`ApprovalAuditEvent`** type — host wires this to mirror approval transitions into their audit chain (`tool-approved` / `tool-rejected` actions). Fire-and-forget contract — throwing hooks do NOT roll back the in-memory transition (per ADR-009).
- **Telemetry**: `approval.intercept` counter on every queued call; `approval.decision` counter on Approve / Reject.
- See the [approval-flow cookbook](../../docs/cookbook/approval-flow.md) and [ADR-009](../../docs/adr/0009-approval-intercept-and-audit-hook.md).

#### F5 — Long-running operations

- **`ToolDef.longRunning?: boolean`** + **`ToolContext.startOperation / reportProgress / completeOperation / failOperation`** — handlers return immediately with `{opId}` while a background loop drives progress through the registry. `ToolContext` always carries the methods (typed stubs without an `OperationRegistry`); tools that don't need them ignore them.
- **`Operation` / `OperationStatus` / `OperationProgress` / `OperationError` / `OperationStartMeta`** types. `Operation.continuationHandle = { threadId, runId, toolCallId }` for cross-session reattach scaffolding.
- **`OperationRegistry`** — signal-backed map; `operations()` (sorted by startedAt asc), `active()` (started + progress only), `byStatus(s)`, `get(opId)`. Lifecycle: `start / reportProgress / complete / fail` with pct clamping `[0, 100]`, phase preservation across no-phase updates, terminal idempotency, unknown-id silent no-ops.
- **`AGENTIC_OPERATION_AUDIT_HOOK`** + **`OperationAuditEvent`** — fires on every transition (`operation-started` / `-progress` / `-finished` / `-failed`). Same fire-and-forget contract as F4's audit hook.
- **Four new event kinds** added to `AgenticEvent` union: `operation-started / -progress / -finished / -failed`. Additive, not replacement — backends without LRO never emit them.
- **`<mvk-operation-progress>`** widget — lifecycle-aware (started / progress / finished / failed), ARIA progressbar, ETA heuristic from `estDurationMs` or elapsed/pct extrapolation, terminal-state rendering with duration / error.
- See the [long-running-operations cookbook](../../docs/cookbook/long-running-operations.md).

#### F6 — Multi-modal input (slice 1)

- **`MessageContent` union** — `text` / `image` / `file` parts. Mirrors Anthropic / OpenAI / Gemini conventions. `AgenticMessage.content` extended to `string | readonly MessageContent[]` — backwards-compatible with every existing flow.
- **`BackendCapabilities.multiModal?: boolean`** — additive flag. When the active backend doesn't advertise it, the chat shell text-only fallbacks via `textOnlyFallback` with a `console.warn` + telemetry event (`agentic.multimodal.fallback: true`).
- **`<mvk-chat-shell>` composer** — paperclip / drag-drop / paste-image affordances. Pending-attachments tray with image previews + per-chip remove. Configurable `acceptedMimeTypes` and `maxBytes` inputs (defaults: PDF + common image MIMEs + Word/Excel; 10 MB cap). Per-file MIME + size validation client-side; rejection surfaces inline composer error.
- **Multi-part transcript rendering** — text → `<span>`, image → `<img>` (data URI or `URL.createObjectURL` for `ArrayBuffer`), file → `<a class="file-part">` link.
- **AG-UI converter compatibility** — `flattenContent` v1 fallback collapses parts to text until the AG-UI server adapter advertises `multiModal: true` (slice 2).
- **Slice 2 deferrals**: microphone / `SpeechRecognition` (AC-F6-2), server-side `agUiUploadHandler` route (AC-F6-5 hardening), per-backend wire-shape translation.
- See the [multi-modal-input cookbook](../../docs/cookbook/multi-modal-input.md).

### Tests

**93 → 287 lib tests** (+194). New coverage includes:

- F1: composition-expression parser (74), agentic-form factory + composition (16), form-renderer composition + AC-F1-2 (14), composition-store (22).
- F2: data-source-registry typed + missing (8), agentic-widget data-sources (3), data-source-registry telemetry (4), form-renderer F2 mount validation (2).
- F3: agentic-workflow factory (8), workflow-renderer state machine + AC-F3-1/2/3 (10).
- F4: agentic-approval factory (8), approval-registry policy + state + audit hook (16), runUntilSettled F4 intercept (4).
- F5: operation-registry lifecycle + audit hook (15), runUntilSettled F5 ToolContext surface (3), operation-progress widget (5).
- F6: inject-agentic-chat multimodal (5).

### Architecture decisions

- [ADR-009 — Approval intercept on `executeClientTools`; fire-and-forget audit hook](../../docs/adr/0009-approval-intercept-and-audit-hook.md). Records the three architectural decisions baked into F4: client-side intercept + synthetic queued result (no paused turns), fire-and-forget audit hook (no rollback on hook failure), distributed persona check (card + queue, NOT centralised in registry).

### Documentation

- Six new cookbook entries (one per capability): [composable-intake-form](../../docs/cookbook/composable-intake-form.md), [widgets-with-live-data](../../docs/cookbook/widgets-with-live-data.md), [interactive-workflows](../../docs/cookbook/interactive-workflows.md), [approval-flow](../../docs/cookbook/approval-flow.md), [long-running-operations](../../docs/cookbook/long-running-operations.md), [multi-modal-input](../../docs/cookbook/multi-modal-input.md).
- README "Use cases" matrix expanded 10 → 16 rows; USER_GUIDE matches.
- New plan document: [r3 enterprise solution specification](../../docs/plans/ediscovery-dynamic-ui-plan.md) — full program plan with NFRs, threat model, capability G/W/T acceptance criteria, observability + test + release + cost + ops sections, risk register, phase gates with exit criteria.
- New gate document: [Phase A PRR](../../docs/plans/phase-a-prr.md) — production-readiness review covering F1 + F2 (the first phase boundary).

### eDiscovery flagship updates

- New tools: `openCustodianIntake` (F1 form-card surface), `openPlaceLegalHoldWorkflow` (F3 wizard), `runTARClassifier` (F5 long-running).
- New routes: `/approvals` (F4 queue page), `/operations` (F5 in-flight + recent panel). Both with sidebar nav badges.
- Approval policies wired for `exportProductionSet` (lead-counsel-only) and `releaseLegalHold` (lead-counsel + associate). Audit hook translates every transition into the existing chain primitive.
- Custodian intake is now composition-mode; supervisor picker autocompletes from the new `users` data source.

### Compatibility

- No breaking changes vs 1.1.x.
- Existing tools / widgets / forms / backends continue to work unchanged.
- New `ToolContext` fields are additive; existing tool handlers ignoring them compile + run unmodified.
- `AgenticMessage.content` widening from `string` to `string | readonly MessageContent[]` is structurally compatible — every existing read path that assumes string is type-narrowed at the call site.

## [1.1.0] — 2026-05-01

This minor release lands the **MCP server-side adapter**, **federation scaling primitives**, and **three registry-governance hooks** (`conflictPolicy`, `onDispose`, and the new `setScopePolicy`). All additions are opt-in and backward-compatible — existing 1.0.0 consumers see zero behaviour change without explicit provider changes.

The release is anchored by the **eDiscovery flagship reference application** (`examples/demo-ediscovery-*`) which exercises every feature listed below at enterprise load — 18 tools across 4 specialists, 3 federated MFE remotes plus an MCP server, all 13 registries, tamper-evident audit chain, persona-scoped tool surface.

### Added

#### MCP server-side adapter (companion package)

- **`ToolResultRenderHints` interface** — new type in `@maverick/agentic-ui` exposing the canonical render-hint shape: `components` (existing), `markdown`, `image_url`, **`html`** (active — MCP UI hosts iframe-render it), plus reserved `iframe_url` for a future patch. Purely additive — no breakage to any existing tool. See [ADR-006](../../docs/adr/0006-mcp-server-side-adapter.md).
- Companion package **`@maverick/agentic-ui-mcp`** ships separately, exposes any `ToolDef[]` as a Model Context Protocol server (Claude Desktop / Cursor / Zed / Continue / Windsurf). See its [CHANGELOG](../agentic-ui-mcp/CHANGELOG.md) and the [cookbook entry](../../docs/cookbook/mcp-server.md).

#### Federation scaling
- **`prefetchCapabilities({ remote, injector })`** — fetch a remote's `capabilities.json` over HTTP and register a metadata-only `CapabilityDef` with `CapabilityRegistry`, **without loading the federation bundle**. Lets the host build system prompts and run tool filters against tool/component names from 50+ remotes without paying multi-MB boot cost. URL is derived from `remoteEntry.json` by convention or set explicitly via `RemoteSpec.capabilityManifestUrl`.
- **`provideToolFilter(filter)` + `keywordToolFilter(config)` + `ToolFilter` type + `TOOL_FILTER` injection token** — narrow the tool list per turn before sending to the agent. Default is identity (no break). The reference `keywordToolFilter` scores tools by `name + description` overlap against the user's last message and returns the top-N. See [Federation at scale](../../docs/cookbook/federation-at-scale.md).

#### Registry governance
- **`ConflictPolicy` type + `RegistryBase.conflictPolicy` field** — strategy on duplicate-name registration. `'replace'` (default — backward-compatible), `'throw'` (fail-loud), `'first-wins'` (keep existing), `'namespace'` (auto-prefix new entry with its remote source). Set per-registry via `inject(ToolRegistry).conflictPolicy = 'throw'`.
- **`RegistryEntry.onDispose?`** — optional cleanup hook fired when an entry is removed (explicit disposer, `removeBySource()`, or replacement under `'replace'` policy). Errors caught and routed to telemetry — one bad hook can't poison a teardown sweep.
- **`RegistryEntry.scopes?: readonly string[]` + `RegistryBase.setScopePolicy(policy)`** — opaque governance tags per entry plus a hook that filters every `list()` / `get()` / `signal()` read. `permissiveScopePolicy` (default — every entry visible) and `activeScopePolicy(getActive)` (closes over a getter, checks `getActive()` against `entry.scopes`) ship as convenience exports. `getRaw` / `listRaw` bypass for tooling and `register()`'s collision detection. Filter on **read**, not register, so federated remotes contributing scope-tagged entries stay portable across users with different active scopes. See [ADR-008](../../docs/adr/0008-registry-scope-policy.md).
- New telemetry event names: `agentic.registry.dropped`, `agentic.registry.namespaced`, `agentic.registry.dispose_failed`, `agentic.registry.scope_policy_set`.

### Tests

- **76 → 93 tests** (+17). New tests cover all four conflict policies, the `onDispose` lifecycle (explicit disposer, `removeBySource` sweep, replacement-fires-displaced-disposer, throwing-onDispose-doesn't-poison-sweep), plus eight new tests for the scope-policy primitive (default-permissive, hides on policy reject, `get()` honours policy, `getRaw`/`listRaw` bypass, `register()` collides against hidden entries, signal recompute on policy change, `activeScopePolicy` over a getter — both with and without scope-less entries).

### Documentation

- New cookbook entries:
  - [Production deployment](../../docs/cookbook/production-deployment.md) — `ThreadStateStore` adapter sketches (Redis / Postgres), rate-limiting, K8s liveness, going-to-prod checklist.
  - [Federation at scale](../../docs/cookbook/federation-at-scale.md) — capability prefetch + tool filter pattern with sequence diagram and per-50-remotes performance budget.
  - [Sample prompts](../../docs/cookbook/sample-prompts.md) — canonical prompts for every demo and every registry, plus adversarial / boundary prompts.
  - [Extended registries — feature tour](../../docs/cookbook/extended-registries-feature-tour.md) — Action / Form / DataSource / Intent registries demonstrated by `demo-feature-tour`.
  - [Integrate into an existing Angular app](../../docs/cookbook/integrate-into-existing-angular-app.md) — 4-phase guide with sequence + flow diagrams.
  - [Domain MFEs as standalone apps + capability providers](../../docs/cookbook/domain-mfe-standalone-and-federated.md).
  - [Schematics reference](../../docs/cookbook/schematics.md).
- New architecture doc: [Registries vs. industry](../../docs/architecture/registries-vs-industry.md) — comparison against agent SDKs (CopilotKit, LangChain, Vercel AI) and plugin platforms (VS Code, Backstage); governance integration map onto `RegistryBase`. **Permission scopes row moved from "gap" to ✅ shipped.**
- ADR-002 updated to reference `conflictPolicy` and `onDispose`.
- [ADR-008 — Registry scope policy](../../docs/adr/0008-registry-scope-policy.md): design rationale for `setScopePolicy`, the filter-on-read decision, before/after migration of the eDiscovery shell, trade-offs, and risks. Status: Accepted (shipped).
- Every code-generating schematic template now ships with JSDoc explaining the contract.

### Examples

- New `examples/demo-feature-tour` (port 4206) — single-host showcase for the four extended registries (Action / Form / DataSource / Intent).
- All demos relocated `projects/demo-*` → `examples/demo-*`. `projects/` now holds only the publishable libraries. (No consumer-facing impact; affects `git clone` users only.)
- The three MFE remotes (`demo-remote-bookings`, `demo-remote-loyalty`, `demo-remote-support`) gained functional standalone UIs at their own ports (`:4201` / `:4203` / `:4205`) that reuse the same handlers and widget components the host's chat consumes — proving each remote is a complete domain artefact, not a chat-only shim.
- **🏛 eDiscovery flagship reference application** (Phases 0–8 of the [eDiscovery plan](../../docs/plans/ediscovery-app-plan.md)) under `examples/demo-ediscovery-{shared,server,shell,review,production,search,mcp}/`:
  - 18 tools across 4 specialists (`collection`, `review`, `production`, `search`) under one `OrchestratorAgent` with sticky-by-thread routing.
  - 3 federated MFE remotes (review, production, search) plus an MCP server (`@maverick/demo-ediscovery-mcp`) for analyst workstations.
  - All 13 registries exercised: tools, components, capabilities, backends, MFE registry, actions (click-to-navigate), forms (`productionConfigForm`), data sources (`documentIndex`), validation (Bates pattern), persistence (sessionStorage persona), schema transformer (Zod schemas everywhere).
  - Tamper-evident audit chain (`appendAudit` auto-stamps `chainHash` + `prevHash`); `generateChainOfCustodyReport` tool + widget render the chain with hash recompute on hover.
  - Persona-scoped tool surface — 5 personas with allow-listed tools, wired through the new `RegistryBase.setScopePolicy()` API.
  - Production-build ~44 KB initial transfer (gzip 15 KB); each route lazy-loaded as its own chunk.

### Companion library

`@maverick/agentic-ui-server` (separate npm package — server-side):
- **`ThreadStateStore<TState>` interface + `InMemoryThreadStateStore` default** — externalisable per-thread state. Drop in a Redis or Postgres adapter for multi-pod deployments. Documented in the production-deployment cookbook.
- **`createSpecialist({ id, factory, description, examples })` + `registerSpecialists(map, specs)`** — bundle "construct agent + write `SubAgentSpec`" into one call. Cuts ~30 lines of orchestrator boilerplate per specialist.

### Notes

- All additions are **opt-in and backward-compatible**. Existing 1.0.0 consumers see zero behaviour change without explicit provider changes.
- Minor release per SemVer — no breaking API changes vs 1.0.0.
