import { computed, Injectable, signal, Signal } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { AgenticBackend } from '../types/agentic-backend';
import type { BackendDef } from '../types/registry-defs';

@Injectable({ providedIn: 'root' })
export class BackendRegistry extends RegistryBase<BackendDef> {
  protected readonly registryName = 'backend';

  private readonly activeId = signal<string | undefined>(undefined);
  private readonly instances = new Map<string, AgenticBackend>();

  readonly active: Signal<BackendDef | undefined> = computed(() => {
    const id = this.activeId();
    return id ? this.list().find((b) => b.id === id) : this.list()[0];
  });

  /** Switch the active backend. No-op if id is unknown. */
  setActive(id: string): void {
    if (this.list().some((b) => b.id === id)) {
      this.activeId.set(id);
    }
  }

  /** Lazily instantiate (and cache) the backend selected by `active()`. */
  resolveActive(): AgenticBackend | undefined {
    const def = this.active();
    if (!def) return undefined;
    let instance = this.instances.get(def.id);
    if (!instance) {
      instance = def.factory();
      this.instances.set(def.id, instance);
    }
    return instance;
  }
}
