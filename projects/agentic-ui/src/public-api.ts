/**
 * Public API surface of @infra-tools/agentic-ui.
 *
 * As of v1.0 the library is a SINGLE primary entry. Earlier secondary entries
 * (`/ag-ui`, `/hashbrown`, `/a2ui`, `/mfe`, `/mfe-module-federation`, `/otel`,
 * `/testing`, `/components`) have been collapsed because Native Federation's
 * `includeSecondaries` does not emit per-entry chunks (see ADR-005). All those
 * symbols are now re-exported here.
 *
 * Tree-shaking is preserved by `sideEffects: false` in package.json — apps
 * that import only `provideAgUiBackend` will not pull in Hashbrown, A2UI, MCP,
 * etc. Apps that don't import `ChatShellComponent` will not register the
 * `@Component` decorator side-effect.
 */
export * from './lib/types';
export * from './lib/telemetry';
export * from './lib/registries';
export * from './lib/validation';
export * from './lib/composition';
export * from './lib/factories';
export * from './lib/providers';
export * from './lib/chat';
export * from './lib/iam';
export * from './lib/mcp';

// Single config point for the Maverick agentic platform — closes
// Gap 4 from the 2026-05-10 platform audit. Wires the catalog
// integrations (IAM persona resolver, MFE registry; future:
// capability registrar / authorizer / usage metering) under one
// provider call.
export * from './lib/platform';

// Was @infra-tools/agentic-ui/components
export * from './lib/components';

// Was @infra-tools/agentic-ui/ag-ui, /hashbrown, /a2ui
export * from './lib/backends/ag-ui';
export * from './lib/backends/hashbrown';
export * from './lib/backends/a2ui';

// Was @infra-tools/agentic-ui/mfe and /mfe-module-federation
export * from './lib/mfe';
export * from './lib/mfe-module-federation';

// Was @infra-tools/agentic-ui/otel
export * from './lib/otel';

// Was @infra-tools/agentic-ui/testing
export * from './lib/testing';

// ADR-046 PR1 — LayeredLayoutEngine D1 + D5
// `LayoutResolver` (reactive engine that composes a SlotMap from multiple
// layered inputs) + `AgentContextProvider` (per-turn XML context block so
// the agent reasons about live UI state, not just the user's prompt).
// Both are opt-in via their `provideXxx` factories; importing this module
// has no side effects.
export * from './lib/layout/resolver';
export * from './lib/layout/agent-context';

// ADR-046 PR2 — LayeredLayoutEngine D2 + D3 + D7
// D2 LayeredLayoutStore — precedence-aware multi-tier reads.
// D3 httpPersistenceStore — server-side adapter for the user / matter /
//    org tiers (other browser-side adapters from Phase C still apply).
// D7 LayoutMigratorChain — forward-only schema migration on rehydrate.
export * from './lib/layout/layered-store';
export * from './lib/layout/migration';

// ADR-046 PR3 — LayeredLayoutEngine D4
// LayoutAuditTracker watches LayoutResolver.active() and emits
// chain-hashed LAYOUT_APPLIED events on every material change.
// Provides in-memory chain inspection (snapshotAt, validateChain) +
// pluggable external sink. Time-travel viewer reads from .chain().
export * from './lib/layout/audit';

// ADR-046 PR4 — LayeredLayoutEngine D6
// LayoutTemplateRegistry + DashboardTemplateRegistry — named, versioned,
// approval-gated catalogs of layouts / dashboards. State machine: draft →
// review → approved (with rejected + deprecated terminals). Adopters
// wire templates with org / matter / tenant visibility for the
// enterprise marketplace pattern.
export * from './lib/layout/templates';
