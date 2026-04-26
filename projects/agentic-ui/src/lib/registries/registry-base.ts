import { computed, inject, Signal, signal } from '@angular/core';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type { RegistryEntry } from '../types/registry-defs';

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

  readonly signal: Signal<readonly TDef[]> = computed(() => this.entries());

  /** Discriminator used by telemetry: 'tool', 'component', 'backend', etc. */
  protected abstract readonly registryName: string;

  register(def: TDef): () => void {
    const existed = this.entries().some((e) => e.name === def.name);
    this.entries.update((current) => [...current.filter((e) => e.name !== def.name), def]);

    this.telemetry.emit('agentic.registry.register', {
      'registry.name': this.registryName,
      'registry.entry.name': def.name,
      'registry.entry.source': def.source ?? 'host',
      'registry.entry.replaced': existed,
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

  removeBySource(source: string): void {
    const before = this.entries().length;
    this.entries.update((current) => current.filter((e) => e.source !== source));
    const removed = before - this.entries().length;
    if (removed > 0) {
      this.telemetry.emit('agentic.registry.remove', {
        'registry.name': this.registryName,
        'registry.entry.source': source,
        'registry.entries_removed': removed,
        'registry.entry_count_after': this.entries().length,
      });
    }
  }

  private removeByName(name: string): void {
    this.entries.update((current) => current.filter((e) => e.name !== name));
  }
}
