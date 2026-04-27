import { computed, inject, Signal, signal } from '@angular/core';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type { RegistryEntry } from '../types/registry-defs';

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

  readonly signal: Signal<readonly TDef[]> = computed(() => this.entries());

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

    return () => this.removeByName(def.name);
  }

  registerAll(defs: readonly TDef[]): () => void {
    const disposers = defs.map((d) => this.register(d));
    return () => disposers.forEach((d) => d());
  }

  get(name: string): TDef | undefined {
    return this.entries().find((e) => e.name === name);
  }

  list(): readonly TDef[] {
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
      for (const e of removed) void this.runDispose(e);
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
    if (removed) void this.runDispose(removed);
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
