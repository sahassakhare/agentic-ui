# ADR-002: Layered registry system (13 registries)

**Status**: Accepted (M1 / M3 / M4 / M5).

## Context

A useful agentic UI has many extension points: tools the agent can call, components it can render, capabilities an MFE remote contributes, intents to route, actions to dispatch, forms to collect input, persistence for transcripts, layouts to compose, schemas to convert, MCP servers to bridge, and pluggable validators. We could:

- Ship ad-hoc lookups per concern (a `Map` here, an `InjectionToken` there) — fast to start, gnarly long-term.
- Use NgRx feature stores for everything — heavyweight, opinionated, doesn't fit MFE teardown.
- Define one uniform registry contract and stamp it out per concern.

## Decision

13 registries grouped into three tiers, all sharing one `RegistryBase<TDef>`:

| Tier | Registries | Required? |
|------|-----------|-----------|
| Core (M1 / M3) | Tool, Component, Capability, Backend, Mfe (external) | Yes |
| Extended (M4 / M5) | Action, Intent, Form, DataSource | Opt-in |
| Seam (M4 / M5) | Validation, Persistence, Layout, SchemaTransformer | Interface + thin default |

Every registry implements:

```ts
interface Registry<TDef extends { name: string; source?: CapabilitySource }> {
  register(def: TDef): () => void;          // returns disposer
  registerAll(defs: readonly TDef[]): () => void;
  get(name: string): TDef | undefined;
  list(): readonly TDef[];
  readonly signal: Signal<readonly TDef[]>;
  removeBySource(source: string): void;     // MFE-aware teardown
}
```

## Consequences

- Adding a 14th registry costs ~30 LOC (extend `RegistryBase`).
- Every entry carries a `source` field (`'host'` / `'remote:<name>'` / `'mcp:<name>'`); MFE unload calls `removeBySource('remote:<name>')` once and every registry cleans up — no per-registry teardown plumbing.
- Apps pay for what they use: only `Tool` + `Component` + `Backend` are required to render a working chat. The other ten are opt-in via `provideAgenticUi({...})` flags or providers.
- Sublinear maintenance cost in registry count.
- Per-registry governance hooks land on the shared base, not on each registry: a single edit to `RegistryBase` propagates to all 13. Today implemented:
  - `conflictPolicy: 'replace' | 'throw' | 'first-wins' | 'namespace'` — strategy on duplicate-name registration. Default `'replace'` is backward-compatible. Set per-registry via `inject(ToolRegistry).conflictPolicy = 'throw'`.
  - `RegistryEntry.onDispose?` — optional hook fired when an entry is removed (explicit disposer, `removeBySource`, or replaced under `'replace'`). Errors from a single hook are caught and routed to telemetry so a bad disposer can't poison a sweep.
- See [registries-vs-industry.md](../architecture/registries-vs-industry.md) for the full integration map of additional governance hooks (scopes, versioning, activation events, health probes) — same pattern, ship as needed.

## Risks

- **Surface area** — 13 distinct concepts is a lot. Mitigation: cookbook split between "minimal app (5 registries)" and "full app (13)"; ESLint rule pack (planned) prevents direct registry mutation outside `provideAgenticUi` or `defineCapabilityModule`.
- **Adoption blind spots** — at M4 retro, any extended/seam registry with zero adoption gets demoted to seam-only or removed.
