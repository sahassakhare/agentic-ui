/**
 * Build-time version constant for `@infra-tools/agentic-ui`. Synced from
 * `projects/agentic-ui/package.json` via release tooling — bumped on
 * every release. Used by `RegistryBase.register()` to evaluate
 * `RegistryEntry.requiredHostVersion` ranges (Capability M1 R5 —
 * ADR-014).
 *
 * Do NOT import from `package.json` directly — Native Federation +
 * the Angular package compiler don't agree on JSON imports across
 * all bundlers. Hardcoding here is intentional and the release script
 * keeps it in sync.
 */
export const LIB_VERSION = '1.1.0';
