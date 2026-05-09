import { computed, inject, Signal, signal } from '@angular/core';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type { RegistryEntry } from '../types/registry-defs';
import type { RegistryProviderHook } from './registry-provider-hook';
import { LIB_VERSION } from '../version';
import { satisfies } from './semver-match';

/**
 * Hook that decides whether an entry is visible at the moment of a
 * `list()` / `get()` / `signal()` read. Set via
 * {@link RegistryBase.setScopePolicy}.
 *
 * The policy CLOSES OVER whatever live state it depends on — typically
 * an Angular `signal()` carrying the active persona / scope id. Each
 * `signal()` reader that touches the registry's filtered output will
 * recompute when the captured signal changes, because the policy is
 * called inside a `computed`.
 *
 * Returning `true` shows the entry; returning `false` hides it. An
 * entry without a `scopes` field is considered scope-less and the
 * policy is responsible for deciding the default ('hide if scoped'
 * vs 'show if no scope'). The default policy ships as
 * {@link permissiveScopePolicy} which shows everything.
 *
 * @remarks
 * **Why filter on read, not register.** A federated MFE may contribute
 * an entry whose scope is broader than the current user — e.g. a
 * tool tagged `['lead-counsel']` from a remote loaded for everyone.
 * Filtering at register-time would lose that entry permanently for
 * other users; filtering on read keeps the remote portable.
 */
export type RegistryScopePolicy = (entry: RegistryEntry) => boolean;

/** Default policy — every entry is visible. */
export const permissiveScopePolicy: RegistryScopePolicy = () => true;

/**
 * Convenience policy — reads the active scope from a getter (typically
 * `() => personaService.active()`) and checks it against each entry's
 * `scopes` list. Entries without a `scopes` field stay visible
 * (scope-less means "any active scope can see this").
 *
 * @example
 * ```ts
 * inject(ToolRegistry).setScopePolicy(
 *   activeScopePolicy(() => persona.active()),
 * );
 * ```
 */
export function activeScopePolicy(getActiveScope: () => string | null | undefined): RegistryScopePolicy {
  return (entry) => {
    if (!entry.scopes || entry.scopes.length === 0) return true;
    const active = getActiveScope();
    if (!active) return false;
    return entry.scopes.includes(active);
  };
}

/**
 * What to do when `register()` is called with a name that's already taken.
 *
 * - `'replace'` *(default — backward-compatible with pre-conflict-policy
 *   behaviour)* — silently overwrite. The previous entry's `onDispose` is
 *   awaited, then the new entry takes its slot. Telemetry records
 *   `registry.entry.replaced: true`.
 * - `'throw'` — `register()` throws synchronously with a descriptive
 *   error. Use this on the host when you want unambiguous behaviour and
 *   are willing to fail loud during boot.
 * - `'first-wins'` — keep the existing entry, silently drop the new one.
 *   Telemetry records `registry.entry.dropped: true`. Useful when remotes
 *   load in priority order and you want the highest-priority one to
 *   anchor the name.
 * - `'namespace'` — automatically prefix the new entry's name with its
 *   `source` (e.g. `bookFlight` from `remote:bookings` becomes
 *   `bookings.bookFlight`). Both entries coexist. Useful when two
 *   teams legitimately want a tool named the same thing for their
 *   own users; lets you keep the originals callable by full name.
 */
export type ConflictPolicy = 'replace' | 'throw' | 'first-wins' | 'namespace';

export interface Registry<TDef extends RegistryEntry> {
  register(def: TDef): () => void;
  registerAll(defs: readonly TDef[]): () => void;
  get(name: string): TDef | undefined;
  list(): readonly TDef[];
  readonly signal: Signal<readonly TDef[]>;
  removeBySource(source: string): void;
}

export abstract class RegistryBase<TDef extends RegistryEntry> implements Registry<TDef> {
  private readonly entries = signal<readonly TDef[]>([]);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);

  /**
   * Strategy applied when a `register()` call collides with an existing
   * entry of the same name. Mutable so apps can override per-registry
   * after injection without subclassing — e.g.
   * `inject(ToolRegistry).conflictPolicy = 'throw'`. Defaults to
   * `'replace'` (the original behaviour). See {@link ConflictPolicy}.
   */
  conflictPolicy: ConflictPolicy = 'replace';

  /**
   * Active scope policy — re-runs on every `list()` / `get()` /
   * `signal()` read. Defaults to {@link permissiveScopePolicy} (show
   * everything). Apps install their own via {@link setScopePolicy}.
   */
  private readonly scopePolicy = signal<RegistryScopePolicy>(permissiveScopePolicy);

  /**
   * Replace the scope policy. Triggers re-evaluation of the filtered
   * signal so any subscribers see the new view immediately.
   *
   * @example
   * ```ts
   * // app.config.ts — applied once at boot
   * provideAppInitializer(() => {
   *   inject(ToolRegistry).setScopePolicy(
   *     activeScopePolicy(() => inject(PersonaService).active()),
   *   );
   * });
   * ```
   */
  setScopePolicy(policy: RegistryScopePolicy): void {
    this.scopePolicy.set(policy);
    this.telemetry.emit('agentic.registry.scope_policy_set', {
      'registry.name': this.registryName,
    });
    this.invokeHook((h) => h.onScopePolicyChange?.(policy));
  }

  /**
   * Active write-through provider hook. `null` (default) means
   * in-memory only — every behaviour matches v1.2 exactly. When a
   * hook is installed, register / remove / removeBySource events
   * fan out to the hook AFTER the in-memory state is updated. The
   * hook is opt-in and revocable; pass `null` to detach.
   *
   * See [ADR-011](../../../../../docs/adr/0011-registry-provider-hook.md)
   * for semantics, restricted-registry-class allow-list, and error
   * handling. See {@link RegistryProviderHook} for the interface.
   */
  private readonly providerHook = signal<RegistryProviderHook<TDef> | null>(null);

  /**
   * Install (or detach with `null`) a {@link RegistryProviderHook}.
   * The hook fires after every in-memory write, never on reads.
   * Hook errors are caught and routed to telemetry as
   * `agentic.registry.hook_error`; they never propagate to the
   * caller.
   */
  setProviderHook(hook: RegistryProviderHook<TDef> | null): void {
    this.providerHook.set(hook);
    this.telemetry.emit('agentic.registry.hook_installed', {
      'registry.name': this.registryName,
      'registry.hook.attached': hook !== null,
    });
  }

  /**
   * Internal helper — invoke `fn` against the active provider hook
   * (if any), catching errors so the in-memory write path stays
   * intact. Errors land on the telemetry sink so operators can
   * monitor mirror failures without breaking adopters.
   */
  private invokeHook(fn: (hook: RegistryProviderHook<TDef>) => void): void {
    const hook = this.providerHook();
    if (!hook) return;
    try {
      fn(hook);
    } catch (err) {
      this.telemetry.emit('agentic.registry.hook_error', {
        'registry.name': this.registryName,
        'error.message': err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Filtered, signal-aware view. Public callers should prefer this —
   * `entries()` is the raw, unfiltered list (kept private so the
   * scope policy is the single point of truth). Each read takes a
   * snapshot of `entries()` and applies the current policy.
   */
  readonly signal: Signal<readonly TDef[]> = computed(() => {
    const policy = this.scopePolicy();
    return this.entries().filter((e) => policy(e));
  });

  /** Discriminator used by telemetry: 'tool', 'component', 'backend', etc. */
  protected abstract readonly registryName: string;

  /**
   * Register `def` under the registry. Behaviour on a name collision is
   * governed by the constructor's `conflictPolicy` (see
   * {@link ConflictPolicy}).
   *
   * @returns A disposer that removes the entry (and runs its
   *          `onDispose` hook) when called.
   * @throws  Error when the policy is `'throw'` and the name already exists.
   */
  register(def: TDef): () => void {
    // ADR-014 — host-version compatibility check. When `def.requiredHostVersion`
    // is set + doesn't match `LIB_VERSION`, skip registration silently
    // (telemetry-logged) and return a no-op disposer. Lets federated
    // remotes ship capabilities pinned to a major + decline to surface
    // them in incompatible hosts without crashing the host.
    if (def.requiredHostVersion && !satisfies(LIB_VERSION, def.requiredHostVersion)) {
      this.telemetry.emit('agentic.registry.host_version_mismatch', {
        'registry.name': this.registryName,
        'registry.entry.name': def.name,
        'registry.entry.source': def.source ?? 'host',
        'registry.entry.required_host_version': def.requiredHostVersion,
        'registry.host_version': LIB_VERSION,
      });
      return () => {};
    }

    const existing = this.entries().find((e) => e.name === def.name);

    if (existing) {
      switch (this.conflictPolicy) {
        case 'throw':
          throw new Error(
            `[${this.registryName}Registry] entry "${def.name}" is already registered ` +
            `(source=${existing.source ?? 'host'}). Cannot register duplicate from source=${def.source ?? 'host'}.`,
          );

        case 'first-wins':
          this.telemetry.emit('agentic.registry.dropped', {
            'registry.name': this.registryName,
            'registry.entry.name': def.name,
            'registry.entry.source': def.source ?? 'host',
            'registry.entry.kept_source': existing.source ?? 'host',
          });
          // Return a no-op disposer — caller didn't actually register.
          return () => {};

        case 'namespace': {
          // Prefix with source if it's a remote; if it's host (or undefined),
          // there's no useful namespace to apply, so fall through to replace.
          const ns = def.source && def.source.startsWith('remote:')
            ? def.source.slice('remote:'.length)
            : null;
          if (ns) {
            const namespaced = { ...def, name: `${ns}.${def.name}` } as TDef;
            this.telemetry.emit('agentic.registry.namespaced', {
              'registry.name': this.registryName,
              'registry.entry.original_name': def.name,
              'registry.entry.namespaced_name': namespaced.name,
              'registry.entry.source': def.source ?? 'host',
            });
            // Recurse — the namespaced entry shouldn't itself collide
            // (unless two remotes share the same source name, which is
            // its own bug). Use the policy of the recursive call to
            // avoid infinite loops.
            if (this.entries().some((e) => e.name === namespaced.name)) {
              // Same name even after namespacing — fall through to replace.
              return this.applyReplace(namespaced, this.entries().find((e) => e.name === namespaced.name));
            }
            return this.applyReplace(namespaced, undefined);
          }
          // No usable namespace — replace.
          return this.applyReplace(def, existing);
        }

        case 'replace':
        default:
          return this.applyReplace(def, existing);
      }
    }

    return this.applyReplace(def, undefined);
  }

  /**
   * Internal helper — common path for `'replace'`, `'namespace'` (when no
   * conflict survives), and the no-collision branch. Awaits the previous
   * entry's `onDispose` (if any) before storing the new one.
   */
  private applyReplace(def: TDef, displaced: TDef | undefined): () => void {
    if (displaced) void this.runDispose(displaced);

    this.entries.update((current) => [...current.filter((e) => e.name !== def.name), def]);

    this.telemetry.emit('agentic.registry.register', {
      'registry.name': this.registryName,
      'registry.entry.name': def.name,
      'registry.entry.source': def.source ?? 'host',
      'registry.entry.replaced': displaced !== undefined,
      'registry.entry_count_after': this.entries().length,
    });
    this.telemetry.counter('agentic.registry.size', this.entries().length, {
      'registry.name': this.registryName,
    });

    // Mirror the write to the provider hook (if any). Fires AFTER
    // in-memory state is updated so a hook failure leaves in-memory
    // state intact. See ADR-011.
    this.invokeHook((h) => h.onRegister(def));

    return () => this.removeByName(def.name);
  }

  registerAll(defs: readonly TDef[]): () => void {
    const disposers = defs.map((d) => this.register(d));
    return () => disposers.forEach((d) => d());
  }

  /**
   * Return an entry by name, honouring the current scope policy. An
   * entry hidden by the policy reads as `undefined` — same as if it
   * weren't registered. Use {@link RegistryBase.getRaw} when you
   * need the entry regardless of scope.
   */
  get(name: string): TDef | undefined {
    const policy = this.scopePolicy();
    const found = this.entries().find((e) => e.name === name);
    return found && policy(found) ? found : undefined;
  }

  /**
   * Bypass the scope policy. Used internally by `register()` to detect
   * collisions and by tooling that needs to see the full registry.
   * Apps should prefer `get()` so the scope filter applies uniformly.
   */
  getRaw(name: string): TDef | undefined {
    return this.entries().find((e) => e.name === name);
  }

  /** Filtered list — honours the active scope policy. */
  list(): readonly TDef[] {
    const policy = this.scopePolicy();
    return this.entries().filter((e) => policy(e));
  }

  /** Unfiltered list — every registered entry, scope-blind. */
  listRaw(): readonly TDef[] {
    return this.entries();
  }

  /**
   * Remove every entry whose `source` matches. Used by the federation
   * runtime when a remote unloads. Each removed entry's `onDispose`
   * hook is invoked (errors swallowed and routed to telemetry, so one
   * misbehaving hook can't poison the sweep).
   */
  removeBySource(source: string): void {
    const removed: TDef[] = [];
    this.entries.update((current) => {
      const kept: TDef[] = [];
      for (const e of current) {
        if (e.source === source) removed.push(e);
        else kept.push(e);
      }
      return kept;
    });

    if (removed.length > 0) {
      for (const e of removed) {
        // Per-entry hook fan-out — fires AFTER in-memory removal so
        // a hook failure can't leave the registry in a half-removed
        // state. See ADR-011 D3.
        this.invokeHook((h) => h.onRemove(e.name));
        void this.runDispose(e);
      }
      // Batch-commit hook AFTER all per-entry calls have fired.
      // Adapters that prefer batch deletes use this; per-entry
      // adapters can leave it as a no-op.
      this.invokeHook((h) => h.onRemoveBySource(source));
      this.telemetry.emit('agentic.registry.remove', {
        'registry.name': this.registryName,
        'registry.entry.source': source,
        'registry.entries_removed': removed.length,
        'registry.entry_count_after': this.entries().length,
      });
    }
  }

  private removeByName(name: string): void {
    const removed = this.entries().find((e) => e.name === name);
    this.entries.update((current) => current.filter((e) => e.name !== name));
    if (removed) {
      this.invokeHook((h) => h.onRemove(name));
      void this.runDispose(removed);
    }
  }

  /**
   * Invoke `entry.onDispose` if defined. Catches both sync throws and
   * rejected promises so a single misbehaving hook can't break a
   * teardown sweep — failures land on the telemetry sink instead.
   */
  private async runDispose(entry: TDef): Promise<void> {
    if (typeof entry.onDispose !== 'function') return;
    try {
      await entry.onDispose();
    } catch (err) {
      this.telemetry.emit('agentic.registry.dispose_failed', {
        'registry.name': this.registryName,
        'registry.entry.name': entry.name,
        'registry.entry.source': entry.source ?? 'host',
        'error.message': err instanceof Error ? err.message : String(err),
      });
    }
  }
}
