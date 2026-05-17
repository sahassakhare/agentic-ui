import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ComponentRegistry } from '../registries/component-registry';
import { DashboardCanvasComponent } from './dashboard-canvas.component';
import type { DashboardDef, TileDef } from '../types/registry-defs';

/**
 * Bump a draft's version + parentVersion based on the previous
 * accepted def. Hosts call this in their `(commit)` handler before
 * writing the new def into the `DashboardRegistry`.
 *
 * Versioning is intentionally simple — `v1` → `v2` → `v3`. Hosts
 * wanting semver-style discipline can override per-call.
 *
 * @see [ADR-044 D5](../../../../docs/adr/0044-dashboard-registry.md#d5--sharing--versioning--governance-through-the-source--version--parentversion-fields)
 */
export function bumpDashboardVersion(prev: DashboardDef, draft: DashboardDef): DashboardDef {
  const next = nextVersion(prev.version);
  return { ...draft, version: next, parentVersion: prev.version };
}

function nextVersion(prev: string | undefined): string {
  if (!prev) return 'v1';
  const m = /^v?(\d+)$/.exec(prev);
  if (!m) return `${prev}+1`;
  return `v${parseInt(m[1] ?? '0', 10) + 1}`;
}

/**
 * Editable preview wrapper around `<mvk-dashboard-canvas>` — P3.B of
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Renders a draft `DashboardDef` (typically emitted by an agent-side
 * `proposeDashboard` tool) with inline editing affordances:
 *
 * - **Title + description** — click-to-edit text fields in the header.
 * - **Per-tile controls** — each tile gets a hover toolbar to:
 *   - swap its `component` to another registered widget;
 *   - remove the tile from the draft;
 *   - (read-only display of its `slot` + `invocation.kind` for context).
 * - **Sticky footer** — Discard / Commit buttons. Commit emits the
 *   edited draft; the host typically calls `bumpDashboardVersion(prev, draft)`
 *   then `DashboardRegistry.register(...)`.
 *
 * Dispatch-agnostic, same as the rest of P0/P1/P2/P3:
 *
 * - `(commit)` — emits the edited `DashboardDef`. Host owns the actual
 *   persistence (typically `DashboardRegistry.register` with bumped
 *   version, optionally written-through to `PersistenceRegistry`).
 * - `(discard)` — emits void; host clears the draft.
 * - `(draftChange)` — emits the in-progress draft on every edit. Useful
 *   for hosts that want to autosave or stream the edit history into
 *   their own store.
 *
 * The component never mutates `[draft]` directly — edits flow through
 * the internal editing signal, and the host re-binds the draft input
 * when it wants to reset.
 *
 * @example
 * ```html
 * <mvk-dashboard-preview
 *   [draft]="draftFromAgent()"
 *   (commit)="onCommit($event)"
 *   (discard)="draft.set(null)" />
 * ```
 */
@Component({
  selector: 'mvk-dashboard-preview',
  imports: [FormsModule, DashboardCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editing(); as e) {
      <section class="preview">
        <header class="preview-head">
          <span class="badge">DRAFT</span>
          <span class="meta">
            <input
              type="text"
              class="title-input"
              [ngModel]="e.title"
              (ngModelChange)="setTitle($event)"
              aria-label="Dashboard title"
              placeholder="Dashboard title…" />
            <input
              type="text"
              class="desc-input"
              [ngModel]="e.description ?? ''"
              (ngModelChange)="setDescription($event)"
              aria-label="Dashboard description"
              placeholder="Optional description…" />
          </span>
        </header>

        <mvk-dashboard-canvas [dashboard]="editing()" />

        <aside class="tile-controls" aria-label="Tile controls">
          <h3 class="tile-controls-title">Tiles ({{ e.tiles.length }})</h3>
          @if (e.tiles.length === 0) {
            <p class="empty">No tiles. The agent will add tiles here, or use the controls below to add manually.</p>
          } @else {
            <ul class="tile-list" role="list">
              @for (t of e.tiles; track t.id) {
                <li class="tile-row">
                  <span class="tile-info">
                    <span class="tile-id">{{ t.id }}</span>
                    <span class="tile-slot">slot: {{ t.slot }}</span>
                    <span class="tile-kind">{{ t.invocation.kind }}</span>
                  </span>
                  <label class="component-pick">
                    <span class="sr-only">Component for {{ t.id }}</span>
                    <select
                      class="component-select"
                      [ngModel]="t.component"
                      (ngModelChange)="swapComponent(t.id, $event)">
                      @for (c of availableComponents(); track c) {
                        <option [value]="c">{{ c }}</option>
                      }
                    </select>
                  </label>
                  <button
                    type="button"
                    class="remove-btn"
                    [attr.aria-label]="'Remove tile ' + t.id"
                    (click)="removeTile(t.id)">×</button>
                </li>
              }
            </ul>
          }
        </aside>

        <footer class="preview-foot">
          <button type="button" class="action discard" (click)="onDiscard()">Discard</button>
          <button type="button" class="action commit" (click)="onCommit()">Commit</button>
        </footer>
      </section>
    } @else {
      <section class="preview empty">No draft to preview.</section>
    }
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; }
    .preview {
      display: grid;
      grid-template-rows: auto 1fr auto auto;
      gap: 0.8rem;
      padding: 0.6rem 1rem 1rem;
      background: #f9fafb;
      border: 1px dashed #c7d2fe;
      border-radius: 0.5rem;
    }
    .preview.empty {
      display: flex; align-items: center; justify-content: center;
      padding: 2.5rem; color: #9ca3af;
    }
    .preview-head { display: flex; align-items: center; gap: 0.7rem; }
    .badge {
      padding: 0.15rem 0.6rem; border-radius: 999px;
      background: #4338ca; color: white;
      font-weight: 700; font-size: 0.7rem; letter-spacing: 0.04em;
    }
    .meta { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
    .title-input {
      font-size: 1.1rem; font-weight: 600; color: #111827;
      border: 0; background: transparent; padding: 0.2rem 0.3rem; border-radius: 0.3rem;
      outline: 0;
    }
    .title-input:focus { background: white; box-shadow: 0 0 0 1px #6366f1; }
    .desc-input {
      font-size: 0.85rem; color: #6b7280;
      border: 0; background: transparent; padding: 0.2rem 0.3rem; border-radius: 0.3rem;
      outline: 0;
    }
    .desc-input:focus { background: white; box-shadow: 0 0 0 1px #6366f1; }
    .tile-controls {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 0.4rem;
      padding: 0.7rem 0.9rem;
    }
    .tile-controls-title {
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em;
      color: #6b7280; margin: 0 0 0.5rem 0; font-weight: 700;
    }
    .empty { color: #9ca3af; font-style: italic; margin: 0; font-size: 0.85rem; }
    .tile-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .tile-row {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.35rem 0.5rem;
      background: #f9fafb;
      border-radius: 0.35rem;
      font-size: 0.82rem;
    }
    .tile-info { display: flex; gap: 0.5rem; flex: 1; align-items: baseline; min-width: 0; }
    .tile-id { font-weight: 600; color: #111827; }
    .tile-slot { color: #6b7280; }
    .tile-kind {
      padding: 0.05rem 0.4rem; border-radius: 999px;
      background: #eef2ff; color: #4338ca;
      font-size: 0.7em; font-weight: 600; text-transform: uppercase;
    }
    .component-pick { display: inline-block; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .component-select {
      padding: 0.2rem 0.4rem; font: inherit; font-size: 0.8rem;
      border: 1px solid #e5e7eb; border-radius: 0.3rem; background: white;
    }
    .remove-btn {
      width: 1.5rem; height: 1.5rem; padding: 0; border-radius: 0.3rem;
      background: transparent; border: 0; color: #b91c1c; cursor: pointer;
      font-size: 1.05rem; line-height: 1;
    }
    .remove-btn:hover { background: #fee2e2; }
    .preview-foot { display: flex; gap: 0.4rem; justify-content: flex-end; }
    .action {
      padding: 0.45rem 1rem;
      font: inherit; font-weight: 600; font-size: 0.85rem;
      border-radius: 0.4rem; cursor: pointer; border: 0;
    }
    .action.discard { background: white; color: #4b5563; border: 1px solid #e5e7eb; }
    .action.discard:hover { background: #f3f4f6; }
    .action.commit { background: #2563eb; color: white; }
    .action.commit:hover { background: #1d4ed8; }
  `,
})
export class DashboardPreviewComponent {
  /** The agent-emitted draft to preview + edit. `null` shows the empty state. */
  readonly draft = input<DashboardDef | null>(null);

  /** Emits the edited draft when the user clicks Commit. */
  readonly commit = output<DashboardDef>();

  /** Emits when the user clicks Discard. Host clears its draft. */
  readonly discard = output<void>();

  /** Emits the in-progress draft on every edit. */
  readonly draftChange = output<DashboardDef>();

  private readonly components = inject(ComponentRegistry);

  /** Internal editable copy of the draft. Re-syncs on every new [draft] input. */
  private readonly working = signal<DashboardDef | null>(null);

  constructor() {
    // Sync working copy whenever the draft input changes.
    queueMicrotask(() => this.working.set(cloneDraft(this.draft())));
  }

  /** Public read of the current edit state for the template. */
  protected readonly editing = computed<DashboardDef | null>(() => {
    const fromInput = this.draft();
    // If the input changed underneath us (re-bound from a parent
    // signal), the constructor microtask re-syncs `working`. Reading
    // `working()` here always returns the latest edit state.
    return this.working() ?? cloneDraft(fromInput);
  });

  /** List of widget names the host has registered — drives the component-picker dropdown. */
  protected readonly availableComponents = computed<readonly string[]>(() =>
    this.components.list().map((c) => c.name),
  );

  protected setTitle(title: string): void {
    this.mutate((d) => ({ ...d, title }));
  }

  protected setDescription(description: string): void {
    this.mutate((d) => ({ ...d, description: description || undefined }));
  }

  protected swapComponent(tileId: string, component: string): void {
    this.mutate((d) => ({
      ...d,
      tiles: d.tiles.map((t) => (t.id === tileId ? ({ ...t, component } satisfies TileDef) : t)),
    }));
  }

  protected removeTile(tileId: string): void {
    this.mutate((d) => ({ ...d, tiles: d.tiles.filter((t) => t.id !== tileId) }));
  }

  protected onCommit(): void {
    const cur = this.working();
    if (!cur) return;
    this.commit.emit(cur);
  }

  protected onDiscard(): void {
    this.discard.emit();
  }

  /** Apply an immutable transform to the working draft + fire (draftChange). */
  private mutate(fn: (d: DashboardDef) => DashboardDef): void {
    const cur = this.working();
    if (!cur) return;
    const next = fn(cur);
    this.working.set(next);
    this.draftChange.emit(next);
  }
}

/** Defensive copy so internal edits don't mutate the host's source-of-truth draft. */
function cloneDraft(d: DashboardDef | null): DashboardDef | null {
  if (!d) return null;
  return {
    ...d,
    tiles: d.tiles.map((t) => ({ ...t })),
    filters: d.filters?.map((f) => ({ ...f })),
  };
}
