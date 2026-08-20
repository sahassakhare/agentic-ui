# Changelog

All notable changes to `@infra-tools/agentic-ui` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0]

Consolidates the features landed since `1.4.0` (which shipped without a changelog entry) plus the new catalog-connect schematic.

### Added — `connect-studio` schematic

- **`ng g @infra-tools/agentic-ui:connect-studio`** (alias `cs`) wires an existing standalone Angular app to an Experience Studio catalog backend. It scaffolds a self-contained `src/app/catalog-runtime/` bridge — a `CatalogClient` (HTTP + one pooled SSE stream), pure compile helpers, and five `Catalog*Source` services that compile catalog rows into the runtime registries (`ExperienceRegistry`, `FormRegistry`, `DataSourceRegistry`, `ToolRegistry`) — and patches `app.config.ts` with `provideCatalogRuntime({ baseUrl, tenant })`. Decoupled from any host auth/config via `CATALOG_CONFIG` / `CATALOG_AUTH` injection tokens (default disabled; OIDC by supplying a token). Snapshot-tested.

### Added — design-token system

- **`kind:'theme'` design tokens** authored per-application and applied across every surface (the token designer + `TokenSet` shape). Themes hot-swap live over the catalog SSE stream.

### Added — workflow decisions

- **`DecisionNext` + `AGENTIC_DECISION_EVALUATOR`** seam lets a workflow step branch on a governed decision table (`provideDecisionEvaluator`, `resolveNextAsync`, `isDecisionNext`).

### Added — type-aware MFE remote loader

- **`createRemoteLoader(remote)`** dispatches by remote `type` — Native Federation loads directly by `remoteEntry` URL (so remotes discovered at runtime load without a rebuilt boot manifest); Module Federation 1.0/2.0 remotes load via an optional `@module-federation/runtime` peer. `RemoteSpec` gains an optional `type` field.

### Changed

- `LIB_VERSION` synced to `1.5.0` (was drifted at `1.3.0`) so host-version compatibility checks reflect the published version.

## [1.3.0]

### Added — MCP Apps (SEP-1865) inbound rendering

- **`<mvk-mcp-ui-resource>` now renders the MCP Apps SEP** alongside the legacy MCP-UI convention. A resource with `mimeType: 'text/html;profile=mcp-app'` (new exported `MCP_UI_APP_MIME`) renders as a sandboxed `srcdoc` iframe that speaks **JSON-RPC 2.0 over `postMessage`** instead of the legacy `{source:'mcp-ui', action}` envelope. Outbound (`@infra-tools/agentic-ui-mcp`) and inbound now both speak the SEP.
- **`McpUiActionBridge.handleAppRpc(message, respond)`** — the host side of the SEP `ui/*` action channel, scope-gated through the same `ToolRegistry` policy as the legacy channel:
  - `ui/initialize` → host-capabilities handshake; the renderer then pushes the resource's optional `data` as a `ui/notifications/tool-result` (SEP presentation/data separation).
  - `tools/list` / `tools/call` → only scope-visible tools; unknown/forbidden tools return an `isError` result without leaking existence.
  - `ui/open-link` → router/external navigation; `ui/update-model-context` → delegated to the host handler.
- **New `data` field on `McpUiResource`** carries the SEP `structuredContent` pushed to the iframe after initialize. New exports: `MCP_UI_APP_MIME`, `mcpAppRpcRequestSchema`, types `McpAppRpcRequest` / `McpAppRpcResponse`.
- Backward-compatible: legacy `text/html` + the `{source:'mcp-ui', action}` protocol are unchanged.

### Changed

- `LIB_VERSION` bumped to `1.3.0` (was out of sync at `1.1.0`) so host-version compatibility checks reflect the published version.

### Changed — native Hashbrown integration

- **`HashbrownBackend` is now a real client of `@hashbrownai/core`** (added as an optional peer dependency). It sends a `Chat.Api.CompletionCreateParams` request (`operation` / `model` / `system` / `messages` / `tools`) and decodes the SDK's length-prefixed frame stream (`[4-byte BE length][UTF-8 JSON]`) via `decodeFrames`, mapping `generation-chunk` / `generation-finish` / `generation-error` frames to canonical `AgenticEvent`s. The matching reference server (`examples/demo-server`) emits those frames via `encodeFrame`.
- ⚠️ **BREAKING (Hashbrown adapter only)**: the request body changed from the canonical `{ messages, tools, state }` shape to `Chat.Api.CompletionCreateParams`, and the response is now a Hashbrown frame stream rather than canonical `AgenticEvent` NDJSON. Servers written against the v1.2.2 Hashbrown adapter must adopt the Hashbrown wire (or copy the reference server). AG-UI and A2UI adapters are unchanged.
- Note: `state` (ADR-013) is not part of Hashbrown's `CompletionCreateParams`; for this backend, host reasoning context is conveyed through `system` / `messages`.

### Fixed

- MCP-UI mime alignment: the `@infra-tools/agentic-ui-mcp` server now emits `text/html` (was `text/html;profile=mcp-app`) with a `ui://` URI, matching this package's inbound `MCP_UI_HTML_MIME` so server output round-trips through the renderer. See that package's changelog.

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
- Secondary entry imports (`@infra-tools/agentic-ui/ag-ui`, `/hashbrown`, `/a2ui`, `/mfe`, `/mfe-module-federation`, `/otel`, `/testing`, `/components`) have been collapsed into the primary entry. Migration: `import { X } from '@infra-tools/agentic-ui/<sub>'` → `import { X } from '@infra-tools/agentic-ui'`.

### Known limitations
- `@angular-architects/native-federation` `includeSecondaries: true` does not emit per-secondary-entry chunks — this is *why* the lib is single-entry. Re-evaluate if/when fixed upstream.
- Webpack Module Federation runtime API is shipped (`loadRemoteCapabilitiesMF`) but the working-demo apps for that path are not in this release; the runtime API matches the Native Federation surface.
- A2UI adapter targets spec version `0.x`. Track the upstream spec for breaking changes.

## [Unreleased]

### Added — runtime ↔ platform integration (audit Gaps 4 / 1 / 3 / 2)

Closes the four runtime-tier integration gaps from the
[2026-05-10 platform audit](../../docs/audit/2026-05-10-platform-audit.md).
Before this slice the runtime tier shipped only **2 of 6** adapters
that talk to the catalog server (`provideCatalogActivePersona` +
`RestMfeRegistrySource`); a consumer app integrating the platform
reached for `curl` for everything else. After this slice, **one
provider line** wires every adapter:

```ts
provideAgenticPlatform({
  catalogUrl: 'https://catalog.example.com',
  tenantId: 'acme',
  getToken: () => oidc.getAccessToken(),
  personaResolver:       { defaultPersona: 'paralegal' },
  mfeRegistry:           { refreshIntervalMs: 30_000 },
  capabilityRegistrar:   {},     // Gap 1 — auto-POST tools/widgets at boot
  capabilityAuthorizer:  {},     // Gap 3 — catalog disables hide entries
  usageMetering:         {},     // Gap 2 — telemetry → POST /usage
})
```

Every feature is **opt-in via per-key options**; passing `false`
or omitting the key skips it. Apps that want only IAM persona
resolution still pass exactly one provider — they just leave the
other keys off.

#### `provideAgenticPlatform` — single config point (Gap 4 / [ADR-031](../../docs/adr/0031-provide-agentic-platform.md))

- New composite provider in `@infra-tools/agentic-ui` that wires
  `provideCatalogActivePersona` + `provideRestMfeRegistry` +
  (newly added) capability registrar / authorizer / usage metering
  under one shared `catalogUrl` / `tenantId` / `getToken`.
- `tenantId` accepts `string | (() => string)` for hosts that
  derive tenant from a subdomain or route param.
- `mvk new app --with-platform` scaffold flag generates an
  `app.config.ts` pre-wired with `provideAgenticPlatform`. CLI
  validates `--catalog-url` is set (or `MVK_CATALOG_URL` /
  `mvk login` config).

#### `provideCatalogCapabilityRegistrar` — auto-register at boot (Gap 1 / [ADR-032](../../docs/adr/0032-catalog-capability-registrar.md))

- Walks `ToolRegistry` + `ComponentRegistry` on Angular bootstrap;
  POSTs each entry to `POST /v1/catalogs/{tenant}/capabilities`.
- Idempotent via the catalog's existing `(tenant_id, kind, name)`
  UNIQUE constraint — repeat boots see 409 per entry, treated as
  success.
- Fire-and-forget — boot never blocks on the catalog round trip;
  `CatalogCapabilityRegistrarService.results()` exposes per-entry
  sync outcomes for devtools / status badges.
- `includeRemotes: false` by default (federated MFE remotes
  self-register through their own bootstrap); `true` for monolith
  federation where the host owns catalog identity.
- Closes [ADR-025](../../docs/adr/0025-ediscovery-demo-seed.md)
  drift — the eDiscovery seed becomes a starter, not a permanent
  hand-curated mirror.

#### `provideCatalogCapabilityAuthorizer` — catalog-as-allowlist (Gap 3 / [ADR-033](../../docs/adr/0033-catalog-capability-authorizer.md))

- Fetches `?lifecycle=disabled` from the catalog at boot, polls
  every 30s; installs a **composing** scope policy on
  `ToolRegistry` + `ComponentRegistry` that AND's the catalog's
  deny-list with whatever scope policy the host already wired
  (e.g. `activeScopePolicy(persona)`).
- New public `RegistryBase.currentScopePolicy()` accessor — hosts
  composing multiple policies (persona + catalog + custom flag)
  read the existing one without reaching into the private signal.
- **Default-allow** on initial-fetch failure — catalog outage
  doesn't break the consumer app. Apps that want strict
  closed-allowlist semantics opt in via
  `onInitialFetchFailure: 'deny'`.
- An operator who toggles a capability to `disabled` in the ops
  console sees the runtime stop offering it within ~30s. SSE-based
  live updates documented as out-of-scope follow-up.

#### `provideCatalogUsageMetering` — telemetry-driven usage events (Gap 2 / [ADR-034](../../docs/adr/0034-catalog-usage-metering.md))

- Wraps `AGENTIC_TELEMETRY_SINK` so every `agentic.tool_call.*`
  span end (note: end, not start — captures success/failure),
  `agentic.widget.render`, and `agentic.federation.load.end`
  becomes a usage event posted asynchronously to
  `POST /v1/catalogs/{tenant}/usage`.
- Skips HITL approval-queued tool calls (they didn't actually
  run).
- Background batch flush — default 5s interval, 100-event cap;
  bounded memory, bounded round-trip count.
- `delegate` option preserves the host's existing telemetry sink:
  pass `{ delegate: myCustomSink }` and your sink keeps receiving
  every event alongside catalog metering.

#### Server-side: `POST capabilities` returns 409 (not 500) on duplicate

- The catalog's create-capability route now pre-checks
  `(kind, name)` and returns 409 + RFC-7807 `Conflict` problem on
  duplicate, instead of letting the postgres unique-violation
  propagate as 500. Mirrors the existing pattern in `tenants.ts`.
  Required for the registrar's "treat 409 as success" idempotency
  contract.

### Tests

**408 → 441 lib tests** (+33). New coverage:

- Gap 4 composite provider: 8 TestBed tests (no-feature, persona-only,
  mfe-only, both-on, explicit `false`, dynamic-tenant function,
  registrar wiring through composite, authorizer wiring through
  composite, metering wiring through composite).
- Gap 1 registrar: 9 tests (3 payload-mapping + 6 wiring: boot POST,
  409 idempotency, server-failure, host-only filter, AUTH_MODE
  disabled, empty-registry safety).
- Gap 3 authorizer: 7 tests (compose with persona, closed-allowlist,
  hide disabled entries, default-allow on fetch failure, deny on
  fetch failure, polling cadence, compose ordering).
- Gap 2 metering: 7 tests (tool-call queue, approval-queued skip,
  widget/federation events, delegate forwarding, time-based flush,
  size-based flush, failed-POST counter).

CLI: 49 → 53 tests (+4 covering `--with-platform`).
Catalog: 164 → 165 tests (+1 covering 409 on duplicate).
**Total: 718/718 passing across all four suites.**

### Architecture decisions

- [ADR-031 — provideAgenticPlatform single config point](../../docs/adr/0031-provide-agentic-platform.md)
- [ADR-032 — Catalog capability registrar](../../docs/adr/0032-catalog-capability-registrar.md)
- [ADR-033 — Catalog capability authorizer](../../docs/adr/0033-catalog-capability-authorizer.md)
- [ADR-034 — Catalog usage metering](../../docs/adr/0034-catalog-usage-metering.md)

### Compatibility

- No breaking changes. All four providers are opt-in; consumer
  apps that don't call `provideAgenticPlatform` (or call it
  without the new feature switches) see zero behaviour change.
- `provideCatalogUsageMetering` does replace `AGENTIC_TELEMETRY_SINK`
  when wired, but the new `delegate` field exists exactly to
  preserve the host's existing sink — migration is "move your
  sink into `delegate`."
- New public API surface: `RegistryBase.currentScopePolicy()` —
  thin getter, no behavioural change.

### eDiscovery flagship updates

- **Reference platform integration shipped.** The eDiscovery shell
  ([`examples/demo-ediscovery-shell`](../../examples/demo-ediscovery-shell/))
  now wires `provideAgenticPlatform` conditionally: local dev
  (`environment.catalogUrl: undefined`) stays fully embedded with
  zero catalog round trips, the Render prod build
  (`https://agentic-catalog-server.onrender.com`) self-registers
  its tool / widget surface at boot and honours
  `lifecycle: 'disabled'` operator toggles within ~30s. Closes
  the [ADR-025](../../docs/adr/0025-ediscovery-demo-seed.md)
  drift surface flagged as Gap 1 in the
  [2026-05-10 platform audit](../../docs/audit/2026-05-10-platform-audit.md).
- **Initializer ordering.** `bootAgenticCapabilities()` and
  `installPersonaScopePolicy()` moved from `provideAppInitializer`
  to `provideEnvironmentInitializer` so the registrar's environment
  initializer sees the populated registries and the authorizer's
  policy composes onto the persona policy (not vice-versa). Pure
  refactor — no behavioural change for consumers. See ADR-025's
  2026-05-10 update.
- **`personaResolver`, `mfeRegistry`, `usageMetering` deliberately
  not yet enabled** for the eDiscovery shell — the persona dropdown
  is a UI demo concern, the static-JSON MFE registry is a separate
  migration, and the existing console / OTel telemetry sink is
  preserved. Each is straightforward to opt into when needed.

### Added — post-chat-surfaces program (P0–P5)

The agent escaped the chat rail across six phases from the
[post-chat-surfaces plan](../../docs/plans/post-chat-surfaces-plan.md).
Three new registries land in the Extended tier (15 → 18), 16 new
dispatch-agnostic widgets, one new service (`PlaybookRunner`), one
new helper (`TileResultCache`). All additions are opt-in and
backward-compatible — existing 1.x consumers see zero behaviour
change without explicit wiring.

#### P0 — Persona-shaped workspace layouts ([ADR-043](../../docs/adr/0043-layout-registry-promotion.md))

- **`LayoutRegistry` promoted** from Seam to Extended tier. New
  `LayoutDef` shape: `name`, `mode` (`'rail' | 'split' | 'workspace' | 'assist-panel' | 'fullscreen'`),
  `slots: SlotDef[]`, optional responsive breakpoints. Existing
  `LayoutRegistry.register` calls keep working — the new fields are
  additive.
- **`<mvk-workspace-layout>`** — renders any registered `LayoutDef`
  via CSS Grid + Angular content projection by `slot=` attribute.
  ResizeObserver-driven slot resizing, collapsible chat slot.
- **`provideLayoutPolicy({ default, perPersona })`** + **`LAYOUT_POLICY`**
  InjectionToken — host-wide layout default + per-persona overrides.
  Chat shell reads the policy without knowing anything about
  personas.
- **`layout-render` event** — LLM-emittable mid-turn layout swap;
  Zod-validated at the boundary, fallback + console warning on
  invalid input.

#### P1 — In-context agent affordances

Five dispatch-agnostic components — every one emits a typed
`(action)` event the host wires to its dispatcher. No component
knows about routes / actions / mutators directly.

- **`<mvk-cmd-k-palette>`** — ⌘K / Ctrl+K command palette. Resolves
  free-text → `IntentRegistry` matches → `ToolRegistry` fallback.
  Recent + pinned sections, keyboard navigation, persona-filtered.
- **`<mvk-smart-cell>`** — single-cell agent-computed table value.
  Names a tool to invoke; renders loading / result / error. Persona
  scope filters at the cell level — no access renders a "no access"
  stub, not 403.
- **`<mvk-row-action-menu>`** — kebab menu populated from
  `IntentRegistry` filtered by `context: 'row'`.
- **`<mvk-bulk-toolbar>`** — selection-aware toolbar that
  materialises when N rows are selected; `IntentRegistry` entries
  with `context: 'bulk-selection'`.
- **`<mvk-assist-panel>`** — Cursor-pattern structured affordance
  panel over a free-text chat area.

#### P2 — Proactive triggers + inbox ([ADR-045](../../docs/adr/0045-trigger-registry.md))

- **`TriggerRegistry`** — 16th registry. `TriggerDef` carries
  discriminated `spec` (`'cron' | 'webhook' | 'queue'`) and
  discriminated `target` (`'tool' | 'action' | 'notification'`
  with a `compose(ctx)` callback returning a `NotificationDraft`).
- **`provideTriggerRunner({...})`** — browser-side cron runner;
  webhook + queue targets defer to a future server-side runner.
  Every firing chain-hashes with `origin: 'trigger'` + the
  trigger's `runAs` persona.
- **`<mvk-notification-tray>`** — bell + unread badge + dropdown.
- **`<mvk-inbox>`** — full-page route widget with filters + CTAs
  (route / action / tool buttons) + bulk-mark-read.
- **`<mvk-lifecycle-stages>`** — multi-stage horizontal lifecycle
  widget for `Operation`-backed long-running flows.

#### P3 — User-built + conversational + live dashboards ([ADR-044](../../docs/adr/0044-dashboard-registry.md))

- **`DashboardRegistry`** — 17th registry. `DashboardDef` composes
  `TileDef[]` over a `LayoutRegistry`-named layout, optional
  `FilterDef[]` for cross-matter parameter threading, `version` +
  `parentVersion` for revision history.
- **`TileInvocation`** discriminated union: `kind: 'tool'`
  (re-invokes the tool, chain-hashed), `kind: 'data'` (re-queries a
  `DataSourceRegistry` source, no audit), `kind: 'static'` (literal
  props).
- **`<mvk-dashboard-tile>`** + **`<mvk-dashboard-canvas>`** +
  **`<mvk-dashboard-preview>`** — single-tile, full-canvas, and
  editable-preview surfaces.
- **`TileResultCache`** — singleton cross-instance cache keyed by
  `tileCacheKey()` (stable-sorted JSON). `cacheTtlMs` per tile,
  `refreshOn: 'event'` for push-driven refresh,
  `drilldown: { route | tool | action }` for the click-through.
- **`bumpDashboardVersion(prev, draft)`** helper for the
  edit-creates-vN+1 / `parentVersion` chain.
- Persona-blocked tiles render as "no-access" stubs, not 403s, not
  silent omissions.

#### P4 — Workflow surfaces

Three purpose-built widgets, each composing existing registries
with workflow-specific UI semantics:

- **`<mvk-review-queue>`** (Workflow E) — multi-reviewer queue;
  `(decision)` events for approve / reject / escalate; audit chain
  shape `tool-approved` / `tool-rejected` (same as F4 approvals).
- **`<mvk-timeline-canvas>`** (Workflow D) — investigation timeline
  with severity coding + drill-in panels.
- **`<mvk-cal-workbench>`** (Workflow C) — Continuous Active
  Learning training loop with bulk labelling + classifier-refresh
  round trips.

#### P5 — Versioned tool-call playbooks

- **`PlaybookRegistry`** — 18th registry. `PlaybookDef` carries
  `name` / `title` / `version` / `parentVersion?` / `description` /
  persona scope / `steps: PlaybookStep[]`.
- **`PlaybookStep`** with two opt-in modifiers:
  `requiresApproval: true` halts on an Approve / Skip gate before
  invoking, `continueOnError: true` keeps the run going past a
  failed step (overall ends `'failed'` regardless).
- **`PlaybookRunner`** (`providedIn: 'root'` service). `start(def)`
  returns a `RunningPlaybook` handle exposing a signal-backed live
  `state`, a terminal-state `done` promise, and
  `cancel()` / `approve()` / `skip()` methods. Persona-blocked
  tools (`ToolRegistry.get` returns `undefined`) record the step
  as failed with *"tool not visible to this persona"* — no
  silent-drop semantics.
- **`<mvk-playbook-runner>`** — renders the live state with
  per-step status pill, inline error, Result disclosure, Approve /
  Skip / Cancel buttons surfacing on the right steps.
- Every step chain-hashes through audit with `origin: 'playbook'` +
  playbook name + version + step index.

#### Post-P5 — Federation symmetry + scaffolding parity

- **`defineCapabilityModule` extended** to federate the three new
  registries symmetrically: `triggers?` / `dashboards?` /
  `playbooks?` options + matching `CapabilityManifest.exposes`
  index fields. `apply()` injects the three registries via DI only
  when the module contributes entries of that kind (tree-shaking
  honest). Disposer calls `removeBySource` on every contributed
  registry. Federation symmetry now applies to all 18 registries.
- **Three new schematics** in the published collection: `ng g
  @infra-tools/agentic-ui:trigger | dashboard | playbook`. Trigger
  generator emits the correct `kind` × `targetKind` discriminator
  shape at template time (no boilerplate placeholders for unused
  kinds). Snapshot-tested.

### Tests — post-chat-surfaces program

**441 → 811 lib tests** (+370 across P0–P5 + federation symmetry +
schematics specs). Coverage by phase:

- P0 layout: workspace-layout component + slot resizing + layout
  policy (per-persona overrides + LLM `layout-render` event
  validation).
- P1 affordances: cmd-k-palette resolution + scope, smart-cell
  persona filter + state transitions, row-action-menu + bulk-toolbar
  emission, assist-panel structured affordances.
- P2 triggers: trigger-registry CRUD + persona scope + manifest
  exposes; provide-trigger-runner cron firing + audit chain
  attribution; notification-tray + inbox signal-driven render;
  lifecycle-stages multi-stage progression.
- P3 dashboards: dashboard-registry + version chain;
  dashboard-tile / canvas / preview rendering; TileResultCache key
  invariants + TTL + push refresh; persona-blocked stub rendering.
- P4 workflows: review-queue + timeline-canvas + cal-workbench —
  signal-backed host fields, decision emission, severity coding,
  CAL classifier-refresh round trip.
- P5 playbooks: playbook-registry; PlaybookRunner happy path +
  approval gate + continueOnError + cancellation + persona-blocked;
  mvk-playbook-runner component (empty state, status pills, action
  emissions, error rendering, Result disclosure).
- Post-P5: capability-module federation symmetry (manifest exposes,
  source tagging, apply() across all 18 registries, disposer reap,
  host-sourced entries survive remote unload, explicit-registries
  apply path); schematics snapshot tests for trigger × 3
  (cron/tool default, webhook/notification, queue/action), dashboard
  × 1, playbook × 1.

**All 18 registries exercised; ADR-010 D4 zero-breaking-changes
contract held.**

### Architecture decisions — post-chat-surfaces program

- [ADR-043 — Layout registry promotion](../../docs/adr/0043-layout-registry-promotion.md) (**Accepted**)
- [ADR-044 — Dashboard registry](../../docs/adr/0044-dashboard-registry.md) (**Proposed**)
- [ADR-045 — Trigger registry](../../docs/adr/0045-trigger-registry.md) (**Proposed**)

### Documentation — post-chat-surfaces program

16 new cookbook entries plus README + USER_GUIDE refresh:

- [agent-directed-workspace-layouts](../../docs/cookbook/agent-directed-workspace-layouts.md) (P0)
- [cmd-k-palette](../../docs/cookbook/cmd-k-palette.md) +
  [smart-cell](../../docs/cookbook/smart-cell.md) +
  [row-action-menu](../../docs/cookbook/row-action-menu.md) +
  [bulk-toolbar](../../docs/cookbook/bulk-toolbar.md) +
  [assist-panel](../../docs/cookbook/assist-panel.md) (P1)
- [proactive-triggers-and-inbox](../../docs/cookbook/proactive-triggers-and-inbox.md) +
  [lifecycle-stages](../../docs/cookbook/lifecycle-stages.md) (P2)
- [dashboards](../../docs/cookbook/dashboards.md) +
  [conversational-dashboards](../../docs/cookbook/conversational-dashboards.md) +
  [live-dashboards](../../docs/cookbook/live-dashboards.md) (P3)
- [review-queue](../../docs/cookbook/review-queue.md) +
  [timeline-canvas](../../docs/cookbook/timeline-canvas.md) +
  [cal-workbench](../../docs/cookbook/cal-workbench.md) (P4)
- [playbooks](../../docs/cookbook/playbooks.md) (P5)
- [schematics reference](../../docs/cookbook/schematics.md) — three
  new generator sections (trigger / dashboard / playbook)
- README §Features + §Use cases (rows 17–22) + §Documentation +
  Architecture diagrams refreshed for 18 registries / 13 generators
- USER_GUIDE §17–§22 walkthroughs + matrix table refreshed for the
  six new in-app pillars

### eDiscovery flagship updates — post-chat-surfaces program

**Deferred — waits on Render redeploy** (the flagship's runtime
host is currently unstable). The library tier is fully shipped and
demoable in isolation; the eDiscovery wiring (cross-matter
dashboards, "Initial Privilege Pass v3" playbook, etc.) lands when
the host is back. The plan's §9 P0–P5 acceptance criteria all read
against the library, not the demo, so this defer doesn't block the
program from being declared shipped at the library tier.

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

- **`ToolResultRenderHints` interface** — new type in `@infra-tools/agentic-ui` exposing the canonical render-hint shape: `components` (existing), `markdown`, `image_url`, **`html`** (active — MCP UI hosts iframe-render it), plus reserved `iframe_url` for a future patch. Purely additive — no breakage to any existing tool. See [ADR-006](../../docs/adr/0006-mcp-server-side-adapter.md).
- Companion package **`@infra-tools/agentic-ui-mcp`** ships separately, exposes any `ToolDef[]` as a Model Context Protocol server (Claude Desktop / Cursor / Zed / Continue / Windsurf). See its [CHANGELOG](../agentic-ui-mcp/CHANGELOG.md) and the [cookbook entry](../../docs/cookbook/mcp-server.md).

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
  - 3 federated MFE remotes (review, production, search) plus an MCP server (`@infra-tools/demo-ediscovery-mcp`) for analyst workstations.
  - All 13 registries exercised: tools, components, capabilities, backends, MFE registry, actions (click-to-navigate), forms (`productionConfigForm`), data sources (`documentIndex`), validation (Bates pattern), persistence (sessionStorage persona), schema transformer (Zod schemas everywhere).
  - Tamper-evident audit chain (`appendAudit` auto-stamps `chainHash` + `prevHash`); `generateChainOfCustodyReport` tool + widget render the chain with hash recompute on hover.
  - Persona-scoped tool surface — 5 personas with allow-listed tools, wired through the new `RegistryBase.setScopePolicy()` API.
  - Production-build ~44 KB initial transfer (gzip 15 KB); each route lazy-loaded as its own chunk.

### Companion library

`@infra-tools/agentic-ui-server` (separate npm package — server-side):
- **`ThreadStateStore<TState>` interface + `InMemoryThreadStateStore` default** — externalisable per-thread state. Drop in a Redis or Postgres adapter for multi-pod deployments. Documented in the production-deployment cookbook.
- **`createSpecialist({ id, factory, description, examples })` + `registerSpecialists(map, specs)`** — bundle "construct agent + write `SubAgentSpec`" into one call. Cuts ~30 lines of orchestrator boilerplate per specialist.

### Notes

- All additions are **opt-in and backward-compatible**. Existing 1.0.0 consumers see zero behaviour change without explicit provider changes.
- Minor release per SemVer — no breaking API changes vs 1.0.0.
