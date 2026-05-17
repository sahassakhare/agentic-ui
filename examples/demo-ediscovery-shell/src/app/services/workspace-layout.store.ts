import { effect, inject, Injectable, signal } from '@angular/core';
import { PersistenceRegistry, type SlotMap } from '@infra-tools/agentic-ui';
import { PersonaService } from './persona.service';

/**
 * Signal-backed store for the active workspace layout on
 * `/workspace`. Two write paths:
 *
 *  1. **Agent.** The `setWorkspaceLayout` tool the LLM picks
 *     accepts a `SlotMap` and writes it here. The /workspace page
 *     subscribes via the `slots` signal so the change renders live
 *     without a navigation or page reload.
 *
 *  2. **Host.** A boot-time effect rehydrates the last-saved slot
 *     map per persona via `PersistenceRegistry`. Switching persona
 *     in the header restores that persona's preferred workspace
 *     shape.
 *
 * Persistence key: `ediscovery.workspace-layout:<personaId>`.
 *
 * Routed through `PersistenceRegistry.get('localStorage')` rather
 * than raw `localStorage.setItem` so the storage backend stays
 * swappable — adopters can register a Dexie / IndexedDB / server-
 * side adapter under the same name and the store flips over with
 * no code change here. That preserves the lib's seam: the registry
 * decides storage, the store decides semantics.
 *
 * Out-of-scope: the LAYOUT_RENDER AG-UI event chain. This store
 * exposes the same SlotMap shape the event carries, but the wiring
 * is via a deliberate tool call so the agent's intent is auditable
 * (chain-hashed through the tool result, same as every other tool).
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceLayoutStore {
  private readonly persona = inject(PersonaService);
  private readonly persistence = inject(PersistenceRegistry);

  /**
   * Default adapter — `localStorage` when available, `memory`
   * (in-memory Map) otherwise. Adopters that want IndexedDB swap
   * this in their `app.config.ts` by registering a Dexie adapter
   * named `localStorage` (or by changing this lookup name).
   */
  private readonly adapter = this.persistence.get('localStorage') ?? this.persistence.get('memory');

  private readonly _slots = signal<SlotMap | null>(null);
  readonly slots = this._slots.asReadonly();

  /** Set the workspace slot map. Persists via the registered adapter. */
  set(slots: SlotMap): void {
    this._slots.set(slots);
    void this.adapter?.write(this.keyFor(this.persona.active()), slots).catch(() => {
      /* swallow — store still has the in-memory signal value */
    });
  }

  /** Clear the slot map (the /workspace page falls back to its built-in default). */
  clear(): void {
    this._slots.set(null);
    void this.adapter?.remove(this.keyFor(this.persona.active())).catch(() => { /* noop */ });
  }

  private keyFor(personaId: string): string {
    return `ediscovery.workspace-layout:${personaId}`;
  }

  /**
   * Rehydrate on construction + on persona switch. Adapter reads
   * are async (Promise-based) so we fire-and-forget into the
   * signal — Angular's `effect()` runs synchronously and we set
   * the value once the read resolves.
   */
  private readonly _hydrate = effect(() => {
    const personaId = this.persona.active();
    if (!this.adapter) {
      this._slots.set(null);
      return;
    }
    void this.adapter.read(this.keyFor(personaId))
      .then((value) => this._slots.set((value as SlotMap | undefined) ?? null))
      .catch(() => this._slots.set(null));
  });
}
