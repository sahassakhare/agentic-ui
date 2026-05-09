import type { RegistryEntry } from '../types/registry-defs';
import type { RegistryScopePolicy } from './registry-base';

/**
 * Opt-in write-through mirror for state-bound replayable registries
 * (Approval, Operation, future Memory). Installed via
 * {@link RegistryBase.setProviderHook}.
 *
 * Semantics — see [ADR-011](../../../../../docs/adr/0011-registry-provider-hook.md):
 *
 * - **In-memory state is authoritative.** The hook is a write-through
 *   mirror, never the source of truth at the registry layer. Reads
 *   (`list()` / `get()` / `signal()`) never consult the hook.
 * - **Sync, not async.** Hooks fire after in-memory state is updated.
 *   The hook implementation may dispatch async work internally
 *   (e.g., a Redis write), but the registry's API contract stays
 *   synchronous.
 * - **Errors do not propagate.** A hook that throws is caught,
 *   telemetry-emitted as `registry.hook.error`, and the in-memory
 *   write stands. Operators monitor telemetry; consumers are
 *   unaffected.
 * - **Restricted to state-bound registries.** Tool / Component /
 *   Action / Intent / Form / Backend / Mfe / Validation / Persistence
 *   / Layout / SchemaTransformer / Capability registries hold
 *   Angular class identities (component constructors, tool handlers)
 *   that can't round-trip through external state. Attempting to
 *   install a hook on those registries throws — see ADR-011 D5.
 *
 * @example
 * ```ts
 * class RedisApprovalHook implements RegistryProviderHook<ApprovalDef> {
 *   constructor(private redis: RedisClient, private tenantId: string) {}
 *
 *   onRegister(def: ApprovalDef): void {
 *     // Fire-and-forget; failures land on telemetry, not the caller.
 *     this.redis.hset(`approvals:${this.tenantId}`, def.approvalId, JSON.stringify(def));
 *   }
 *
 *   onRemove(name: string): void {
 *     this.redis.hdel(`approvals:${this.tenantId}`, name);
 *   }
 *
 *   onRemoveBySource(source: string): void {
 *     // Optional: batch-delete all entries with this source via a
 *     // Redis transaction or LUA script. The per-entry onRemove
 *     // calls have already fired; this is for adapters that prefer
 *     // batch ops.
 *   }
 * }
 * ```
 */
export interface RegistryProviderHook<TDef extends RegistryEntry> {
  /**
   * Called after `RegistryBase.register(def)` writes to in-memory
   * state. In-memory state is already updated; this is the mirror.
   * Errors are caught + telemetry-logged as `registry.hook.error`;
   * they do not propagate.
   */
  onRegister(def: TDef): void;

  /**
   * Called from the disposer returned by `register()` (single-entry
   * removal) and during `removeBySource(source)` for each matching
   * entry. Fires *before* the in-memory delete (so a hook failure
   * leaves the external store in sync with the not-yet-cleared
   * in-memory state — easier to reconcile on next read than the
   * opposite ordering).
   */
  onRemove(name: string): void;

  /**
   * Called once during `removeBySource(source)` after every per-entry
   * `onRemove` has fired. Lets the hook batch-commit a single
   * delete-where to its external store instead of N individual
   * deletes.
   */
  onRemoveBySource(source: string): void;

  /**
   * Optional. Called when `setScopePolicy(policy)` is invoked. Most
   * adopters don't need to mirror scope policy changes (the policy
   * is host-process scoped); omit this method if not needed.
   */
  onScopePolicyChange?(policy: RegistryScopePolicy): void;
}
