/**
 * Public API surface of @maverick/agentic-ui.
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
export * from './lib/factories';
export * from './lib/providers';
export * from './lib/chat';
export * from './lib/mcp';

// Was @maverick/agentic-ui/components
export * from './lib/components';

// Was @maverick/agentic-ui/ag-ui, /hashbrown, /a2ui
export * from './lib/backends/ag-ui';
export * from './lib/backends/hashbrown';
export * from './lib/backends/a2ui';

// Was @maverick/agentic-ui/mfe and /mfe-module-federation
export * from './lib/mfe';
export * from './lib/mfe-module-federation';

// Was @maverick/agentic-ui/otel
export * from './lib/otel';

// Was @maverick/agentic-ui/testing
export * from './lib/testing';
