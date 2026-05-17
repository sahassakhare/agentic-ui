import { Injectable, signal } from '@angular/core';

/**
 * Slot-keyed handoff store for tool results that should mount on a
 * destination route rather than inline in the chat panel
 * (plan R1 — render-target routing).
 *
 * **Lifecycle.** A tool handler that wants its widget to mount on a
 * specific route stashes the components here keyed by slot name
 * (e.g. `holds.primary`), then navigates via Angular Router. The
 * destination page hosts a `<mvk-agentic-slot name="holds.primary">`
 * element which `consume()`s the components on activation, mounts them
 * via `<mvk-widget-container>`, and clears the slot so a refresh
 * doesn't re-mount stale state.
 *
 * Designed to live for the lifetime of the app (root-scoped, signal-
 * backed). Not persisted — handoffs are intra-session by design.
 *
 * @example
 * ```ts
 * // In a tool handler:
 * env.get(RenderHandoffStore).publish('holds.primary', [
 *   { name: 'legalHoldCard', props: {...} },
 * ]);
 * env.get(Router).navigate(['/holds']);
 * return { markdown: 'Opened in /holds — view there.' };
 * ```
 */
export interface ComponentSpec {
  readonly name: string;
  readonly props: unknown;
}

@Injectable({ providedIn: 'root' })
export class RenderHandoffStore {
  /** Map of slot name -> components, exposed as a signal so the
   *  destination page's slot component reacts when a handoff is
   *  published. */
  readonly slots = signal<Readonly<Record<string, readonly ComponentSpec[]>>>({});

  /** Stash components for a slot. Overwrites any prior value at the
   *  same slot — last writer wins, which matches the chat-shell
   *  pattern where a fresh tool result replaces the previous one. */
  publish(slot: string, components: readonly ComponentSpec[]): void {
    this.slots.update((s) => ({ ...s, [slot]: components }));
  }

  /** Read + clear the slot. Called by `<mvk-agentic-slot>` on
   *  activation. Returns an empty array if the slot is empty so the
   *  caller doesn't have to null-check. */
  consume(slot: string): readonly ComponentSpec[] {
    const cur = this.slots();
    const items = cur[slot] ?? [];
    if (items.length === 0) return items;
    const { [slot]: _drop, ...rest } = cur;
    void _drop;
    this.slots.set(rest);
    return items;
  }

  /** Peek without consuming — useful for tests + debug overlays. */
  peek(slot: string): readonly ComponentSpec[] {
    return this.slots()[slot] ?? [];
  }

  /** Drop everything. Used on tenant switch / sign-out. */
  clear(): void {
    this.slots.set({});
  }
}
