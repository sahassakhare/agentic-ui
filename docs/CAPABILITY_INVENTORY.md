# Library capability inventory

The library ships substantially more capability than any single demo exercises. The eDiscovery flagship demonstrates ~60% of the public surface; the remaining ~40% is wireable seams adopters opt into. **Bold = exercised by the eDiscovery flagship**; *italic = opt-in / advanced*.

For the surface-by-surface enterprise-readiness analysis (what's wired vs prototype-only in the eDiscovery demo), see [`docs/analysis/2026-05-16-surface-by-surface-enterprise-readiness.md`](./analysis/2026-05-16-surface-by-surface-enterprise-readiness.md).

## Foundation tier — DI + registry mechanics

- **`RegistryBase<TDef>`** — uniform `register / list / get / signal / removeBySource / setScopePolicy` semantics across every registry. Four conflict policies: `replace` / `throw` / `first-wins` / `namespace`. ADR-014 host-version compatibility check (federated remotes pinned to a major can decline to surface in incompatible hosts without crashing).
- **`ToolRegistry`** / **`ComponentRegistry`** (a.k.a. **`WidgetRegistry`**) / **`BackendRegistry`** — core dispatch primitives the chat shell + post-chat surfaces consume.
- **`PersistenceRegistry`** + three built-in adapters: **`memoryStore`** (SSR / tests), **`webStorageStore`** (browser localStorage / sessionStorage, JSON-serialized), **`indexedDbStore`** (multi-MB capacity, structured-clone semantics — ADR-046 Phase C). Plus **`httpPersistenceStore`** factory for server-backed tiers with custom `urlForKey`, `init`, `fetcher` knobs.
- *`SchemaTransformerRegistry`* — schema-transform registry for connector-style adoption (e.g., Salesforce → eDiscovery shape).

## Capability tier — domain registries

- **`ApprovalRegistry`** + **`<mvk-approval-card>`** — HITL approval queue with async cross-session handoff (paralegal queues at 5pm, lead-counsel approves next morning). Per-approval audit + diff payload ([ADR-009](./adr/0009-approval-intercept-and-audit-hook.md)).
- **`OperationRegistry`** + **`<mvk-operation-progress>`** — long-running operation tracking with pending / running / completed / failed states. In-memory by default; swappable to durable backend.
- **`DataSourceRegistry`** + `agenticDataSource()` factory — typed pluggable data sources (REST, GraphQL, in-process, federated remote). Composition widgets declare `dataSources: ['users']` and the mount-time validator verifies registration before instantiating.
- **`FormRegistry`** + **`<mvk-form-renderer>`** — schema-driven form rendering with Zod validation. F1 capability: agent emits a `formCard` widget mounting an inline form, or routes to a standalone `/intake/...` page using the SAME form def.
- **`ActionRegistry`** + **`IntentRegistry`** — intent → action dispatch powering row-action menus, bulk toolbars, and the command palette. Same intents work via chat agent or UI button.
- **`TriggerRegistry`** + **`provideTriggerRunner`** — browser-side cron triggers (`kind: 'cron'`); webhook + queue trigger shapes defined for server-side runners ([ADR-045](./adr/0045-trigger-registry.md)).

## Post-chat surfaces tier (ADR-043 → ADR-045)

- **`LayoutRegistry`** + **`<mvk-workspace-layout>`** — slot-based composition with `*ngComponentOutlet` + CDK splitters. Each slot's `component` is a `ComponentRegistry` name; `ResponsiveCollapseRule[]` collapses slots below configured breakpoints.
- **`<mvk-chat-shell>`** with five presentation modes (`rail` / `pill` / `overlay` / `docked-bottom` / `assist-panel` / `hidden`). Per-route mode lookup via **`provideLayoutPolicy({...})`**; per-persona density (`compact` / `comfortable` / `dense`).
- **`<mvk-smart-cell>`** / **`<mvk-row-action-menu>`** / **`<mvk-bulk-toolbar>`** / **`<mvk-assist-panel>`** / **`<mvk-cmd-k-palette>`** — in-context affordance primitives. Smart-cells overlay AI flags on table columns; row-action menus dispatch persona-scoped intents.
- **`<mvk-notification-tray>`** + **`<mvk-inbox>`** + **`<mvk-lifecycle-stages>`** — trigger + notification surfaces. Tray in the header with unread badge; full `/inbox` route; lifecycle-stages component renders multi-stage flows (hold acked → released; production draft → finalized → delivered).
- **`DashboardRegistry`** + **`<mvk-dashboard-canvas>`** + **`<mvk-dashboard-tile>`** + **`<mvk-dashboard-preview>`** + **`TileResultCache`** + `tileCacheKey` — user-built, live, drillable dashboards. Tile invocation kinds: `tool` (re-invoke against `ToolRegistry`), `static` (hardcoded props), `data-source` (reserved). Version chains via `parentVersion` ([ADR-044](./adr/0044-dashboard-registry.md)).
- **`PlaybookRegistry`** + **`PlaybookRunner`** + **`<mvk-playbook-runner>`** — versioned, chain-hashed tool-call sequences. Per-step `continueOnError` + `requiresApproval` flags. `parentVersion` links revisions; each step audited with `origin: 'playbook'`.
- **`<mvk-review-queue>`** / **`<mvk-timeline-canvas>`** / **`<mvk-cal-workbench>`** — workflow surfaces: privilege review queue with persona-routed states; investigation timeline with key-moment flags + filter-by-kind; continuous-active-learning workbench with cursor + decision tally + convergence stats.

## Layered Layout Engine tier (ADR-046)

- **`LayoutResolver`** — reactive 11-source precedence engine. Slot-level merge, eviction semantics (`evictSlots`), per-source weights (`agent` 1000 → `hardcoded` 0). Single `computed()` that recomputes when any input signal fires. Outputs `ResolvedLayout { slots, appliedRules }` for audit attribution.
- **`AgentContextProvider`** + 8 built-in contributors — per-turn XML context block: **`route`** / **`persona`** / **`layout-state`** / **`selection`** / **`available-templates`** / **`override-stack`** / *`recent-tool-calls`* / *`matter`*. Replaces "agent only sees the user's prompt" with "agent sees route + persona + selection + current-layout + override-stack + …".
- **`LayeredLayoutStore`** — precedence-aware multi-tier persistence (org / matter / persona / user-saved / agent). `read(name)` walks tiers, `readAll(name)` returns the stack (UIs that show *"your override of the org default"*). `scope()` folds dynamic discriminators (userId, matterId, tenantId) into storage keys.
- **`LayoutMigratorChain`** — forward-only schema migration on rehydrate. Picks longest-jump on ties. Throws on newer-than-current or missing-path entries (downgrade requires audit-chain replay).
- **`LayoutAuditTracker`** — chain-hashed `LAYOUT_APPLIED` events with `snapshotAt(when)` time-travel and `validateChain()` integrity check. Adopter sink for forwarding into existing audit pipelines.
- **`LayoutTemplateRegistry`** + **`DashboardTemplateRegistry`** — approval-gated catalogs. State machine: `draft → review → approved | rejected | deprecated`. Universal `deprecate`; admin `revoke` from approved back to draft. Visibility tiers: `private` / `matter` / `tenant`.

## Agentic-UI Coordination tier (ADR-047)

- **`slotEdits`** — pure `add / remove / replace / merge` helpers for slot-level edits. Powers agent tools that tweak ONE slot without re-emitting the whole map.
- **`SelectionStore`** + **`SelectionLayoutInput`** — `{ kind, ids, metadata? }` selection model + kind+count predicate rules. The *"click a doc → workspace pivots to preview/tag/chain"* moment.
- **`UserSavedLayoutInput`** — round-trips user-saved tier back into the resolver. Closes the *"Save button is write-only"* gap.
- **`MatterPhaseLayoutInput`** + **`ACTIVE_MATTER_PHASE_SIGNAL`** — phase-driven layouts (collection / review / production / closed). Generic `string` taxonomy — adopters define their own.
- **`AlertLayoutInput`** + **`ACTIVE_ALERTS_SIGNAL`** — alert-driven layout pivots (deadlines, SLA breaches, policy violations) with severity gates.

## Federation + MFE tier

- **`MfeRegistryClient`** + three discovery patterns: **`provideStaticJsonMfeRegistry`** (URL → JSON), *`provideRestMfeRegistry`* (REST endpoint with auth), *`provideSpringBootMfeRegistry`* (Spring Boot catalog adapter).
- **`loadRemoteCapabilities`** (Native Federation) / **`loadRemoteCapabilitiesMF`** (webpack Module Federation) — host pulls remote capabilities into runtime registries; `removeBySource('remote:<name>')` reaps on unload.
- **`defineCapabilityModule`** — federation-symmetric capability declaration. One descriptor across tools + dashboards + playbooks + triggers + forms + widgets.
- *`prefetchCapabilities`* — eager-load remotes on hover / idle for fluid UX.

## Backend tier (chat protocols)

- **`AgUiBackend`** — AG-UI protocol adapter (HttpAgent + SSE event stream).
- *`HashbrownBackend`* — native Hashbrown client (`@hashbrownai/core` frame codec).
- *`A2uiBackend`* — A2UI protocol adapter (`ui-action` event class routed through `ActionRegistry`).
- **`FakeAgenticBackend`** — deterministic testing backend; powers the `runConformance` test harness.
- *`mcpToolBridge`* — Model Context Protocol (Anthropic's tool protocol) bridge — imports tools FROM an MCP server INTO `ToolRegistry`.
- *`composeWithCatalogAuthorizer`* — backend composition with catalog ACL applied at the wire layer.

### MCP-UI inbound rendering (server-driven UI)

- **`<mvk-mcp-ui-resource>`** + **`McpUiActionBridge`** + **`provideMcpUi({...})`** — renders an MCP UI resource in a sandboxed `allow-scripts` iframe and dispatches its actions through the host registries. Two protocols: the **legacy MCP-UI** convention (`text/html` + `{source:'mcp-ui'}` postMessage) and the **MCP Apps SEP-1865** (`text/html;profile=mcp-app` + JSON-RPC-over-postMessage `ui/*` channel via `handleAppRpc` — `ui/initialize`, `tools/list`, `tools/call`, `ui/open-link`). Tool calls back from the iframe are scope-gated through the same `ToolRegistry` policy (no existence leak on a forbidden tool). `application/vnd.mcp-ui.component-tree+json` resources render as native registered widgets instead of an iframe. New exports: `MCP_UI_APP_MIME`, `mcpAppRpcRequestSchema`, `McpAppRpcRequest` / `McpAppRpcResponse`. See [ADR-049](./adr/0049-mcp-ui-inbound-rendering.md) + [host-compatibility-analysis.md](./host-compatibility-analysis.md).

## Platform integration tier

- **`provideAgenticPlatform({...})`** — one-call wire-up of catalog integrations (ADR-031). Four per-feature switches: IAM persona resolver, MFE registry, capability registrar, capability authorizer, usage metering.
- *Catalog services*: `CatalogCapabilityRegistrarService` / `CatalogCapabilityAuthorizerService` / `CatalogIamService` / `CatalogUsageMeteringService` / `CatalogSseService` / `CatalogSemanticSearchService` — Spring Boot reference adapters.
- **`provideTeamsContext`** — Microsoft Teams Tab embed seam. Resolves only inside Teams; fallback for outside.

## Composition + expression tier

- **`CompositionStore`** + `evaluateCompositionExpression` + `parseCompositionExpression` — slot composition expression language. Sandboxed via `MAX_EXPRESSION_DEPTH` + `MAX_EXPRESSION_LENGTH` constants.
- **DSL factories**: **`agenticTool`** / **`agenticForm`** / **`agenticWidget`** / **`agenticIntent`** / **`agenticApproval`** / **`agenticWorkflow`** / **`agenticDataSource`** / **`agenticAction`** — declarative registry-entry constructors with Zod schemas.

## Validation + schema tier

- **`ZodSchemaValidator`** + **`ValidationRegistry`** + `ADDITIONAL_VALIDATORS` — host-extensible Zod validation. Lib emits the default validator; hosts compose additional ones.
- *`jsonSchemaToZod`* — JSON Schema → Zod transformer for legacy schema imports.
- *`openApiToTools`* — OpenAPI spec → `ToolDef[]` generator. Brings any REST API into the agent's tool surface in one call.

## Audit + telemetry tier

- **`AgenticTelemetrySink`** + four built-in sinks: **`ConsoleTelemetrySink`** / *`OtelTelemetrySink`* (W3C trace context propagation across SSE) / **`InMemoryTelemetrySink`** (test inspection) / **`NoopTelemetrySink`**.
- **`AGENTIC_APPROVAL_AUDIT_HOOK`** / **`AGENTIC_OPERATION_AUDIT_HOOK`** — domain-specific audit emitter tokens.
- **`AGENTIC_LOGGER`** with `ConsoleAgenticLogger` default.

## Testing tier

- **`FakeAgenticBackend`** — deterministic test backend with scriptable event sequences.
- **`runUntilSettled`** — orchestration loop primitive (drives backends until run-finished).
- *`runConformance`* — backend-conformance test harness (adopters validate their custom backends against the lib contract).
- *`extractClaimValues`* + *`readJwtPayload`* / *`readTenantId`* — IAM testing helpers.

## IAM tier

- **`AGENTIC_ACTIVE_PERSONA`** — active-persona InjectionToken consumed by `ToolRegistry.setScopePolicy` and the catalog authorizer.
- *`resolveActivePersona`* + *`readTenantId`* — catalog-driven persona resolution.
- **`permissiveScopePolicy`** / **`activeScopePolicy`** / **`keywordToolFilter`** / **`passthroughToolFilter`** — built-in scope/filter policies. **`provideToolFilter`** + `TOOL_FILTER` — filter what the LLM sees.

## External-surface adapters (deferred deployment)

- *`@infra-tools/agentic-ui-teams-bot`* — Microsoft Bot Framework adapter for Teams bot deployments ([§25 cookbook](./cookbook/teams-bot-adaptive-cards.md)).
- *`@infra-tools/agentic-ui-m365-agents`* — Microsoft 365 Agents SDK adapter (successor to Bot Framework v4); same Activity wire, broader channel set (Teams + M365 Copilot + Direct Line + sovereign clouds). Use this for greenfield Teams + Copilot deployments.
- *`@infra-tools/agentic-ui-copilot-skill`* — GitHub Copilot extension adapter ([§26 cookbook](./cookbook/github-copilot-extension.md)).
- *`@infra-tools/agentic-ui-copilot-studio-connector`* — Power Platform Custom Connector adapter ([§27 cookbook](./cookbook/copilot-studio-connector.md)).

---

**Reading the inventory.** Each tier above corresponds to one or more ADRs in [`docs/adr/`](./adr/). The cookbook pages in [`docs/cookbook/`](./cookbook/) walk through canonical wiring patterns; the eDiscovery flagship in [`examples/demo-ediscovery-shell`](../examples/demo-ediscovery-shell) exercises the bold-marked surface end-to-end.
