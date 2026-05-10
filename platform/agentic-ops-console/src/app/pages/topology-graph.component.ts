import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import cytoscape, {
  type Core,
  type ElementDefinition,
  type EventObject,
} from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import type { Capability, MfeRemote } from '../services/catalog-client.service';
import { TopologyDataService } from '../services/topology-data.service';
import { autoStream } from '../services/catalog-stream.service';

// Register the cose-bilkent layout extension once per process.
cytoscape.use(coseBilkent);

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4.0;

type LifecycleFilter = 'all' | 'published' | 'draft' | 'deprecated' | 'disabled';

interface NodeMeta {
  readonly kind: 'tenant' | 'group' | 'capability';
  readonly capability?: Capability;
  readonly mfe?: MfeRemote | null;
  readonly groupKind?: 'host' | 'mfe' | 'orphan';
}

/**
 * Topology graph view — slice TG of the Sept-2026 plan. Visual
 * counterpart to `TopologyComponent` (tree view, ADR-036). Renders
 * the same data as a Cytoscape force-directed graph with compound
 * nodes for groups (Host-direct + per-MFE), node colors encoding
 * lifecycle, and shape encoding kind.
 *
 * Modeled on OpenShift's developer-perspective topology view: each
 * "service" (capability) is a colored shape, "workload"
 * (MFE remote) is a parent compound node, status colors map to
 * lifecycle, click-to-drill into details.
 *
 * Live updates via `CatalogStreamService` — every catalog mutation
 * triggers a data refresh + incremental graph update.
 */
@Component({
  selector: 'ops-topology-graph',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="header">
      <h1>Topology · graph view</h1>
      <div class="filters">
        <a routerLink="/topology" class="btn ghost view-toggle">
          🌲 Tree view
        </a>
        <label>
          Lifecycle
          <select [ngModel]="lifecycleFilter()" (ngModelChange)="lifecycleFilter.set($event)">
            <option value="all">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="deprecated">Deprecated</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <div class="zoom-group" role="group" aria-label="Zoom controls">
          <button class="btn ghost zoom" type="button" (click)="zoomOut()"  title="Zoom out (Ctrl + -)">−</button>
          <span class="zoom-pct" title="Current zoom">{{ zoomPct() }}%</span>
          <button class="btn ghost zoom" type="button" (click)="zoomIn()"   title="Zoom in (Ctrl + +)">+</button>
          <button class="btn ghost"      type="button" (click)="fitToView()" title="Fit all to view">⤢ Fit</button>
          <button class="btn ghost"      type="button" (click)="resetZoom()" title="Reset zoom + center">⌂</button>
        </div>
        <button class="btn ghost" type="button" (click)="relayout()" title="Recompute layout">
          ⟳ Relayout
        </button>
        <button class="btn ghost" type="button" (click)="refresh()">⟳ Refresh data</button>
      </div>
    </div>

    @if (error(); as err) { <div class="error">Failed: {{ err }}</div> }
    @if (loading()) {
      <p class="dim">Loading…</p>
    }

    <div class="stats">
      <div class="stat">
        <div class="stat-num">{{ counts().total }}</div>
        <div class="stat-label">capabilities</div>
      </div>
      <div class="stat">
        <div class="stat-num good">{{ counts().published }}</div>
        <div class="stat-label">published</div>
      </div>
      <div class="stat">
        <div class="stat-num warn">{{ counts().draft }}</div>
        <div class="stat-label">draft</div>
      </div>
      <div class="stat">
        <div class="stat-num dim">{{ counts().deprecated }}</div>
        <div class="stat-label">deprecated</div>
      </div>
      <div class="stat">
        <div class="stat-num bad">{{ counts().disabled }}</div>
        <div class="stat-label">disabled</div>
      </div>
      <div class="stat-sep"></div>
      <div class="stat">
        <div class="stat-num">{{ counts().mfes }}</div>
        <div class="stat-label">MFE remotes</div>
      </div>
      <div class="stat">
        <div class="stat-num">{{ counts().groups }}</div>
        <div class="stat-label">groups</div>
      </div>
    </div>

    <div class="legend">
      <span class="legend-title">Lifecycle</span>
      <span class="legend-item"><span class="dot lifecycle-published"></span>published</span>
      <span class="legend-item"><span class="dot lifecycle-draft"></span>draft</span>
      <span class="legend-item"><span class="dot lifecycle-deprecated"></span>deprecated</span>
      <span class="legend-item"><span class="dot lifecycle-disabled"></span>disabled</span>
      <span class="legend-sep">·</span>
      <span class="legend-title">Kind</span>
      <span class="legend-item shape-tool">tool</span>
      <span class="legend-item shape-component">component</span>
      <span class="legend-item shape-form">form</span>
      <span class="legend-item shape-action">action</span>
      <span class="legend-item shape-datasource">datasource</span>
      <span class="legend-sep">·</span>
      <span class="legend-hint dim">click a node for details · scroll to zoom · drag to pan</span>
    </div>

    <div class="graph-container">
      <div #cyHost class="cy-host"></div>

      @if (selected(); as s) {
        <aside class="side-panel">
          <button class="close" type="button" (click)="selected.set(null)" aria-label="Close">×</button>
          @if (s.capability; as c) {
            <h3>{{ c.name }}</h3>
            <div class="meta">
              <div><strong>Kind:</strong> {{ c.kind }}</div>
              <div>
                <strong>Lifecycle:</strong>
                <span class="dot lifecycle-{{ c.lifecycle }}"></span>
                {{ c.lifecycle }}
              </div>
              @if (c.owner) { <div><strong>Owner:</strong> {{ c.owner }}</div> }
              @if (c.tags.length > 0) {
                <div>
                  <strong>Tags:</strong>
                  @for (t of c.tags; track t) { <span class="tag">{{ t }}</span> }
                </div>
              }
              <div><strong>Source:</strong> {{ getCapSource(c) }}</div>
              <div><strong>Created:</strong> {{ c.createdAt }}</div>
            </div>
            <a [routerLink]="['/capabilities']" [queryParams]="{ focus: c.id }" class="btn primary">
              Edit in capabilities page
            </a>
          } @else if (s.mfe; as m) {
            <h3>{{ m.name }}</h3>
            <div class="meta">
              <div><strong>Kind:</strong> MFE remote</div>
              <div><strong>Status:</strong>
                <span class="chip status-{{ m.status }}">{{ m.status }}</span>
              </div>
              <div><strong>Version:</strong> {{ m.version ?? '—' }}</div>
              <div><strong>Manifest:</strong></div>
              <code class="manifest">{{ m.manifestUrl }}</code>
            </div>
            <a routerLink="/mfes" class="btn primary">Edit in MFEs page</a>
          } @else if (s.groupKind === 'host') {
            <h3>Host-direct</h3>
            <div class="meta">
              <p>Capabilities registered by the host application directly,
                 not contributed by a federated MFE remote.</p>
            </div>
          } @else if (s.groupKind === 'orphan') {
            <h3>Orphan group</h3>
            <div class="meta">
              <p class="warning">Capabilities whose <code>body.source</code>
                doesn't match any registered MFE remote.
                Either register the missing remote or delete these rows.</p>
            </div>
          }
        </aside>
      }
    </div>
  `,
  styles: [`
    .header { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .header h1 { margin: 0; flex: 1; }
    .filters { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .filters label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; }
    .view-toggle { font-size: 0.875rem; }

    /* Toolbar zoom group — tight pill cluster like a map widget. */
    .zoom-group {
      display: inline-flex; align-items: stretch;
      border: 1px solid var(--border);
      border-radius: 0.375rem;
      overflow: hidden;
      background: var(--bg-elev);
    }
    .zoom-group .btn { border-radius: 0; border: none; border-right: 1px solid var(--border); padding: 0.375rem 0.5rem; }
    .zoom-group .btn:last-child { border-right: none; }
    .zoom-group .btn.zoom { font-weight: 700; min-width: 28px; }
    .zoom-pct {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 48px; padding: 0 0.5rem;
      font-size: 12px; font-family: var(--mono);
      color: var(--fg-muted);
      background: var(--bg);
      border-right: 1px solid var(--border);
    }

    .stats {
      display: flex; align-items: center; gap: 1.5rem;
      padding: 0.75rem 1rem;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      margin-bottom: 0.5rem;
      flex-wrap: wrap;
    }
    .stat { display: flex; flex-direction: column; align-items: flex-start; line-height: 1; }
    .stat-num { font-size: 22px; font-weight: 700; color: var(--fg); }
    .stat-num.good { color: var(--good); }
    .stat-num.warn { color: var(--warn); }
    .stat-num.bad  { color: var(--bad); }
    .stat-num.dim  { color: var(--fg-muted); }
    .stat-label { font-size: 11px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
    .stat-sep { width: 1px; height: 32px; background: var(--border); }

    .legend {
      display: flex; gap: 0.625rem; align-items: center; flex-wrap: wrap;
      padding: 0.5rem 0.875rem; background: rgba(255,255,255,0.03);
      border-radius: 0.375rem; margin-bottom: 0.625rem; font-size: 0.8125rem;
    }
    .legend-title { color: var(--fg-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.6875rem; }
    .legend-item { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--fg); }
    .legend-sep { color: var(--border); }
    .legend-hint { font-size: 0.75rem; }
    .shape-tool::before       { content: '●'; color: var(--fg-muted); margin-right: 0.25rem; }
    .shape-component::before  { content: '⬡'; color: var(--fg-muted); margin-right: 0.25rem; }
    .shape-form::before       { content: '◆'; color: var(--fg-muted); margin-right: 0.25rem; }
    .shape-action::before     { content: '▭'; color: var(--fg-muted); margin-right: 0.25rem; }
    .shape-datasource::before { content: '⬢'; color: var(--fg-muted); margin-right: 0.25rem; }

    .graph-container {
      display: grid; grid-template-columns: 1fr auto; gap: 1rem;
      /* Big canvas — force-directed layouts need real estate. */
      min-height: calc(100vh - 280px);
    }
    .cy-host {
      width: 100%;
      min-height: calc(100vh - 280px);
      background: var(--bg-elev); border-radius: 0.5rem;
    }

    .side-panel {
      width: 320px; max-width: 90vw;
      background: var(--bg-elev); border: 1px solid var(--border);
      border-radius: 0.5rem; padding: 1rem; position: relative;
    }
    .side-panel h3 { margin: 0 0 0.75rem 0; }
    .side-panel .close {
      position: absolute; top: 0.5rem; right: 0.5rem;
      background: transparent; border: none; color: var(--fg-muted);
      font-size: 1.25rem; cursor: pointer; line-height: 1;
    }
    .side-panel .close:hover { color: var(--fg); }
    .meta { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; font-size: 0.875rem; }
    .meta strong { color: var(--fg-muted); font-weight: 500; }
    .meta code.manifest { display: block; word-break: break-all; padding: 0.375rem; background: var(--bg); border-radius: 0.25rem; }

    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
    .dot.lifecycle-published { background: #16a34a; }
    .dot.lifecycle-draft { background: #ca8a04; }
    .dot.lifecycle-deprecated { background: #94a3b8; }
    .dot.lifecycle-disabled { background: #dc2626; }

    .chip {
      background: var(--bg-elev-2); padding: 0.125rem 0.5rem; border-radius: 999px;
      font-size: 0.8125rem;
    }
    .chip.status-active { background: #14532d; color: #86efac; }
    .chip.status-degraded { background: #713f12; color: #fcd34d; }
    .chip.status-inactive { background: #7f1d1d; color: #fca5a5; }
    .tag { font-size: 0.75rem; background: var(--bg-elev-2); padding: 0 0.25rem; border-radius: 0.25rem; margin-right: 0.25rem; }

    .btn { padding: 0.375rem 0.75rem; border-radius: 0.375rem; font-size: 0.875rem; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn.ghost { background: transparent; color: var(--fg); border: 1px solid var(--border); }
    .btn.primary { background: var(--accent); color: var(--accent-fg); border: 1px solid var(--accent); }

    .warning { color: var(--warn); }
    .error { background: #7f1d1d; color: #fca5a5; padding: 0.75rem; border-radius: 0.375rem; margin-bottom: 0.75rem; }
    .dim { color: var(--fg-muted); }
  `],
})
export class TopologyGraphComponent implements AfterViewInit {
  @ViewChild('cyHost', { static: false }) private readonly cyHost?: ElementRef<HTMLElement>;

  private readonly data = inject(TopologyDataService);
  private readonly router = inject(Router);

  protected readonly capabilities = this.data.capabilities;
  protected readonly mfes = this.data.mfes;
  protected readonly loading = this.data.loading;
  protected readonly error = this.data.error;

  protected readonly lifecycleFilter = signal<LifecycleFilter>('all');
  protected readonly selected = signal<NodeMeta | null>(null);

  /** Header stats summary — small computed so the template is dumb. */
  protected readonly counts = computed(() => {
    const caps = this.capabilities();
    const mfes = this.mfes();
    const acc = { total: caps.length, published: 0, draft: 0, deprecated: 0, disabled: 0,
                  mfes: mfes.length, groups: 0 };
    for (const c of caps) acc[c.lifecycle] = (acc[c.lifecycle] ?? 0) + 1;
    // Groups = host-direct (always) + one per registered MFE + orphans.
    const orphanSources = new Set<string>();
    for (const c of caps) {
      const src = typeof c.body['source'] === 'string' ? c.body['source'] : 'host';
      if (src !== 'host' && !mfes.some((m) => m.name === src)) orphanSources.add(src);
    }
    acc.groups = 1 + mfes.length + orphanSources.size;
    return acc;
  });

  /**
   * The set of cytoscape elements (nodes + edges) computed from
   * the current capabilities/MFEs/filter state. We keep this as a
   * `computed` so the cy update loop can subscribe via effect.
   */
  private readonly elements = computed<ElementDefinition[]>(() => {
    const caps = this.capabilities();
    const mfes = this.mfes();
    const filter = this.lifecycleFilter();
    return buildGraphElements(caps, mfes, filter);
  });

  private cy: Core | null = null;

  /** Current zoom level (0..N). 1.0 = fit. Updated on every cy
   *  zoom event so the % readout stays live. */
  protected readonly zoom = signal<number>(1);
  protected readonly zoomPct = computed(() => Math.round(this.zoom() * 100));

  constructor() {
    void this.refresh();
    autoStream(() => { void this.refresh(); });

    // Sync the cytoscape instance to the computed elements signal.
    // Recomputation is cheap at <500 elements; we tear down + rebuild
    // for simplicity (no diff/incremental update).
    effect(() => {
      const els = this.elements();
      if (this.cy) {
        this.cy.batch(() => {
          this.cy!.elements().remove();
          this.cy!.add(els);
        });
        this.runLayout();
      }
    });
  }

  ngAfterViewInit(): void {
    if (!this.cyHost) return;
    // Cytoscape's StyleSheet types don't allow `data(...)` mappers
    // for fields like `shape` (typed as `NodeShape` literal union).
    // The runtime accepts them; widen the array to bypass the
    // strict-literal check.
    const stylesheet = [
      {
        selector: 'node[kind = "capability"]',
        style: {
          'background-color': 'data(color)',
          'shape': 'data(shape)',
          // Always-on label so the topology is legible at default
          // zoom — operators shouldn't have to hover every dot to
          // figure out what's there. Truncated upstream so the
          // string is short enough to not collide with neighbours.
          'label': 'data(label)',
          'text-valign': 'bottom',
          'text-margin-y': 4,
          'color': '#c9d1d9',
          'font-size': 9,
          'text-background-color': '#0e1116',
          'text-background-opacity': 0.7,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
          'width': 18, 'height': 18,
          'border-width': 1.5, 'border-color': '#0e1116',
        },
      },
      {
        // Hover/selected: emphasised, on top, full styling.
        selector: 'node[kind = "capability"]:active, node[kind = "capability"]:selected',
        style: {
          'color': '#ffffff',
          'font-size': 12, 'font-weight': 600,
          'text-background-opacity': 1,
          'text-background-padding': '4px',
          'border-width': 3, 'border-color': '#58a6ff',
          'width': 26, 'height': 26,
          'z-index': 999,
        },
      },
      {
        selector: 'node[kind = "group"]',
        style: {
          'background-color': 'data(color)',
          'background-opacity': 0.12,
          'border-color': 'data(borderColor)',
          'border-width': 2,
          'shape': 'round-rectangle',
          'label': 'data(label)',
          'color': '#e6edf3',
          'font-size': 18, 'font-weight': 700,
          'text-valign': 'top',
          'text-halign': 'center',
          'text-margin-y': -22,
          'text-background-color': '#0e1116',
          'text-background-opacity': 1,
          'text-background-padding': '8px',
          'text-background-shape': 'roundrectangle',
          'text-border-color': 'data(borderColor)',
          'text-border-opacity': 1,
          'text-border-width': 1,
          'padding': '40px',
        },
      },
      {
        selector: 'node[kind = "tenant"]',
        style: {
          'background-color': '#0e1116',
          'border-color': '#58a6ff',
          'border-width': 2,
          'shape': 'round-rectangle',
          'label': 'data(label)',
          'color': '#58a6ff',
          'font-size': 20, 'font-weight': 700,
          'text-valign': 'top',
          'text-margin-y': -18,
          'text-background-color': '#0e1116',
          'text-background-opacity': 1,
          'text-background-padding': '8px',
          'text-background-shape': 'roundrectangle',
          'text-border-color': '#58a6ff',
          'text-border-opacity': 1,
          'text-border-width': 1,
          'padding': '36px',
        },
      },
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          'line-color': '#475569',
          'width': 1,
          'target-arrow-color': '#475569',
          'target-arrow-shape': 'triangle-backcurve',
          'arrow-scale': 0.6,
        },
      },
      {
        selector: 'edge[disabled = "true"]',
        style: { 'line-style': 'dashed', 'line-color': '#dc2626' },
      },
      {
        selector: 'node:selected',
        style: { 'border-width': 3, 'border-color': '#58a6ff' },
      },
    ];

    this.cy = cytoscape({
      container: this.cyHost.nativeElement,
      elements: this.elements(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style: stylesheet as any,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      wheelSensitivity: 0.25,
    });

    // Keep the % readout in the toolbar in sync with whatever the
    // user does — scroll, pinch, programmatic zoom calls.
    this.cy.on('zoom', () => this.zoom.set(this.cy?.zoom() ?? 1));
    this.cy.on('tap', 'node', (e: EventObject) => this.onNodeTap(e));
    // Promote on hover so dense areas remain readable.
    this.cy.on('mouseover', 'node[kind = "capability"]', (e: EventObject) => {
      e.target.addClass('hovered');
    });
    this.cy.on('mouseout', 'node[kind = "capability"]', (e: EventObject) => {
      e.target.removeClass('hovered');
    });
    this.cy.style()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .selector('node[kind = "capability"].hovered' as any)
      .style({
        'color': '#ffffff',
        'font-size': 11, 'font-weight': 600,
        'text-background-opacity': 1,
        'border-width': 2, 'border-color': '#58a6ff',
        'width': 22, 'height': 22,
        'z-index': 998,
      } as never)
      .update();
    this.runLayout();
  }

  protected refresh(): Promise<void> {
    return this.data.refresh();
  }

  protected relayout(): void {
    this.runLayout();
  }

  /** Zoom in 1.25x around the canvas centre. */
  protected zoomIn(): void {
    if (!this.cy) return;
    this.zoomBy(1.25);
  }

  /** Zoom out 0.8x around the canvas centre. */
  protected zoomOut(): void {
    if (!this.cy) return;
    this.zoomBy(1 / 1.25);
  }

  /** Re-fit all elements within the viewport. */
  protected fitToView(): void {
    if (!this.cy) return;
    this.cy.fit(undefined, 48);
    this.zoom.set(this.cy.zoom());
  }

  /** Reset zoom to 1.0 and recenter. */
  protected resetZoom(): void {
    if (!this.cy) return;
    this.cy.reset();
    this.cy.center();
    this.zoom.set(this.cy.zoom());
  }

  private zoomBy(factor: number): void {
    if (!this.cy) return;
    const cy = this.cy;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cy.zoom() * factor));
    const ext = cy.extent();
    cy.zoom({
      level: next,
      renderedPosition: {
        x: cy.width() / 2,
        y: cy.height() / 2,
      },
    });
    void ext;  // touch unused so eslint is quiet about the local
    this.zoom.set(cy.zoom());
  }

  private runLayout(): void {
    if (!this.cy) return;
    const nodeCount = this.cy.nodes().length;
    // cose-bilkent is the OpenShift-style force-directed-with-compounds
    // layout. For very large graphs (>200 nodes) it gets slow; fall
    // back to a faster layout when the graph crosses that threshold.
    const layoutName = nodeCount > 200 ? 'concentric' : 'cose-bilkent';
    const layout = this.cy.layout({
      name: layoutName,
      animate: nodeCount < 100,
      animationDuration: 500,
      fit: true,
      padding: 48,
      // Tuned for an enterprise topology look: orderly tile-packed
      // children inside each compound (predictable rows of dots,
      // not random force-directed sprays), generous repulsion +
      // gravityRangeCompound so the compounds themselves spread
      // apart enough to read every group's title and the always-on
      // capability labels don't collide.
      idealEdgeLength: 120,
      nodeRepulsion: 30_000,
      gravity: 0.15,
      gravityRangeCompound: 2.5,
      nestingFactor: 1.0,
      // Tile children = grid-pack inside each compound. Padding
      // keeps labels from butting up to the compound border.
      tile: true,
      tilingPaddingVertical: 28,
      tilingPaddingHorizontal: 14,
      randomize: false,
      numIter: 2500,
    } as Parameters<Core['layout']>[0]);
    layout.run();
  }

  private onNodeTap(e: EventObject): void {
    const data = e.target.data();
    const meta = data['meta'] as NodeMeta | undefined;
    this.selected.set(meta ?? null);
  }

  protected getCapSource(cap: Capability): string {
    return typeof cap.body['source'] === 'string' ? cap.body['source'] : 'host';
  }
}

/* ────────────────────────────────────────────────────────────────────
   buildGraphElements — pure function so it's straightforward to test.
   Maps `Capability[]` + `MfeRemote[]` + filter into Cytoscape nodes /
   edges with parent-child compound grouping. Exported for unit tests.
   ──────────────────────────────────────────────────────────────────── */
export function buildGraphElements(
  capabilities: readonly Capability[],
  mfes: readonly MfeRemote[],
  filter: LifecycleFilter,
): ElementDefinition[] {
  const filtered = filter === 'all' ? capabilities : capabilities.filter((c) => c.lifecycle === filter);
  const tenantId = filtered[0]?.tenantId ?? mfes[0]?.tenantId ?? 'tenant';

  const elements: ElementDefinition[] = [];

  // Tenant — outermost compound. Skipping: keep groups top-level for
  // a less cluttered look. We still keep a `tenant` chip in the
  // header summary on the page.

  // Group buckets — by source field on each capability.
  const bySource = new Map<string, Capability[]>();
  for (const cap of filtered) {
    const source = typeof cap.body['source'] === 'string' ? cap.body['source'] : 'host';
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source)!.push(cap);
  }

  // Host-direct group (always present, even if empty when filter=all).
  const hostCaps = bySource.get('host') ?? [];
  bySource.delete('host');
  if (hostCaps.length > 0 || filter === 'all') {
    const hostId = 'group:host';
    elements.push({
      data: {
        id: hostId,
        kind: 'group',
        label: `Host-direct (${hostCaps.length})`,
        color: '#475569',
        borderColor: '#94a3b8',
        meta: { kind: 'group', groupKind: 'host', mfe: null } satisfies NodeMeta,
      },
    });
    for (const cap of hostCaps) {
      pushCapability(elements, cap, hostId, tenantId);
    }
  }

  // One group per registered MFE remote.
  for (const mfe of mfes) {
    const mfeCaps = bySource.get(mfe.name) ?? [];
    bySource.delete(mfe.name);
    const groupId = `group:${mfe.name}`;
    const borderColor =
      mfe.status === 'active' ? '#3fb950' :
      mfe.status === 'degraded' ? '#d29922' :
      '#f85149';
    elements.push({
      data: {
        id: groupId,
        kind: 'group',
        label: `${mfe.name} (${mfeCaps.length})`,
        color: '#1e3a8a',
        borderColor,
        meta: { kind: 'group', groupKind: 'mfe', mfe } satisfies NodeMeta,
      },
    });
    for (const cap of mfeCaps) {
      pushCapability(elements, cap, groupId, tenantId);
    }
  }

  // Orphan groups — capabilities whose source matches no registered MFE.
  for (const [source, orphanCaps] of bySource) {
    const groupId = `group:orphan:${source}`;
    elements.push({
      data: {
        id: groupId,
        kind: 'group',
        label: `Orphan: ${source} (${orphanCaps.length})`,
        color: '#7f1d1d',
        borderColor: '#fca5a5',
        meta: { kind: 'group', groupKind: 'orphan', mfe: null } satisfies NodeMeta,
      },
    });
    for (const cap of orphanCaps) {
      pushCapability(elements, cap, groupId, tenantId);
    }
  }

  return elements;
}

function pushCapability(
  elements: ElementDefinition[],
  cap: Capability,
  parentId: string,
  _tenantId: string,
): void {
  elements.push({
    data: {
      id: `cap:${cap.id}`,
      parent: parentId,
      kind: 'capability',
      // Truncate at 18 chars so labels don't collide with neighbours
      // at default zoom; full name is still visible in the side
      // panel on click. cap.name in `meta.capability` keeps the raw
      // value for tooltips/lookups.
      label: cap.name.length > 18 ? cap.name.slice(0, 16) + '…' : cap.name,
      color: lifecycleColor(cap.lifecycle),
      shape: kindShape(cap.kind),
      meta: { kind: 'capability', capability: cap } satisfies NodeMeta,
    },
  });
}

function lifecycleColor(lifecycle: Capability['lifecycle']): string {
  switch (lifecycle) {
    case 'published':  return '#16a34a';
    case 'draft':      return '#ca8a04';
    case 'deprecated': return '#94a3b8';
    case 'disabled':   return '#dc2626';
  }
}

function kindShape(kind: string): string {
  switch (kind) {
    case 'tool':       return 'ellipse';
    case 'component':  return 'hexagon';
    case 'form':       return 'diamond';
    case 'action':     return 'rectangle';
    case 'datasource': return 'octagon';
    default:           return 'tag';
  }
}
