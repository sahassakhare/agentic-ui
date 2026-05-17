# ADR-008: Registry scope policy — `RegistryBase.setScopePolicy`

**Status**: Accepted (shipped).

**Drives**: [eDiscovery plan, Phase 8](../plans/ediscovery-app-plan.md#phase-8--library-registryentryscopes-optional-3-days).

**Companion docs**: [`registries-vs-industry.md`](../architecture/registries-vs-industry.md) (moves "scopes" from gap to shipped), `registry-base.spec.ts` (eight new tests).

## Context

Phase 7 of the eDiscovery reference app shipped a consumer-side
permission filter — `personaToolFilter` chained on top of
`keywordToolFilter` — that drops tools the active persona may not
invoke before the LLM ever sees them. The mechanism worked, but had
three problems:

1. **Tool-only.** It hooked the chat-shell-specific `TOOL_FILTER`
   injection token. The same role-based view didn't apply to
   `ActionRegistry`, `FormRegistry`, `DataSourceRegistry`, or any
   other registry. A widget reading `ToolRegistry.signal()` still
   saw the unfiltered list, even though the agent itself was
   filtered.

2. **Outside the chat shell, surfaces drifted.** The sidebar's
   "tools loaded" counter showed 17 even when the active persona
   was Vendor Reviewer (which can only invoke 4). The chat rail's
   capability badge had the same drift.

3. **Per-consumer reinvention.** Every app that wants role-scoped
   tools has to build the filter chain themselves. The library
   had nothing to lean on except the chat-only `TOOL_FILTER`.

## Decision

Add a **scope policy** primitive to `RegistryBase` so the same
predicate filters every registry's `list()` / `get()` / `signal()`.

```ts
type RegistryScopePolicy = (entry: RegistryEntry) => boolean;

abstract class RegistryBase<TDef extends RegistryEntry> {
  setScopePolicy(policy: RegistryScopePolicy): void;
  // signal / list / get filter through the active policy
  // listRaw / getRaw bypass for tooling
}
```

Plus an optional `scopes?: readonly string[]` field on
`RegistryEntry` so federated remotes can ship tools / widgets /
forms tagged at the source. Hosts decide what scope strings mean.

Two convenience exports:

- `permissiveScopePolicy` — default (every entry visible).
- `activeScopePolicy(getActive)` — closes over a getter, checks
  `getActive()` against `entry.scopes`. Scope-less entries stay
  visible.

## Why filter on read, not register

A federated MFE may contribute an entry whose scope is broader
than the current user — e.g. a tool tagged `['lead-counsel']` from
a remote loaded for everyone. Filtering at register-time would
lose that entry permanently for other users; filtering on read
keeps the remote portable. The same instance can show different
views to different personas in the same browser tab over time
(persona switcher).

## Why `getRaw` / `listRaw`

`register()` needs to detect collisions against entries that may
be hidden by the current policy. Tooling — inspectors, the test
harness, the eDiscovery shell's sidebar tool-count display when
showing the *total* — needs to bypass the filter. Two methods is
simpler than threading a "raw" flag through every call site.

## Why a callable rather than a config object

The policy CLOSES OVER whatever live state it depends on. Reading
the policy inside the `signal`'s `computed` automatically subscribes
to whatever signals the policy reads — no manual wiring.
`activeScopePolicy(() => persona.active())` re-evaluates on persona
change without anyone telling the registry.

## What the eDiscovery shell looked like before vs after

```ts
// Before (Phase 7): consumer-side filter chain
provideToolFilter(
  personaToolFilter(
    inject(PersonaService),
    keywordToolFilter({ maxTools: 12, floor: 5 }),
  ),
);

// After (Phase 8): library-side scope policy + thinner consumer filter
provideToolFilter(keywordToolFilter({ maxTools: 12, floor: 5 }));

provideAppInitializer(() => {
  const persona = inject(PersonaService);
  inject(ToolRegistry).setScopePolicy(
    (entry) => persona.canInvoke(persona.active(), entry.name),
  );
});
```

Net diff: dropped `personaToolFilter` (~30 LOC) + the
`TOOL_FILTER + useFactory` boilerplate (~12 LOC). Sidebar tool
counter and chat-rail capability badge now reflect the active
persona automatically because they read `ToolRegistry.signal()`.

## Acceptance criteria

- [x] `RegistryEntry.scopes?: readonly string[]` field added.
- [x] `RegistryBase.setScopePolicy(policy)` + `permissive` /
      `active` policy exports.
- [x] `signal` / `list` / `get` filter through the policy;
      `listRaw` / `getRaw` bypass.
- [x] Eight unit tests cover default (permissive), filter, signal
      recompute on policy change, register-collision against hidden
      entries, raw bypass, and `activeScopePolicy` over a getter.
- [x] `examples/demo-ediscovery-shell/` migrated; `personaToolFilter`
      file deleted; sidebar tool counter and persona menu badge
      remain accurate against the live registry view.

## Trade-offs

- **Single-policy register.** One policy per registry. Apps that
  want stacked policies build composition themselves — same shape
  as `conflictPolicy`. Open to widening if a real consumer asks.
- **No per-call scope override.** `list({ scope: 'paralegal' })`
  is not supported. Apps that need that pass through `listRaw` and
  apply their own filter. Avoids API bloat.
- **Identity policy on register.** Registration is scope-blind by
  design. Tools that rely on the policy for security must NOT also
  rely on registration time-checks; the policy is read-time.

## Risks

- **Hidden entries surprise developers.** `get(name)` returning
  `undefined` for a registered entry can confuse. Mitigation:
  `getRaw` is documented; the deeplink to `listRaw` from the JSDoc
  sits next to `list`.
- **Policy churn** if consumers swap policies frequently. The
  signal recompute is O(n) over registered entries; no caching by
  default. Mitigation: documented as O(n) per read; consumers
  with thousands of entries should consider memoising the policy.
