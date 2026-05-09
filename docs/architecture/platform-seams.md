# Platform seams — the contract surface

This document is the **definitive map** of every place the runtime tier (`@maverick/agentic-ui`) deliberately yields control to the host application: every `InjectionToken<T>`, every `provideX(...)` factory, every audit hook, every scope-policy contract, every backend interface. These are the **platform contracts** the runtime guarantees forever (per [ADR-010](../adr/0010-platform-principles-and-license.md) D4 — zero breaking changes through v1.x).

Adopters, contributors, and reviewers should read this as the load-bearing document for "what's pluggable and what isn't." Anything *not* listed here is internal lib state and may change.

---

## Quick reference — the seams in one table

| Seam | Kind | Default | Swap with | Why it exists |
|---|---|---|---|---|
| `AGENTIC_TELEMETRY_SINK` | InjectionToken | console-pretty sink | OTel collector, Datadog, custom sink | Observability + cost attribution |
| `AGENTIC_LOGGER` | InjectionToken | `console`-backed logger | Any logger that matches the interface | Internal lib logging (separate from telemetry events) |
| `AGENTIC_ACTIVE_PERSONA` | InjectionToken | `() => 'default'` | Function returning current persona id | Cross-cutting persona context for predicates + filters |
| `MFE_REGISTRY_SOURCE` | InjectionToken | unset (must be provided) | Static JSON / REST / Spring Boot / custom | Federation discovery |
| `TOOL_FILTER` | InjectionToken | identity (no filter) | Custom per-turn tool filter | Per-turn tool subsetting beyond persona scope |
| `UI_ACTION_DISPATCHER` | InjectionToken | A2UI default dispatcher | Custom dispatcher | A2UI `ui-action` event handling |
| `COMPOSITION_SLOT` | InjectionToken | per-section value | (read-only, set by form-renderer) | F1 composition slot identity for child injectors |
| `APPROVAL_DIFF_INPUTS` | InjectionToken | unset | Provided per-approval-policy | F4 inline diff component data |
| `AGENTIC_APPROVAL_AUDIT_HOOK` | InjectionToken | no-op | SIEM bridge / external audit log writer | F4 approval lifecycle audit export |
| `AGENTIC_OPERATION_AUDIT_HOOK` | InjectionToken | no-op | SIEM bridge / external audit log writer | F5 operation lifecycle audit export |
| `ADDITIONAL_VALIDATORS` | InjectionToken (multi) | empty | Custom validators | Validation registry extensions |
| `RegistryBase.setScopePolicy(policy)` | Method | permissive (everything visible) | Per-app policy predicate | Filter-on-read across all 15 registries (the security gate) |
| `provideAgenticUi(config)` | Factory | n/a | n/a | Top-level lib bootstrap |
| `provideAgenticBackend(config)` | Factory | n/a | n/a | Generic backend wiring |
| `provideAgUiBackend(config)` | Factory | n/a | n/a | AG-UI backend |
| `provideHashbrownBackend(config)` | Factory | n/a | n/a | Hashbrown backend |
| `provideA2uiBackend(config)` | Factory | n/a | n/a | A2UI backend |
| `provideStaticJsonMfeRegistry(opts)` | Factory | n/a | n/a | mfes.json source |
| `provideSpringBootMfeRegistry(opts)` | Factory | n/a | n/a | Spring Boot source |
| `provideToolFilter(filter)` | Factory | n/a | n/a | Per-turn tool filter |
| `provideAgenticTelemetry(config)` | Factory | n/a | n/a | OTel-backed telemetry sink |
| `provideAgenticTelemetryConsole()` | Factory | n/a | n/a | Pretty-print console sink |

12 injection tokens · 2 method-shaped contracts on every registry (`setScopePolicy` + `setProviderHook`) · 12 `provideX` factories · 4 audit/telemetry hooks · 1 server-side store interface with 3 adapters. **No other contract is platform-level.** Anything else is internal.

---

## When you don't need any of this

Most adopters wire one of the existing `provideX(...)` factories in their app config and never see the underlying tokens:

```ts
// app.config.ts — typical adopter
export const appConfig: ApplicationConfig = {
  providers: [
    provideAgenticUi({ /* registries default to in-memory */ }),
    provideAgUiBackend({ url: '/agents/coordinator/run' }),
    provideStaticJsonMfeRegistry({ url: '/mfes.json' }),
  ],
};
```

That's it. Default behavior covers single-tab, in-process, no external deps. The seams below are for **when you need to plug in something external** — observability, identity, federation discovery, audit export, etc. Nothing forces you to use them.

---

## Tier 1 — Cross-cutting contracts (every adopter touches at least these)

### `provideAgenticUi(config)`

Top-level bootstrap. Every adopter calls this once in their app config. Wires the 15 registries with the in-memory default implementations. Accepts an optional config block for early-binding overrides.

**Signature:** [projects/agentic-ui/src/lib/providers/provide-agentic-ui.ts:30](../../projects/agentic-ui/src/lib/providers/provide-agentic-ui.ts#L30)

**Stability:** Public API. Frozen contract per ADR-010 D4.

**When to override:** Almost never. Override individual registries via DI providers if you need special construction.

---

### `RegistryBase.setScopePolicy(policy: RegistryScopePolicy)`

The **security trust gate**. Every registry inherits this from `RegistryBase`. Filters every `list()` / `get()` / `signal()` read against the supplied predicate. Per ADR-008.

**Signature:** [projects/agentic-ui/src/lib/registries/registry-base.ts:121](../../projects/agentic-ui/src/lib/registries/registry-base.ts#L121)

```ts
type RegistryScopePolicy = (entry: RegistryEntry) => boolean;

inject(ToolRegistry).setScopePolicy(
  entry => personaService.active().allowedTools.includes(entry.name)
);
```

**Stability:** Public API. Frozen contract per ADR-010 D4. Cannot be made async. Cannot be removed. Default policy is permissive (returns `true` for every entry).

**When to override:** Required for any production deployment with persona-scoped surfaces. The eDiscovery flagship's persona switcher uses this; see [docs/cookbook/context-aware-agent.md](../cookbook/context-aware-agent.md).

**Important guarantees:**
- Filter runs at read site, not at write site. Out-of-scope entries can still be registered; they're just hidden from readers under the active policy.
- Policy update is reactive — every `signal()` consumer recomputes on the next change-detection tick.
- Filtering is the trust gate, but is **not** a substitute for server-side authz. Always validate scope at the agent backend too.

---

### `AGENTIC_ACTIVE_PERSONA`

The cross-cutting persona-context provider used by `setScopePolicy` predicates, F1 composition predicates, and the chat shell's "speaking as X" badge.

**Signature:** [projects/agentic-ui/src/lib/chat/active-persona.ts:21](../../projects/agentic-ui/src/lib/chat/active-persona.ts#L21)

```ts
export const AGENTIC_ACTIVE_PERSONA = new InjectionToken<() => string>(
  'AGENTIC_ACTIVE_PERSONA',
  { providedIn: 'root', factory: () => () => 'default' },
);
```

**Stability:** Public API. Frozen.

**When to override:** Always, in any multi-persona host. Provide a function that reads from your app's persona service:

```ts
{ provide: AGENTIC_ACTIVE_PERSONA, useFactory: () => {
    const persona = inject(PersonaService);
    return () => persona.active();
}}
```

Note this is a *factory* (`() => string`), not a value — Angular signals don't fit cleanly into the InjectionToken value-shape, so we use a getter function. The getter is called per access and reads the current active persona.

---

### `AGENTIC_TELEMETRY_SINK`

OTel-aligned event sink. Receives every lifecycle event the runtime emits (registry changes, tool calls, approval transitions, operation lifecycle, federation health, errors). The **single seam** for observability + cost attribution.

**Signature:** [projects/agentic-ui/src/lib/telemetry/telemetry-sink.ts:49](../../projects/agentic-ui/src/lib/telemetry/telemetry-sink.ts#L49)

**Stability:** Public API. Event shape may grow (new event types added) but never shrink (existing events keep their fields).

**When to override:** Always, in any production deployment. Wire to your OTel collector, Datadog, Sentry, or custom backend:

```ts
// In-process default (pretty console)
provideAgenticTelemetryConsole(),

// OTel collector
provideAgenticTelemetry({ collector: 'http://otel:4318/v1/metrics' }),

// Custom
{ provide: AGENTIC_TELEMETRY_SINK, useClass: MyCustomSink }
```

This token is the **answer to the v3 plan's "no NATS / Kafka in the runtime" non-goal** (ADR-010 D5). If a customer needs message-bus integration, they wire it through here.

---

### `AGENTIC_LOGGER`

Internal lib logger (separate from `AGENTIC_TELEMETRY_SINK` which is for events). Used for development-time warnings, deprecation notices, and unexpected-state logs.

**Signature:** [projects/agentic-ui/src/lib/telemetry/agentic-logger.ts:29](../../projects/agentic-ui/src/lib/telemetry/agentic-logger.ts#L29)

**Stability:** Public API.

**When to override:** Optional. Default is `console`-backed; override to silence the lib in production or pipe to your logging stack.

---

## Tier 2 — Registry-specific contracts

### `MFE_REGISTRY_SOURCE`

The **federation discovery seam**. Implementations: `provideStaticJsonMfeRegistry({ url })`, `provideSpringBootMfeRegistry({ url })`, `provideRestMfeRegistry({ catalogUrl, tenantId, getToken })` (M2 C1 follow-up — reads from `@maverick/agentic-catalog-server`). Custom implementations supply their own `MfeRegistrySource`.

**Signature:** [projects/agentic-ui/src/lib/mfe/mfe-registry-source.ts:19](../../projects/agentic-ui/src/lib/mfe/mfe-registry-source.ts#L19)

**Stability:** Public API. Frozen.

**When to override:** Always, in any federated deployment. Pick the source that matches your federation manifest distribution.

This is the answer to the v3 plan's "ship a thin metadata server when consumer demand exists" — the seam is already here. We just need a new implementation when a customer needs centralized discovery.

---

### `TOOL_FILTER`

Per-turn tool subsetting that runs **after** scope policy. Used by the chat shell's `injectAgenticChat()` to apply runtime-derived filters (e.g., "this thread is about flights, hide tools from the loyalty domain").

**Signature:** [projects/agentic-ui/src/lib/chat/tool-filter.ts:47](../../projects/agentic-ui/src/lib/chat/tool-filter.ts#L47)

**Stability:** Public API.

**Default:** identity function (no filter beyond scope policy).

**When to override:** When you want per-turn tool subsetting beyond what `setScopePolicy` provides. Common case: capability-prefetch optimization — only load tools relevant to the current intent.

```ts
provideToolFilter((tools, ctx) => tools.filter(t => relevantTo(t, ctx.intent)))
```

---

### `UI_ACTION_DISPATCHER`

A2UI-specific seam. Resolves `ui-action` events emitted by the A2UI backend into Angular Router navigations / toast notifications / custom side effects.

**Signature:** [projects/agentic-ui/src/lib/backends/a2ui/a2ui-backend.ts:34](../../projects/agentic-ui/src/lib/backends/a2ui/a2ui-backend.ts#L34)

**Stability:** Public API for A2UI adopters; irrelevant to AG-UI / Hashbrown adopters.

**When to override:** When using the A2UI backend and you need custom `ui-action` handling beyond the default (which dispatches to `ActionRegistry`).

---

### `ADDITIONAL_VALIDATORS`

Multi-provider for runtime validators that supplement the default Zod-backed validation in `ValidationRegistry`. Use for cross-field checks that don't fit cleanly into a per-field schema.

**Signature:** [projects/agentic-ui/src/lib/validation/validation-registry.ts:66](../../projects/agentic-ui/src/lib/validation/validation-registry.ts#L66)

**Stability:** Public API.

**When to override:** Rarely. Most validation needs are met by per-tool / per-widget Zod schemas. This is for validators that need to run across multiple values (e.g., "if `state` is California, `taxId` must match SSN format").

---

### `COMPOSITION_SLOT`

F1 composition system — set automatically by `<mvk-form-renderer>` for each composed section's child injector. Used internally by composition widgets to identify which slot they're filling.

**Signature:** [projects/agentic-ui/src/lib/composition/composition-store.ts:12](../../projects/agentic-ui/src/lib/composition/composition-store.ts#L12)

**Stability:** Public API for **reading** in composition widgets; not for hosts to override.

```ts
// Inside a composition widget
const slot = inject(COMPOSITION_SLOT, { optional: true });  // 'identity' | 'compliance' | etc.
```

**When to read:** When writing a composition widget that needs to behave differently per slot.

**When to override:** Never — set by the form-renderer.

---

### `APPROVAL_DIFF_INPUTS`

F4-specific. Provides the data passed to inline diff renderers in approval cards. Per-approval-policy.

**Signature:** [projects/agentic-ui/src/lib/components/approval-card.component.ts:338](../../projects/agentic-ui/src/lib/components/approval-card.component.ts#L338)

**Stability:** Public API.

**When to override:** When customizing the diff display for a specific approval policy.

---

## Tier 3 — Audit hooks (extend the audit chain)

These two hooks are how F4 (HITL approval) and F5 (long-running operations) export their lifecycle events to external audit systems. Both are **opt-in**; default is no-op.

### `AGENTIC_APPROVAL_AUDIT_HOOK`

Fires after every approval state transition (`pending`, `approved`, `rejected`, `expired`).

**Signature:** [projects/agentic-ui/src/lib/registries/approval-registry.ts:52](../../projects/agentic-ui/src/lib/registries/approval-registry.ts#L52)

```ts
{ provide: AGENTIC_APPROVAL_AUDIT_HOOK, useFactory: () => {
    const siem = inject(SiemBridge);
    return event => siem.send('approval', event);
}}
```

**Stability:** Public API. Frozen event shape.

**When to override:** Always, in any production deployment that needs SIEM export, retention policies, or legal-hold enforcement.

---

### `AGENTIC_OPERATION_AUDIT_HOOK`

Same shape, for F5 long-running operations. Fires on `started`, `progress`, `finished`, `failed`.

**Signature:** [projects/agentic-ui/src/lib/registries/operation-registry.ts:36](../../projects/agentic-ui/src/lib/registries/operation-registry.ts#L36)

**Stability:** Public API. Frozen event shape.

**When to override:** Same as above.

---

## Tier 1.5 — Opt-in registry mirror (M1 R2 — landed)

### `RegistryBase.setProviderHook(hook)` + `RegistryProviderHook<TDef>`

Opt-in write-through mirror for state-bound registries (Approval, Operation, future Memory). When installed, every register / remove / removeBySource event mirrors to the hook *after* in-memory state updates. Reads never consult the hook. Hook errors land on telemetry, never propagate to callers.

**Signature:** [projects/agentic-ui/src/lib/registries/registry-provider-hook.ts](../../projects/agentic-ui/src/lib/registries/registry-provider-hook.ts)

```ts
export interface RegistryProviderHook<TDef extends RegistryEntry> {
  onRegister(def: TDef): void;
  onRemove(name: string): void;
  onRemoveBySource(source: string): void;
  onScopePolicyChange?(policy: RegistryScopePolicy): void;
}

// Adopter:
inject(ApprovalRegistry).setProviderHook(redisHook);
inject(ApprovalRegistry).setProviderHook(null);  // detach
```

**Stability:** Public API. Frozen contract per ADR-010 D4. Method is sync; hook implementations may dispatch async work internally (e.g., a Redis write) but the registry's API stays sync.

**Restricted to state-bound replayable registries:** Approval, Operation, future Memory. **Not legal** for Tool / Component / Action / Intent / Form / Backend / Mfe / Validation / Persistence / Layout / SchemaTransformer / Capability — those hold Angular class identities (component constructors, tool handlers) that don't round-trip through external state. See [ADR-011](../adr/0011-registry-provider-hook.md) D5.

**When to override:** Multi-pod deployments that need approvals or long-running operations to converge across pods + survive restarts. Pair with the upcoming `ThreadStateStore` adapter (Redis / Postgres) in [@maverick/agentic-ui-server-stores](../../projects/agentic-ui-server-stores/) (M1 R3 — not yet shipped).

**Telemetry events emitted:**
- `agentic.registry.hook_installed` — once per `setProviderHook` call
- `agentic.registry.hook_error` — when a hook method throws

---

## Tier 2 — Server-side seams (M1 R3 — landed)

These seams live in `@maverick/agentic-ui-server` (the runtime's server companion). They aren't accessible from the browser; they're consumed by the agent server (the Hono / Express / etc. process that hosts agents + routes AG-UI events). Documented here for completeness — they're equally part of the platform contract surface.

### `ThreadStateStore<TState>`

Per-thread state persistence. Used by the orchestrator's sticky-by-thread routing so state survives restarts + converges across multi-pod deployments. Async by design (the adapter implementation may cross the wire).

**Signature:** [`projects/agentic-ui-server/src/thread-state-store.ts`](../../projects/agentic-ui-server/src/thread-state-store.ts)

**Default:** `InMemoryThreadStateStore<TState>` ships in `agentic-ui-server`. Adequate for single-pod + tests.

**Production adapters** (NEW — `@maverick/agentic-ui-server-stores` package, M1 R3):

| Adapter | Backed by | Subpath import | Best for |
|---|---|---|---|
| `RedisThreadStateStore` | `ioredis ^5.4` (peer dep) | `@maverick/agentic-ui-server-stores/redis` | Lowest write latency; TTL via Redis `EX` |
| `PostgresThreadStateStore` | `pg ^8.11` (peer dep) | `@maverick/agentic-ui-server-stores/postgres` | Stronger durability; reuse existing Postgres |

Both peer deps are **optional** — install only the adapter you use. Subpath imports keep the unused peer dep from loading. Caller owns the client / pool lifecycle. See [ADR-012](../adr/0012-thread-state-store-adapters.md) for the design rationale.

**Stability:** Public API. Frozen contract per ADR-010 D4. Future adapters (DynamoDB, FoundationDB, Cloudflare Durable Objects) follow the same package-shape recipe.

---

## Tier 1 (continued) — `AGENTIC_RUN_STATE_PROVIDER` (M1 R4 — landed)

The reasoning-context provider used by `injectAgenticChat()` to populate `AgenticRunInput.state` on every run. Hosts override this to thread persona, matter, active route, or anything else the LLM should be aware of on each turn.

**Signature:** [projects/agentic-ui/src/lib/chat/run-state-provider.ts](../../projects/agentic-ui/src/lib/chat/run-state-provider.ts)

```ts
type AgenticRunStateProvider = () => Readonly<Record<string, unknown>>;

const AGENTIC_RUN_STATE_PROVIDER = new InjectionToken<AgenticRunStateProvider>(
  'AGENTIC_RUN_STATE_PROVIDER',
  { providedIn: 'root', factory: () => () => ({}) },
);
```

**Default:** `() => ({})` — equivalent to v1.2 behaviour. AG-UI still sends `state: {}` on the wire when no provider is registered.

**When to override:** any multi-persona host that wants the LLM to *reason* with awareness of the active context. Closing over signals / services / stores in the provider's closure lets the runtime call it once per run for a consistent snapshot.

**Crucial layering:** state is **not** a security boundary. `setScopePolicy` (above) is the trust gate that filters `tools[]` before the request leaves the browser. State only lets the agent phrase responses appropriately. See [ADR-013](../adr/0013-agui-state-channel.md) §D4 for the full layering rationale.

**Stability:** Public API. Frozen contract per ADR-010 D4.

**Wire mapping by backend:**
- AG-UI: forwarded as `RunAgentInput.state`. Server-side agents read `input.state` and decide what to do (typical: prepend a context block to the system instruction).
- Hashbrown / A2UI: silently dropped today. Their owners can add a state channel if/when consumer demand justifies it.

---

## Tier 1.5 (continued) — `RegistryEntry` governance metadata (M1 R5 — landed)

Optional fields available on every `RegistryEntry` subtype (`ToolDef`, `ComponentDef`, etc.). Hosts and remotes that don't supply them see no behavior change. See [ADR-014](../adr/0014-governance-hooks.md).

| Field | Type | Enforced by runtime? | Purpose |
|---|---|---|---|
| `requiredHostVersion` | `string` (semver range) | ✅ `register()` skips on mismatch | Federation-version compatibility |
| `tags` | `readonly string[]` | ❌ stored only | Catalog filtering, telemetry partitioning |
| `owner` | `string` | ❌ stored only | Accountability |
| `lifecycle` | `'draft' \| 'published' \| 'deprecated' \| 'disabled'` | ❌ stored only — host's scope policy may filter | Lifecycle gating |

Supported semver-range syntax for `requiredHostVersion`: `1.2.3`, `=1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`, `>1.2.3`, `<2.0.0`, `<=1.2.3`. Compound / x-range / pre-release / build-metadata variants fail-safe to `false` (skipped registration). Full list in [`projects/agentic-ui/src/lib/registries/semver-match.ts`](../../projects/agentic-ui/src/lib/registries/semver-match.ts) — no `semver` dep, ~110 LOC inline matcher.

`LIB_VERSION` lives in [`projects/agentic-ui/src/lib/version.ts`](../../projects/agentic-ui/src/lib/version.ts) and is sync'd by release tooling against `package.json`.

**Telemetry event added:** `agentic.registry.host_version_mismatch` fires when `register()` skips a registration due to incompatibility. Operators monitor this in their pipeline.

---

## What the v3 plan adds (still pending)

M1 R1–R5 are all landed.

These join this document as they ship. Each is purely additive; the existing 12 tokens + 2 registry methods + 12 factories + 1 mirror-hook + 1 server-side store interface (with 3 adapters) + 4 governance-metadata fields don't change.

---

## What's **not** a platform contract

To prevent contract creep, the following are **not** platform-level seams. Treat them as internal:

- ❌ `RegistryBase` constructor — internal. Don't extend `RegistryBase` from outside the lib; use the existing 15 registries or wait for a sanctioned hook.
- ❌ Internal helpers in `chat/`, `composition/`, `forms/`, `workflows/`, `validation/` — internal. These can change without notice.
- ❌ Audit chain hashing function (FNV-1a) — internal. The chain shape is observable through audit hooks; the hash function isn't.
- ❌ The closed-AST predicate evaluator's parser — internal. The DSL grammar (`===`, `!==`, `&&`, `||`, dotted access, parens, literals; own-property only) is the public contract; the parser implementation is not.
- ❌ Native Federation runtime details — federation is a contract via `MFE_REGISTRY_SOURCE`, not via internal `loadRemoteCapabilities` calls.

If you find yourself needing access to one of these, open an issue / RFC requesting that we promote it to a platform contract. Don't reach into internals.

---

## Reading this document later

When debugging a host-app integration, ask:

1. **What's the shape of my problem?** (Observability? Federation? Persona? Audit? Validation?)
2. **Which seam matches?** (Look at the Tier 1/2/3 table above.)
3. **What's the default doing?** (Defaults are listed; if the default doesn't match your need, override.)
4. **What's the override syntax?** (Each section has the exact provider snippet.)

When reviewing a PR, ask:

1. **Does this PR introduce a new seam?** (If yes, it requires an RFC.)
2. **Does this PR change the shape of an existing seam?** (If yes, it's a breaking change — reject under ADR-010 D4.)
3. **Does this PR add a hard dependency to the runtime?** (If yes, it must be opt-in via a seam — reject otherwise under ADR-010 D3.)

---

## Related

- [ADR-002 — Layered registry system](../adr/0002-layered-registry-system.md) — the original 13-registry decision (now 15)
- [ADR-008 — Registry scope policy](../adr/0008-registry-scope-policy.md) — `setScopePolicy` filter-on-read
- [ADR-009 — Approval intercept and audit hook](../adr/0009-approval-intercept-and-audit-hook.md) — F4 audit-hook design
- [ADR-010 — Platform principles, Apache 2.0, codified non-goals](../adr/0010-platform-principles-and-license.md) — the contracts this document codifies operationally
- [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md) §3 — three-tier reference architecture
- [docs/cookbook/swap-backend.md](../cookbook/swap-backend.md) — example: swapping `AgenticBackend` implementations
- [docs/cookbook/observability.md](../cookbook/observability.md) — example: wiring `AGENTIC_TELEMETRY_SINK`
- [docs/cookbook/context-aware-agent.md](../cookbook/context-aware-agent.md) — example: `setScopePolicy` + `AGENTIC_ACTIVE_PERSONA` end-to-end
