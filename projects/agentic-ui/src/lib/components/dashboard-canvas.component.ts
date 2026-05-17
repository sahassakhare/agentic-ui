import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LayoutRegistry } from '../registries/layout-registry';
import { DashboardTileComponent } from './dashboard-tile.component';
import type { DashboardTileDrilldown, DashboardTileExplain } from './dashboard-tile.component';
import type { DashboardDef, FilterDef, LayoutDef, TileDef } from '../types/registry-defs';

/** Emitted when the user clicks a tile drilldown anywhere on the canvas. */
export type CanvasTileDrilldown = DashboardTileDrilldown & { readonly dashboardName: string };

/** Emitted when the user clicks an Explain affordance anywhere on the canvas. */
export type CanvasTileExplain = DashboardTileExplain & { readonly dashboardName: string };

/**
 * Renders an entire `DashboardDef` as a grid of `<mvk-dashboard-tile>`
 * components — Pillar 3 P3.A.2 of
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Pulls the dashboard's `LayoutDef` from `LayoutRegistry` (when
 * `[dashboard].layout` is a string name) or uses the inline value.
 * Pins each `TileDef` into its declared slot. Threads the
 * dashboard's `filters` into every `kind: 'tool'` tile's args at
 * invocation time so cross-matter / cross-tenant / time-range
 * parameters propagate without per-tile boilerplate.
 *
 * Slot resolution:
 *
 * - If the layout declares slot names via `LayoutDef.slots: string[]`
 *   ([ADR-002](../../../../docs/adr/0002-layered-registry-system.md) shape),
 *   tiles whose `slot` isn't in that list render under a fallback
 *   "unslotted" group at the bottom of the canvas. Matches the
 *   widget-container fail-soft contract — a typo in `TileDef.slot`
 *   never breaks the whole dashboard.
 * - Multiple tiles can share a slot; they stack inside it.
 *
 * Dispatch is host-driven: drilldown + explain bubble up as typed
 * events with the dashboard name attached. Refresh-all button re-
 * fires every tile by incrementing the canvas-level refreshTick.
 *
 * @example
 * ```html
 * <mvk-dashboard-canvas
 *   [dashboard]="dashboardRegistry.signal()[0]"
 *   (drilldown)="onTileDrilldown($event)"
 *   (explain)="onTileExplain($event)" />
 * ```
 */
@Component({
  selector: 'mvk-dashboard-canvas',
  imports: [DashboardTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dashboard(); as d) {
      <section class="canvas" [attr.data-dashboard]="d.name">
        <header class="head">
          <hgroup>
            <h2 class="title">{{ d.title }}</h2>
            @if (d.description) {
              <p class="desc">{{ d.description }}</p>
            }
          </hgroup>
          <div class="head-actions">
            @if (filters().length > 0) {
              <ul class="filter-chips" role="list">
                @for (f of filters(); track f.id) {
                  <li class="chip">
                    <span class="chip-label">{{ f.label }}:</span>
                    <span class="chip-value">{{ formatFilter(f.value) }}</span>
                  </li>
                }
              </ul>
            }
            <button type="button" class="refresh-all" (click)="refreshAll()" aria-label="Refresh all tiles">↻ Refresh</button>
          </div>
        </header>

        <div class="grid">
          @for (slot of slotsInOrder(); track slot) {
            <div class="slot" [attr.data-slot]="slot">
              @for (tile of tilesForSlot(slot); track tile.id) {
                <mvk-dashboard-tile
                  [tile]="withFiltersApplied(tile)"
                  [refreshTick]="refreshTick()"
                  (drilldown)="onDrilldown(d.name, $event)"
                  (explain)="onExplain(d.name, $event)" />
              }
            </div>
          }

          @if (unslottedTiles().length > 0) {
            <div class="slot slot-unslotted" data-slot="(unslotted)">
              <div class="slot-warning">
                {{ unslottedTiles().length }} tile(s) reference slots not declared by the layout — rendering inline.
              </div>
              @for (tile of unslottedTiles(); track tile.id) {
                <mvk-dashboard-tile
                  [tile]="withFiltersApplied(tile)"
                  [refreshTick]="refreshTick()"
                  (drilldown)="onDrilldown(d.name, $event)"
                  (explain)="onExplain(d.name, $event)" />
              }
            </div>
          }
        </div>
      </section>
    } @else {
      <section class="canvas empty">No dashboard supplied.</section>
    }
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; }
    .canvas {
      padding: 1rem 1.2rem;
      background: #f9fafb;
      min-height: 100%;
    }
    .canvas.empty { display: flex; align-items: center; justify-content: center; color: #9ca3af; padding: 3rem; }
    .head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 1rem; margin-bottom: 1rem;
    }
    hgroup { margin: 0; }
    .title { margin: 0; font-size: 1.25rem; font-weight: 700; color: #111827; }
    .desc { margin: 0.2rem 0 0; color: #6b7280; font-size: 0.85rem; }
    .head-actions { display: flex; align-items: center; gap: 0.6rem; }
    .filter-chips { display: flex; gap: 0.4rem; list-style: none; margin: 0; padding: 0; }
    .chip {
      display: inline-flex; align-items: center; gap: 0.3rem;
      padding: 0.2rem 0.55rem; border-radius: 999px;
      background: #eef2ff; color: #4338ca;
      font-size: 0.75rem; font-weight: 500;
    }
    .chip-label { opacity: 0.8; }
    .chip-value { font-weight: 600; }
    .refresh-all {
      padding: 0.4rem 0.7rem;
      background: white; border: 1px solid #e5e7eb; border-radius: 0.4rem;
      font: inherit; font-size: 0.8rem; color: #4338ca; cursor: pointer;
    }
    .refresh-all:hover { background: #eef2ff; border-color: #c7d2fe; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 0.8rem;
    }
    .slot { display: flex; flex-direction: column; gap: 0.6rem; min-height: 200px; }
    .slot-unslotted { grid-column: 1 / -1; }
    .slot-warning {
      padding: 0.4rem 0.6rem; background: #fef3c7; color: #92400e;
      border-radius: 0.35rem; font-size: 0.8rem;
    }
  `,
})
export class DashboardCanvasComponent {
  /** The dashboard to render. `null` shows the empty state. */
  readonly dashboard = input<DashboardDef | null>(null);

  /** Bubbled up from tile drilldown events. */
  readonly drilldown = output<CanvasTileDrilldown>();

  /** Bubbled up from tile explain events. */
  readonly explain = output<CanvasTileExplain>();

  private readonly layouts = inject(LayoutRegistry);

  /** Monotonic counter that drives canvas-wide refresh. */
  protected readonly refreshTick = signal(0);

  /** Resolved `LayoutDef` for the active dashboard. */
  protected readonly resolvedLayout = computed<LayoutDef | null>(() => {
    const d = this.dashboard();
    if (!d) return null;
    if (typeof d.layout === 'object') return d.layout;
    return this.layouts.get(d.layout) ?? null;
  });

  /** Slot names declared by the resolved layout, in declared order. */
  protected readonly slotsInOrder = computed<readonly string[]>(() => {
    const layout = this.resolvedLayout();
    return layout?.slots ?? [];
  });

  /** Dashboard filters — empty array when none. */
  protected readonly filters = computed<readonly FilterDef[]>(
    () => this.dashboard()?.filters ?? [],
  );

  /** Tiles assigned to a given slot, in declared order. */
  protected tilesForSlot(slot: string): readonly TileDef[] {
    return (this.dashboard()?.tiles ?? []).filter((t) => t.slot === slot);
  }

  /** Tiles whose `slot` doesn't appear in the layout's declared slot list. */
  protected readonly unslottedTiles = computed<readonly TileDef[]>(() => {
    const declared = new Set(this.slotsInOrder());
    return (this.dashboard()?.tiles ?? []).filter((t) => !declared.has(t.slot));
  });

  /**
   * Re-fire every tile. Increments the canvas-level `refreshTick`
   * which propagates into each `<mvk-dashboard-tile [refreshTick]>`
   * — tiles with `refreshOn: 'event'` re-fire; others ignore.
   *
   * For "force all tiles to refresh regardless of strategy" hosts
   * can read `dashboard().tiles` and call each tile's refresh()
   * via a template ref. The default behaviour respects each tile's
   * declared strategy.
   */
  refreshAll(): void {
    this.refreshTick.update((n) => n + 1);
  }

  /**
   * Apply dashboard-level filters to a tool tile's args. Filters
   * write their `argKey -> value` pairs into the tile's args at
   * invocation time, so a `matterIds` filter on the dashboard
   * threads into every tool that takes a `matterIds` arg.
   *
   * Tile-level args win on key collision so per-tile overrides
   * stay possible.
   */
  protected withFiltersApplied(tile: TileDef): TileDef {
    const fs = this.filters();
    if (fs.length === 0 || tile.invocation.kind !== 'tool') return tile;
    const merged: Record<string, unknown> = {};
    for (const f of fs) merged[f.argKey] = f.value;
    for (const [k, v] of Object.entries(tile.invocation.args)) merged[k] = v;
    return {
      ...tile,
      invocation: { ...tile.invocation, args: merged },
    };
  }

  protected onDrilldown(dashboardName: string, ev: DashboardTileDrilldown): void {
    this.drilldown.emit({ ...ev, dashboardName });
  }

  protected onExplain(dashboardName: string, ev: DashboardTileExplain): void {
    this.explain.emit({ ...ev, dashboardName });
  }

  protected formatFilter(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.length > 3 ? `${value.length} items` : value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
