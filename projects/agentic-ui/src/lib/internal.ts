/**
 * Internal re-export barrel. Used by sibling lib modules (backends, mfe,
 * components, otel, testing, mfe-module-federation) to import the lib's
 * "core" without going through the package name `@maverick/agentic-ui` —
 * which would create a runtime cycle since they ARE the package.
 *
 * Apps consume the lib via `@maverick/agentic-ui`, not via this file.
 */
export * from './types';
export * from './telemetry';
export * from './registries';
export * from './validation';
export * from './composition';
export * from './factories';
export * from './providers';
export * from './chat';
