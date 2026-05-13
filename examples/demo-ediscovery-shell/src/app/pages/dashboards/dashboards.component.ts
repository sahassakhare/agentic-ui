import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  DashboardCanvasComponent,
  DashboardRegistry,
  type CanvasTileDrilldown,
} from '@infra-tools/agentic-ui';

/**
 * `/dashboards` route — user-built dashboards surface
 * (post-chat-surfaces P3 / ADR-044).
 *
 * Picks the active dashboard from a left-rail list of registered
 * `DashboardDef`s and renders it via `<mvk-dashboard-canvas>`. Tiles
 * re-invoke their `kind: 'tool'` invocations against the live host
 * `ToolRegistry` — same persona scope as everywhere else, so blocked
 * tiles show a "no access" stub instead of 403'ing.
 *
 * Drilldown bubbles up as `CanvasTileDrilldown`; the demo handles
 * `route` drilldowns and would route `tool` / `action` through their
 * respective registries in production.
 */
@Component({
  selector: 'app-dashboards-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DashboardCanvasComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Workload</p>
        <h1>Dashboards</h1>
        <p class="muted">
          {{ count() }} registered · click any tile to drill into the source page
        </p>
      </div>
    </section>

    @if (active(); as d) {
      <div class="layout">
        <aside class="list" aria-label="Registered dashboards">
          <ul>
            @for (item of dashboards(); track item.name) {
              <li>
                <button
                  type="button"
                  class="item"
                  [class.active]="item.name === d.name"
                  (click)="selected.set(item.name)">
                  <strong>{{ item.title }}</strong>
                  <span class="hint">{{ item.description ?? 'No description' }}</span>
                </button>
              </li>
            }
          </ul>
        </aside>
        <main class="canvas-wrap">
          <mvk-dashboard-canvas
            [dashboard]="d"
            (drilldown)="onDrilldown($event)" />
        </main>
      </div>
    } @else {
      <p class="muted">No dashboards registered.</p>
    }
  `,
  styles: `
    :host { display: block; }
    .page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: var(--s-5); gap: var(--s-4); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
    .layout { display: grid; grid-template-columns: 220px 1fr; gap: var(--s-4); align-items: start; }
    .list ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--s-2); }
    .item {
      display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
      padding: var(--s-3); background: var(--c-surface); border: 1px solid var(--c-border);
      border-radius: var(--r-md); cursor: pointer; color: var(--c-text-1);
    }
    .item:hover { background: var(--c-surface-1); }
    .item.active { border-color: var(--c-accent, #6366f1); background: var(--c-surface-1); }
    .item strong { font-size: var(--fs-sm); }
    .item .hint { font-size: var(--fs-xs); color: var(--c-text-2); }
    .canvas-wrap { min-height: 360px; }
  `,
})
export class DashboardsPage {
  private readonly registry = inject(DashboardRegistry);
  private readonly router = inject(Router);

  protected readonly dashboards = this.registry.signal;
  protected readonly count = computed(() => this.dashboards().length);
  protected readonly selected = signal<string | null>(this.dashboards()[0]?.name ?? null);

  protected readonly active = computed(() =>
    this.dashboards().find((d) => d.name === this.selected()) ?? this.dashboards()[0] ?? null,
  );

  protected onDrilldown(ev: CanvasTileDrilldown): void {
    if (ev.target.route) void this.router.navigateByUrl(ev.target.route);
    // ev.target.tool would dispatch through ToolRegistry in production.
  }
}
