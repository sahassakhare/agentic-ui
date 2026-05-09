# ADR-011 · `RegistryProviderHook<TDef>` — opt-in, sync, write-through mirror

**Status:** Accepted

**Date:** 2026-05-08

**Related:** [ADR-002](./0002-layered-registry-system.md) · [ADR-008](./0008-registry-scope-policy.md) · [ADR-010](./0010-platform-principles-and-license.md)

---

## Context

The runtime tier's 15 registries today are pure in-memory state. That's the right default per ADR-010 D3 (embedded-first), and it works for every single-tab use case. It does **not** work for two scenarios that real adopters will hit:

1. **Multi-pod deployments.** A user approves an action in pod A; pod B handling their next request must see the decision. Today, in-memory state in pod A is invisible to pod B.
2. **Cross-thread persistence.** An adopter wants approvals or long-running operations to survive a server restart. Today, restarting drops everything.

The v3 plan §4.1 R2 calls for an **opt-in `RegistryProviderHook<TDef>`** to address both. This ADR codifies the design.

The plan made three forcing decisions before this ADR could be drafted:

- **Sync, not async.** ADR-010 D4 (zero breaking changes) prevents making `register()` async. The hook must work within the existing sync contract.
- **Hook, not provider.** A "provider" implies replacement of in-memory state. A "hook" mirrors writes to an external store while keeping in-memory state authoritative.
- **Subset of registries, not all 15.** The 15 registries split into two classes: *fast-path identity-bound* (Tool / Component / Action / Intent / Form / Backend / Mfe / Validation / Persistence / Layout / SchemaTransformer / Capability) and *state-bound replayable* (Approval, Operation, future Memory). Only the second class can mirror to external state because their entries are reconstructible from data; the first class binds Angular class identities (component constructors, tool handlers) that can't round-trip through Redis.

This ADR is for the second class.

---

## Decision

### D1 — Interface shape

```ts
export interface RegistryProviderHook<TDef extends RegistryEntry> {
  /**
   * Called after `RegistryBase.register(def)` writes to in-memory state.
   * In-memory state is authoritative; this is a write-through mirror.
   * Errors are caught + logged via AGENTIC_TELEMETRY_SINK as
   * 'registry.hook.error'; they do not propagate.
   */
  onRegister(def: TDef): void;

  /**
   * Called from the disposer returned by `register()` (single-entry
   * removal) and during `removeBySource(source)` for each entry whose
   * source matches.
   */
  onRemove(name: string): void;

  /**
   * Called once during `removeBySource(source)`, AFTER the per-entry
   * `onRemove` calls. Lets the hook batch-commit a single delete-where
   * to its external store instead of N individual deletes.
   */
  onRemoveBySource(source: string): void;

  /**
   * Called when `setScopePolicy(policy)` is invoked. Optional —
   * hosts that don't need to sync scope policies to external state
   * (most cases) can omit it.
   */
  onScopePolicyChange?(policy: RegistryScopePolicy): void;
}
```

### D2 — Installation API

`RegistryBase` gains a `setProviderHook(hook)` method, mirroring the existing `setScopePolicy(policy)` shape:

```ts
abstract class RegistryBase<TDef extends RegistryEntry> {
  setProviderHook(hook: RegistryProviderHook<TDef> | null): void { /* ... */ }
}

// Adopter:
inject(ApprovalRegistry).setProviderHook(redisHook);

// Or via Angular DI:
provideAppInitializer(() => {
  inject(ApprovalRegistry).setProviderHook(inject(RedisHook));
});
```

This avoids forcing a constructor refactor across the 15 registry subclasses (all of which use `@Injectable({ providedIn: 'root' })` with no ctor today). It also makes the hook revocable — hosts can call `setProviderHook(null)` to detach (useful in test teardown).

When no hook is installed (the default), the registry behaves identically to v1.2 — no observable change.

### D3 — Mirror semantics (in-memory authoritative)

When a hook is installed:

1. `register(def)` writes to in-memory state first. If the in-memory write succeeds, `hook.onRegister(def)` is called.
2. If the hook throws, the error is caught, telemetry-emitted as `registry.hook.error`, and **not propagated**. The in-memory write stands.
3. The disposer returned from `register(def)` calls `hook.onRemove(def.name)` first, then deletes from in-memory state. (Order intentional: failure cases prefer "in external store but not memory" over "in memory but not external store" — easier to reconcile on next read.)
4. `removeBySource(source)` calls `hook.onRemove(name)` for each matching entry, then `hook.onRemoveBySource(source)` once, then deletes from in-memory state.

In-memory state is **always** authoritative. The hook is a write-through mirror, never the source of truth at the registry layer. (The external store may be the source of truth at the *deployment* layer, but reconstructing in-memory state from it is the job of the host, not the hook.)

### D4 — Read semantics (no change)

`list()`, `get(name)`, `signal()`, `removeBySource(source)`, `setScopePolicy(policy)` all read from in-memory state only. The hook is **never** consulted on reads. This preserves:

- Sync read latency (no network on read paths)
- The signal-driven reactivity model (Angular signals don't await)
- The scope-policy filter-on-read contract (ADR-008)

A pod that needs to see writes from another pod calls `register()` with the data the other pod wrote. Reconciliation is the host's job (not the hook's), via the `ThreadStateStore` (ADR-012, future) or whatever external state mechanism the host wires.

### D5 — Restricted to state-bound replayable registries

The hook is **only legal** for registries whose entries can be reconstructed from external state without breaking referential identity:

- ✅ `ApprovalRegistry` — entries carry `approvalId`, `state`, decision metadata; rehydratable from a JSON blob
- ✅ `OperationRegistry` — entries carry `opId`, `state`, progress data; rehydratable from a JSON blob
- ✅ Future `MemoryRegistry` — same shape

These registries are the ones where multi-pod / restart-survival matters. Their consumers (the chat shell, `<mvk-approval-card>`, `<mvk-operation-progress>`) read from the registry's signal; they don't keep references to per-entry objects across renders.

The hook is **explicitly disallowed** for:

- ❌ `ToolRegistry` — entries carry `handler: (args) => unknown` (Angular function reference, can't serialize)
- ❌ `ComponentRegistry` — entries carry `component: Type<TComponent>` (Angular class reference, can't serialize)
- ❌ `ActionRegistry`, `IntentRegistry`, `FormRegistry`, `Backend`, `Mfe`, `Validation`, `Persistence`, `Layout`, `SchemaTransformer`, `Capability` — same reason as Tool/Component

Enforcement: a runtime check in the hook's installation path validates the registry's `kind` against an allow-list. Attempting to install a hook on a disallowed registry throws with a clear error. Documented in [docs/architecture/platform-seams.md](../architecture/platform-seams.md) and the future [docs/cookbook/registry-provider-hook.md](../cookbook/registry-provider-hook.md).

### D6 — Conformance test contract

Every registry that supports the hook must pass the same conformance suite **with and without** a hook installed. Behavior must be identical from the consumer's perspective. The conformance suite verifies:

- `register(def)` returns a working disposer in both modes
- `list()` / `get(name)` / `signal()` return the same data in both modes
- `removeBySource(source)` cleans up the same set in both modes
- `setScopePolicy(policy)` filters the same set in both modes
- Hook errors don't propagate
- Hook is called for every mutation when installed
- Hook is **never** called when not installed (no perf regression)

The conformance suite lives at [`projects/agentic-ui/src/lib/registries/registry-base.spec.ts`](../../projects/agentic-ui/src/lib/registries/registry-base.spec.ts) and is extended in this PR.

### D7 — Telemetry

The hook integrates with `AGENTIC_TELEMETRY_SINK` for observability:

- `registry.hook.installed` — fired once when a hook is attached
- `registry.hook.error` — fired when a hook method throws (with the error + the registry name)
- `registry.hook.write_lag_ms` — optional histogram, populated by the hook implementation if it knows its write latency (Redis adapters can; in-memory cannot)

These integrate with the existing histogram support added in commit `c28e667` (Phase A PRR).

---

## Consequences

### Positive

- **Multi-pod deployments unblocked.** The hook is the seam through which `ThreadStateStore` (ADR-012) and any external state adapter wires.
- **No breaking change.** The 2nd ctor arg is optional; no existing call site is affected. Conformance tests run twice (with and without hook) to guarantee parity.
- **Telemetry-observable.** Hook errors don't fail silently; ops teams see `registry.hook.error` events in their pipeline.
- **Registry-class discipline.** D5's allow-list prevents misuse on identity-bound registries (the most likely contributor mistake).
- **Future-compatible.** The hook can grow new methods (e.g., `onUpsert(def, prev)` for diffing) as additive optional methods. No breaking change required.

### Negative

- **Two-phase write semantics.** Hosts must understand "in-memory authoritative + write-through mirror." If the external store falls behind, in-memory + external state can briefly diverge. This is acceptable because the host's reconciliation policy (typically: re-register from external state on pod restart) recovers eventually.
- **Hook errors are silent (telemetry-logged but not propagated).** This is intentional — propagating would break the registry's API contract — but operators must monitor `registry.hook.error` in their telemetry pipeline. This is documented in the cookbook.
- **No support for the fast-path registries.** Adopters who want Tool/Component federation across pods need a different mechanism (capability-prefetch with a per-pod registration step on remote-load). The v3 plan's M3 control-plane catalog handles this case via SSE-driven re-registration; not via this hook.

### Neutral

- The hook adds ~15 lines of code to `RegistryBase`. The conformance test extension adds ~80 lines. Total runtime overhead when no hook installed: zero (a single `if (this.hook)` check per mutation, branch-predictable).

---

## Alternatives considered

### A1 — Async `RegistryProvider` (the original ChatGPT plan)

Replace `RegistryBase`'s in-memory state with a provider that returns Promises.

**Rejected:** breaks ADR-010 D4 (zero breaking changes through v1.x). Every existing consumer would need to await registration. Workspace-wide breaking change for zero net gain in our use cases.

### A2 — External state as authoritative; in-memory as cache

Read-through cache pattern. External store is authoritative; reads can fall back to it on cache miss.

**Rejected:** breaks ADR-008 (sync `signal()` reads). External-store reads can't satisfy the sync-signal contract. Also breaks the embedded-first principle (no external store = no reads).

### A3 — Pub/sub from external store back to all pods

External store pushes change events to every pod, which then update their in-memory state.

**Rejected:** out of scope for this hook. Pub/sub is ADR-012's job (in `ThreadStateStore` adapter implementations) — Redis pub/sub for the Redis adapter, Postgres LISTEN/NOTIFY for the Postgres adapter. Decoupled from the registry layer.

### A4 — Don't add a hook; use audit hooks instead

Repurpose `AGENTIC_APPROVAL_AUDIT_HOOK` and `AGENTIC_OPERATION_AUDIT_HOOK` to also drive external-state mirroring.

**Rejected:** the audit hooks fire on lifecycle events (decided/started/finished), not on every register/remove. They're a different shape and a different abstraction. Conflating the two would muddle audit semantics. Audit hooks are append-only event logs; this hook is mutable-state mirror.

### A5 — Provide a default Redis-backed hook in the lib

Bundle a Redis hook implementation in the runtime tier.

**Rejected:** breaks ADR-010 D5 (no bundled DB integration in the runtime). Redis adapter lives in a sibling package (`@maverick/agentic-ui-server-stores`, ADR-012).

---

## Implementation

This ADR is implemented in the same PR as it lands. Files changed:

- `projects/agentic-ui/src/lib/registries/registry-provider-hook.ts` — new, ~50 LOC, the interface
- `projects/agentic-ui/src/lib/registries/registry-base.ts` — edit, +20 LOC, optional 2nd ctor arg + hook calls in mutations
- `projects/agentic-ui/src/lib/registries/registry-base.spec.ts` — extend, +80 LOC, with/without-hook conformance suite
- `projects/agentic-ui/src/public-api.ts` — export the new type
- [docs/architecture/platform-seams.md](../architecture/platform-seams.md) — promote `RegistryProviderHook` from "Future seam" to a documented Tier 1 contract

Out of scope for this PR (will be follow-ups):

- `ApprovalRegistry` opting into a hook (worked example) — separate PR
- `ThreadStateStore` interface + adapters — ADR-012, separate PR
- Cookbook entry — separate PR after first adopter

---

## References

- [ADR-002 — Layered registry system](./0002-layered-registry-system.md) — the original 13-registry decision (now 15)
- [ADR-008 — Registry scope policy](./0008-registry-scope-policy.md) — `setScopePolicy` filter-on-read
- [ADR-010 — Platform principles, license, non-goals](./0010-platform-principles-and-license.md) — D3 (embedded-first) and D4 (no breaking changes) constrain this design
- [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md) §4.1 R2 — the v3 plan entry that motivated this ADR
- [docs/architecture/platform-seams.md](../architecture/platform-seams.md) — where the hook will be documented as a Tier 1 platform contract once it ships
