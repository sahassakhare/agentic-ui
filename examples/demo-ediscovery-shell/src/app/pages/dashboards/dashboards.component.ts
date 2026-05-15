import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  DashboardCanvasComponent,
  DashboardRegistry,
  DashboardTemplateRegistry,
  type CanvasTileDrilldown,
  type DashboardDef,
} from '@infra-tools/agentic-ui';
import { ProposedDashboardStore } from '../../services/proposed-dashboard.store';

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

    @if (proposed(); as p) {
      <div class="proposal" role="status">
        <span class="dot" aria-hidden="true">★</span>
        <div class="meta">
          <strong>Agent proposed: {{ p.title }}</strong>
          <span class="dim">{{ p.tiles.length }} tile(s) · {{ p.description }}</span>
        </div>
        <div class="actions">
          <button type="button" class="btn" [class.active]="previewing()" (click)="togglePreview()">{{ previewing() ? 'Stop preview' : 'Preview' }}</button>
          <button type="button" class="btn primary" (click)="commit()">Commit</button>
          <button type="button" class="btn ghost" (click)="dismiss()">Dismiss</button>
        </div>
      </div>
    }

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

    <!-- ADR-046 PR4 D6 — approved DashboardTemplate catalog. End users
         see only approved templates; admin reviewers see the full set
         via a separate review surface (not in this demo). -->
    <section class="templates-catalog">
      <header>
        <h2>Approved dashboard templates</h2>
        <span class="dim">{{ approvedTemplates().length }} approved · {{ pendingReviewCount() }} in review</span>
      </header>
      @if (approvedTemplates().length === 0) {
        <p class="muted small">No approved templates yet. Org admins publish templates via the catalog.</p>
      } @else {
        <ul class="template-grid">
          @for (template of approvedTemplates(); track template.name) {
            <li class="template-card">
              <div class="card-head">
                <strong>{{ template.title }}</strong>
                <span class="visibility-pill">{{ template.visibility }}</span>
              </div>
              <p class="desc">{{ template.description }}</p>
              <div class="tag-row">
                @for (tag of template.tags; track tag) {
                  <span class="tag">{{ tag }}</span>
                }
              </div>
              <footer>
                <span class="version">{{ template.version ?? 'v1' }}</span>
                <span class="dim">· author {{ template.author.userId }}</span>
                <span class="dim">· {{ template.approvalChain.length }} approval event(s)</span>
                <!-- ADR-047 D4 — Apply button. Materialises the
                     template into DashboardRegistry with source: 'user'
                     and selects it in the picker so the canvas swaps
                     to the new dashboard immediately. -->
                <button type="button" class="apply-btn" (click)="applyTemplate(template.name)">✨ Apply</button>
              </footer>
            </li>
          }
        </ul>
      }
    </section>
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
    .proposal {
      display: flex; align-items: center; gap: var(--s-3);
      padding: var(--s-3) var(--s-4); margin-bottom: var(--s-4);
      background: var(--c-info-soft, #dbeafe);
      border: 1px solid var(--c-info, #0284c7);
      border-left-width: 4px; border-radius: var(--r-md);
      font-size: var(--fs-sm);
    }
    .proposal .dot { color: var(--c-info, #0284c7); font-size: 1.05rem; }
    .proposal .meta { display: flex; flex-direction: column; gap: 2px; }
    .proposal strong { color: var(--c-text-1); }
    .proposal .dim { color: var(--c-text-2); font-size: var(--fs-xs); }
    .proposal .actions { margin-left: auto; display: flex; gap: var(--s-2); }
    .proposal .btn {
      padding: 0.4rem 0.85rem; font-size: var(--fs-xs); cursor: pointer;
      background: var(--c-surface); border: 1px solid var(--c-border);
      border-radius: var(--r-md); color: var(--c-text-1);
    }
    .proposal .btn:hover { background: var(--c-surface-1); }
    .proposal .btn.primary { background: var(--c-accent, #6366f1); color: white; border-color: transparent; }
    .proposal .btn.primary:hover { filter: brightness(1.07); }
    .proposal .btn.ghost { background: transparent; border-color: transparent; color: var(--c-text-2); }
    .proposal .btn.active { background: var(--c-accent, #6366f1); color: white; border-color: transparent; }
    .templates-catalog { margin-top: var(--s-6); padding-top: var(--s-4); border-top: 1px solid var(--c-border); }
    .templates-catalog header { display: flex; align-items: baseline; gap: var(--s-3); margin-bottom: var(--s-3); }
    .templates-catalog h2 { margin: 0; font-size: var(--fs-lg); }
    .templates-catalog .dim { color: var(--c-text-faint); font-size: var(--fs-xs); }
    .templates-catalog .small { font-size: var(--fs-sm); }
    .template-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--s-3); }
    .template-card {
      padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md);
      background: var(--c-surface); display: flex; flex-direction: column; gap: var(--s-2);
    }
    .template-card .card-head { display: flex; justify-content: space-between; align-items: center; gap: var(--s-2); }
    .template-card .card-head strong { font-size: var(--fs-sm); }
    .visibility-pill {
      padding: 1px 8px; border-radius: var(--r-sm); background: var(--c-surface-1);
      border: 1px solid var(--c-border); font-family: ui-monospace, monospace; font-size: 0.72rem;
      color: var(--c-text-2); text-transform: lowercase;
    }
    .template-card .desc { margin: 0; color: var(--c-text-2); font-size: var(--fs-xs); }
    .template-card .tag-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .template-card .tag {
      padding: 1px 7px; border-radius: var(--r-sm); background: var(--c-surface-1);
      font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--c-text-2);
    }
    .template-card footer { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); font-size: var(--fs-xs); color: var(--c-text-2); margin-top: auto; }
    .template-card .version { font-family: ui-monospace, monospace; color: var(--c-text-1); }
    .template-card .apply-btn {
      margin-left: auto; padding: 0.35rem 0.7rem;
      background: var(--c-accent, #6366f1); color: white; border: 1px solid transparent;
      border-radius: var(--r-md); font-size: var(--fs-xs); cursor: pointer; font-weight: 500;
    }
    .template-card .apply-btn:hover { filter: brightness(1.07); }
  `,
})
export class DashboardsPage {
  private readonly registry = inject(DashboardRegistry);
  private readonly router = inject(Router);
  private readonly proposalStore = inject(ProposedDashboardStore);
  private readonly templateRegistry = inject(DashboardTemplateRegistry);

  /** Templates in `approved` state — surfaced to end users. */
  protected readonly approvedTemplates = this.templateRegistry.approved;
  /** Count of templates awaiting reviewer attention — admin-facing signal. */
  protected readonly pendingReviewCount = computed(
    () => this.templateRegistry.pendingReview().length,
  );

  protected readonly dashboards = this.registry.signal;
  protected readonly count = computed(() => this.dashboards().length);
  protected readonly selected = signal<string | null>(this.dashboards()[0]?.name ?? null);

  /** Agent-proposed pending DashboardDef (set by the proposeDashboard tool). */
  protected readonly proposed = this.proposalStore.proposal;

  /** When true, the canvas renders the proposed def instead of the picker selection. */
  protected readonly previewing = signal(false);

  protected readonly active = computed<DashboardDef | null>(() => {
    if (this.previewing()) {
      const p = this.proposed();
      if (p) return p;
    }
    return this.dashboards().find((d) => d.name === this.selected()) ?? this.dashboards()[0] ?? null;
  });

  protected onDrilldown(ev: CanvasTileDrilldown): void {
    if (ev.target.route) void this.router.navigateByUrl(ev.target.route);
    // ev.target.tool would dispatch through ToolRegistry in production.
  }

  /** Toggle preview mode — canvas swaps to the proposed def + back. */
  protected togglePreview(): void {
    this.previewing.update((v) => !v);
  }

  /** Register the proposed def in the registry + select it in the picker. */
  protected commit(): void {
    const committed = this.proposalStore.commit();
    this.previewing.set(false);
    if (committed) this.selected.set(committed.name);
  }

  /** Drop the proposal — the banner disappears. */
  protected dismiss(): void {
    this.proposalStore.dismiss();
    this.previewing.set(false);
  }

  /**
   * ADR-047 D4 — instantiate a dashboard template. Reads the template's
   * body, stamps `source: 'user'` so it joins user-committed entries
   * in the picker, registers it into DashboardRegistry, and selects it.
   * For templates with parameters, a real adopter would open a modal
   * to collect them before instantiation; the demo ships static
   * templates so this is one-click.
   */
  protected applyTemplate(name: string): void {
    const template = this.templateRegistry.get(name);
    if (!template || template.approvalState !== 'approved') return;
    const def: DashboardDef = { ...template.body, source: 'user' };
    try {
      this.registry.register(def);
    } catch {
      // Replace policy handles re-applies — but defensive in case
      // adopter customised the registry conflict policy.
    }
    this.selected.set(def.name);
  }
}
