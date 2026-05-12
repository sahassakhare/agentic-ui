# ADR-005: Single primary entry — drop ng-packagr secondary entries

**Status**: Accepted (v1.0).

## Context

The original design (PLAN.md §3) shipped `@infra-tools/agentic-ui` as a primary entry plus seven secondary entries (`/ag-ui`, `/hashbrown`, `/a2ui`, `/mfe`, `/mfe-module-federation`, `/otel`, `/testing`, `/components`). Goal: tree-shake aggressively — apps that use only AG-UI shouldn't pay for Hashbrown bytes, etc.

This worked fine for non-federated consumers. **Native Federation broke** in two ways:

1. `@angular-architects/native-federation`'s `includeSecondaries: true` flag claims to handle ng-packagr secondary entries, but in practice it does *not* emit per-entry chunks. Only the primary entry gets a federation chunk (`_maverick_agentic_ui.js`). Imports of secondary entries (`@infra-tools/agentic-ui/ag-ui`, etc.) end up as bare specifiers the browser cannot resolve.

2. Even when a secondary entry's source code lives in its own bundle, the remote MFE's bundle transitively pulls in the primary entry's code (because secondaries depend on primary's registries / types) — and that import is *not* externalized through federation, because the federation builder only knows about the entries explicitly listed in `shared`. Secondary-entry chunks never make the list.

The combined effect: in a Native-Federation-host + Native-Federation-remote setup, the host's chat shell could not render widgets contributed by the remote. The remote registered its `flightCard` widget against a *different* `ComponentRegistry` class instance than the host's chat shell read from, because each app bundled its own copy of the registry classes (no federation dedup).

## Decision

Collapse all secondary entries into the primary entry. The library now ships as **one** ng-packagr entry: `@infra-tools/agentic-ui`. Source files moved into subfolders under `src/lib/`:

```
src/lib/
  types/                   # AgenticBackend, AgenticEvent, registry defs
  telemetry/               # AgenticTelemetrySink, AgenticLogger
  registries/              # 13 registries
  validation/              # ValidationRegistry
  factories/               # agenticTool / agenticWidget / etc.
  providers/               # provideAgenticUi
  chat/                    # injectAgenticChat + run-orchestrator
  components/              # <mvk-chat-shell>, <mvk-widget-container>, <mvk-form-renderer>
  backends/{ag-ui,hashbrown,a2ui}/
  mfe/                     # capability-module, registry-source, loadRemote
  mfe-module-federation/   # webpack-MF wrapper
  otel/                    # OpenTelemetry sink
  testing/                 # FakeAgenticBackend, conformance suite
  mcp/                     # MCP bridge
```

The primary `public-api.ts` re-exports everything. Import paths change from `@infra-tools/agentic-ui/<area>` to `@infra-tools/agentic-ui` only.

## Consequences

**For consumers**:
- Migration is mechanical: `import { X } from '@infra-tools/agentic-ui/ag-ui'` becomes `import { X } from '@infra-tools/agentic-ui'`.
- Tree-shaking is preserved by `"sideEffects": false` in package.json — apps that import only `provideAgUiBackend` will not pull in Hashbrown, A2UI, MCP, or telemetry adapter code. Apps that don't import `ChatShellComponent` will not register the `@Component` decorator's side-effect.

**For the federation story (the headline win)**:
- Host and remote both `share: { '@infra-tools/agentic-ui': { singleton: true } }` in their federation configs. Native Federation creates one federation chunk for the lib and rewrites both apps' imports to use it.
- Registry classes (`ToolRegistry`, `ComponentRegistry`, etc.) are shared singletons across the realm — `hostInjector.get(ToolRegistry)` returns the same instance the remote's `defineCapabilityModule.apply()` writes to.
- `@Component`-decorated classes are loaded once → no `NG0912: Component ID generation collision` warnings, no broken widget rendering.

**For library size**:
- Apps that previously imported only `/ag-ui` may see a small bundle increase from un-tree-shakable side effects in adjacent code. In practice the extra `@Component` declarations (chat-shell, form-renderer, widget-container) are small (~6 KB combined) and most apps DO import the chat shell.
- For apps that genuinely care about every byte, the named-import + `sideEffects: false` combination keeps the bundle minimal.

## What we tried before settling

| Attempt | Outcome |
|--------|--------|
| Keep secondary entries, share `@infra-tools/agentic-ui` with `includeSecondaries: true` | Federation chunk only for the primary; secondaries left as unresolvable bare specifiers. |
| Keep secondaries, list each secondary explicitly in `shared` | Same: only the primary chunk emitted. The federation manifest accepted the entries but didn't emit chunks. |
| Skip the lib (`skip` list) — let each app bundle independently | Components duplicated → NG0912 collisions; remote registered widgets in a different `ComponentRegistry` instance from the one the host read. |
| Separate `@infra-tools/agentic-ui-components` npm package | Doable but doubles publish surface and creates an awkward two-package import dance for consumers. |

The single-primary collapse is the only approach where federation works *and* consumers have one obvious import path *and* tree-shaking still works for non-federated apps.

## Open follow-ups

- Document the "must use `ignoreUnusedDeps: false` in federation.config.js" requirement prominently in cookbook/federate-an-mfe.md (with `true`, the lib is silently filtered out of the shared list).
- Re-evaluate when `@angular-architects/native-federation` ships proper ng-packagr secondary-entry support. If/when it does, we can opt back into multi-entry without breaking consumers (we'd just add secondary entries in addition to the primary; the primary remains the canonical import).
