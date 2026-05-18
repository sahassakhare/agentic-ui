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

  /**
   * Set the workspace slot map. Persists via the registered adapter.
   *
   * Migration: rewrites legacy `documentPreview` / `tagPanel` component
   * names to the post-rename `…Slot` variants. Covers callers (the
   * agent's tool handler, an external SlotMap event) that might still
   * have the old names baked into their state.
   */
  set(slots: SlotMap): void {
    const migrated = migrateSlotNames(slots);
    this._slots.set(migrated);
    void this.adapter?.write(this.keyFor(this.persona.active()), migrated).catch(() => {
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
   *
   * Migration: persisted slot maps from before the 2026-05-18 widget
   * rename may carry the old `documentPreview` / `tagPanel` component
   * names. Those collide with the federated review remote's tool-result
   * widgets (which require 8+ inputs) and crash the slot with NG0950.
   * Rewrite to the `…Slot` names so existing users aren't broken.
   */
  private readonly _hydrate = effect(() => {
    const personaId = this.persona.active();
    if (!this.adapter) {
      this._slots.set(null);
      return;
    }
    void this.adapter.read(this.keyFor(personaId))
      .then((value) => {
        const raw = value as SlotMap | undefined;
        if (!raw) { this._slots.set(null); return; }
        const migrated = migrateSlotNames(raw);
        this._slots.set(migrated);
        // Persist the migration so subsequent reads don't re-do the work.
        if (migrated !== raw) {
          void this.adapter?.write(this.keyFor(personaId), migrated).catch(() => { /* noop */ });
        }
      })
      .catch(() => this._slots.set(null));
  });
}

/**
 * Pre-rename → post-rename component-name map. Returns the original
 * slot map (same reference) when no migration is needed so the caller
 * can detect a no-op cheaply.
 */
function migrateSlotNames(slots: SlotMap): SlotMap {
  const RENAME: Record<string, string> = {
    documentPreview: 'documentPreviewSlot',
    tagPanel:        'tagPanelSlot',
  };
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [slotName, def] of Object.entries(slots)) {
    const d = def as { component?: string } & Record<string, unknown>;
    if (d.component && RENAME[d.component]) {
      next[slotName] = { ...d, component: RENAME[d.component] };
      changed = true;
    } else {
      next[slotName] = d;
    }
  }
  return (changed ? next : slots) as SlotMap;
}
