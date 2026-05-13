import { effect, inject, Injectable, signal } from '@angular/core';
import type { SlotMap } from '@infra-tools/agentic-ui';
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
 *     map per persona from localStorage. Switching persona in the
 *     header restores that persona's preferred workspace shape.
 *
 * Persistence key: `ediscovery.workspace-layout:<personaId>`. The
 * agent's writes are persisted automatically — a `prompt → reshape
 * → save → restore-after-refresh` round-trip works end-to-end.
 *
 * Out-of-scope: the LAYOUT_RENDER AG-UI event chain. This store
 * exposes the same SlotMap shape the event carries, but the wiring
 * is via a deliberate tool call so the agent's intent is auditable
 * (chain-hashed through the tool result, same as every other tool).
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceLayoutStore {
  private readonly persona = inject(PersonaService);

  private readonly _slots = signal<SlotMap | null>(null);
  readonly slots = this._slots.asReadonly();

  /** Set the workspace slot map. Saves to localStorage under the active persona. */
  set(slots: SlotMap): void {
    this._slots.set(slots);
    this.persist(slots);
  }

  /** Clear the slot map (the /workspace page falls back to its built-in default). */
  clear(): void {
    this._slots.set(null);
    try { localStorage.removeItem(this.keyFor(this.persona.active())); } catch { /* noop */ }
  }

  private persist(slots: SlotMap): void {
    try { localStorage.setItem(this.keyFor(this.persona.active()), JSON.stringify(slots)); } catch { /* noop */ }
  }

  private keyFor(personaId: string): string {
    return `ediscovery.workspace-layout:${personaId}`;
  }

  /** Rehydrate on construction + on persona switch. */
  private readonly _hydrate = effect(() => {
    const personaId = this.persona.active();
    try {
      const raw = localStorage.getItem(this.keyFor(personaId));
      if (raw) this._slots.set(JSON.parse(raw) as SlotMap);
      else     this._slots.set(null);
    } catch {
      this._slots.set(null);
    }
  });
}
