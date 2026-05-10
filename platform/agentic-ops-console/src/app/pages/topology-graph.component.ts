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

    <div class="legend">
      <span class="legend-title">Legend:</span>
      <span class="legend-item"><span class="dot lifecycle-published"></span>published</span>
      <span class="legend-item"><span class="dot lifecycle-draft"></span>draft</span>
      <span class="legend-item"><span class="dot lifecycle-deprecated"></span>deprecated</span>
      <span class="legend-item"><span class="dot lifecycle-disabled"></span>disabled</span>
      <span class="legend-sep">·</span>
      <span class="legend-item shape-tool">tool</span>
      <span class="legend-item shape-component">component</span>
      <span class="legend-item shape-form">form</span>
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

    .legend {
      display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;
      padding: 0.375rem 0.75rem; background: rgba(255,255,255,0.04);
      border-radius: 0.375rem; margin-bottom: 0.5rem; font-size: 0.8125rem;
    }
    .legend-title { color: var(--fg-muted); font-weight: 500; }
    .legend-item { display: inline-flex; align-items: center; gap: 0.25rem; }
    .legend-sep { color: var(--fg-muted); }
    .shape-tool::before { content: '●'; color: var(--fg-muted); margin-right: 0.25rem; }
    .shape-component::before { content: '⬡'; color: var(--fg-muted); margin-right: 0.25rem; }
    .shape-form::before { content: '◆'; color: var(--fg-muted); margin-right: 0.25rem; }

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
          // Labels only render at sufficient zoom; below that, the
          // graph shows just dots and the operator zooms into a
          // section to read names. Same UX as OpenShift / Argo CD's
          // topology pages with 100+ entities.
          'label': '',
          'width': 22, 'height': 22,
          'border-width': 1, 'border-color': '#1f2937',
        },
      },
      {
        // Hover/selected state: full label + bigger node.
        selector: 'node[kind = "capability"]:active, node[kind = "capability"]:selected',
        style: {
          'label': 'data(label)',
          'text-valign': 'bottom',
          'text-margin-y': 6,
          'color': '#e6edf3',
          'font-size': 11,
          'text-background-color': '#0e1116',
          'text-background-opacity': 0.95,
          'text-background-padding': '4px',
          'text-background-shape': 'roundrectangle',
          'border-width': 2, 'border-color': '#58a6ff',
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
          'font-size': 12, 'font-weight': 600,
          'text-valign': 'top',
          'text-halign': 'center',
          'text-margin-y': -14,
          'text-background-color': '#0e1116',
          'text-background-opacity': 0.85,
          'text-background-padding': '4px',
          'text-background-shape': 'roundrectangle',
          'padding': '36px',
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
          'font-size': 14, 'font-weight': 700,
          'text-valign': 'top',
          'text-margin-y': -10,
          'padding': '32px',
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
    });

    this.cy.on('tap', 'node', (e: EventObject) => this.onNodeTap(e));
    // Hover-to-reveal label: cytoscape doesn't fire :hover via CSS
    // pseudo-class, so toggle a class on the node and let stylesheet
    // handle the visual.
    this.cy.on('mouseover', 'node[kind = "capability"]', (e: EventObject) => {
      e.target.addClass('hovered');
    });
    this.cy.on('mouseout', 'node[kind = "capability"]', (e: EventObject) => {
      e.target.removeClass('hovered');
    });
    // Add stylesheet for the hover class — same surface as :selected.
    this.cy.style()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .selector('node[kind = "capability"].hovered' as any)
      .style({
        'label': 'data(label)',
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'color': '#e6edf3',
        'font-size': 11,
        'text-background-color': '#0e1116',
        'text-background-opacity': 0.95,
        'text-background-padding': '4px',
        'text-background-shape': 'roundrectangle',
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
      animationDuration: 400,
      fit: true,
      padding: 32,
      // cose-bilkent-specific options ignored by other layouts.
      // Tuned for ediscovery-scale (50+ capabilities across 3-5 groups)
      // — bumped repulsion + edge length so labels don't overlap;
      // tile:true packs compound children into a grid (less sparse
      // than pure force-directed at this density).
      idealEdgeLength: 200,
      nodeRepulsion: 50_000,
      gravity: 0.05,
      gravityRangeCompound: 3.0,
      nestingFactor: 1.2,
      // tile:false lets compound children spread freely under
      // force-directed pressure — produces bigger compound boxes
      // that push each other apart instead of tile-packed islands
      // that overlap.
      tile: false,
      randomize: true,
      numIter: 2500,
      // suppress @typescript-eslint via cast — extension options aren't typed.
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
