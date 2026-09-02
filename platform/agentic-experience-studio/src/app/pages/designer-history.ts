import { DestroyRef, computed, effect, inject, signal, untracked, type Signal } from '@angular/core';

/** Undo/redo handle a designer exposes to its toolbar. */
export interface UndoRedo {
  readonly canUndo: Signal<boolean>;
  readonly canRedo: Signal<boolean>;
  undo(): void;
  redo(): void;
}

/**
 * Snapshot-based undo/redo for a designer. Records a JSON snapshot of `state()`
 * whenever it changes (after `ready()`), and restores via `apply()`. History
 * lives for the life of the component instance — it is CLEARED only on reload
 * (a fresh component), so it SURVIVES a save (save doesn't recreate the
 * designer). ⌘Z / ⌘⇧Z (and Ctrl on Windows/Linux) are wired automatically,
 * ignored while typing in an input/textarea/select.
 *
 * MUST be called in an injection context (a designer constructor).
 *
 * @param state  read the editable state (signal getters); the FULL edited value
 * @param apply  set the editable state back from a restored snapshot
 * @param ready  only start recording once the initial load is done (optional)
 */
export function createHistory<T>(opts: {
  state: () => T;
  apply: (s: T) => void;
  ready?: () => boolean;
  keyboard?: boolean;
}): UndoRedo {
  const past = signal<string[]>([]);   // includes the current state at the top
  const future = signal<string[]>([]);

  // Record genuine edits. Depends ONLY on state(); past/future are read
  // untracked so undo/redo's own writes don't re-trigger recording.
  effect(() => {
    const snap = JSON.stringify(opts.state());
    if (opts.ready && !opts.ready()) return;
    untracked(() => {
      const p = past();
      if (p[p.length - 1] === snap) return; // unchanged, or the value we just restored
      past.set([...p.slice(-99), snap]);    // cap history depth
      if (future().length) future.set([]);  // a new edit forks the redo branch
    });
  });

  const canUndo = computed(() => past().length > 1);
  const canRedo = computed(() => future().length > 0);
  const restore = (snap: string) => opts.apply(JSON.parse(snap) as T);

  const api: UndoRedo = {
    canUndo,
    canRedo,
    undo() {
      const p = past();
      if (p.length <= 1) return;
      future.update((f) => [p[p.length - 1], ...f]);
      const rest = p.slice(0, -1);
      past.set(rest);
      restore(rest[rest.length - 1]);
    },
    redo() {
      const f = future();
      if (!f.length) return;
      const next = f[0];
      future.set(f.slice(1));
      past.update((p) => [...p, next]);
      restore(next);
    },
  };

  if (opts.keyboard !== false) {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); api.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); api.redo(); }
    };
    document.addEventListener('keydown', onKey);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('keydown', onKey));
  }

  return api;
}
