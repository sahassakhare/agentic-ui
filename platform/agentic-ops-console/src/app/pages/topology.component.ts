import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import type { Capability, MfeRemote } from '../services/catalog-client.service';
import { TopologyDataService } from '../services/topology-data.service';
import { autoStream } from '../services/catalog-stream.service';

type LifecycleFilter = 'all' | 'published' | 'draft' | 'deprecated' | 'disabled';

interface TopologyGroup {
  /** Group label — 'Host-direct' or the MFE remote name. */
  readonly label: string;
  /**
   * `null` for the host-direct group; the full `MfeRemote` for
   * federated remotes so the UI can surface manifest URL / status.
   */
  readonly mfe: MfeRemote | null;
  readonly capabilitiesByKind: Readonly<Record<string, readonly Capability[]>>;
  readonly totalCount: number;
}

interface Topology {
  readonly tenantId: string | null;
  readonly groups: readonly TopologyGroup[];
  readonly totalCapabilities: number;
  readonly totalMfes: number;
  readonly hostCapabilities: number;
}

/**
 * Capability topology page — slice S1 of the post-audit follow-ups
 * plan. A tree view of `tenant → MFE remotes (or "Host-direct") →
 * capabilities` so operators get one visual answer to "what's
 * running where, who contributes what, and what's the current
 * lifecycle state."
 *
 * Live: subscribes to the existing `CatalogStreamService` and
 * recomputes on every `capability` or `mfe` mutation. Filter by
 * lifecycle. Click a capability to jump to the capabilities page
 * for inline edit.
 *
 * Implemented as a tree of nested `<details>` blocks rather than a
 * force-directed graph — gives operators 90% of the value at <5%
 * of the bundle cost. A force-directed view can layer on later if
 * adoption demand surfaces.
 */
@Component({
  selector: 'ops-topology',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="header">
      <h1>Topology</h1>
      <div class="filters">
        <a routerLink="/topology/graph" class="btn ghost view-toggle">
          📈 Graph view
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
        <button class="btn ghost" type="button" (click)="refresh()">⟳ Refresh</button>
      </div>
    </div>

    @if (error(); as err) { <div class="error">Failed: {{ err }}</div> }
    @if (loading()) {
      <p class="dim">Loading…</p>
    } @else if (topology(); as t) {
      <div class="summary">
        <span class="chip">Tenant: <strong>{{ t.tenantId ?? '—' }}</strong></span>
        <span class="chip">{{ t.totalCapabilities }} capabilities</span>
        <span class="chip">{{ t.totalMfes }} MFE remotes</span>
        <span class="chip">{{ t.hostCapabilities }} host-direct</span>
      </div>

      @if (t.groups.length === 0) {
        <div class="empty">
          No capabilities match the current filter. Try widening the lifecycle filter,
          or onboard a tenant + register some capabilities first.
        </div>
      } @else {
        <div class="tree">
          @for (group of t.groups; track group.label) {
            <details open class="group" [class.host-direct]="!group.mfe">
              <summary>
                <span class="kind-icon">{{ group.mfe ? '⚡' : '🏠' }}</span>
                <span class="group-label">{{ group.label }}</span>
                @if (group.mfe; as m) {
                  <span class="chip status-{{ m.status }}">{{ m.status }}</span>
                  <span class="chip dim">v{{ m.version ?? '—' }}</span>
                }
                <span class="chip dim">{{ group.totalCount }} capabilities</span>
              </summary>

              @if (group.mfe; as m) {
                <div class="manifest-row">
                  <span class="dim">manifestUrl:</span>
                  <code>{{ m.manifestUrl }}</code>
                </div>
              }

              @for (kind of kindsOf(group); track kind) {
                <div class="kind-block">
                  <h4>{{ kind }} ({{ group.capabilitiesByKind[kind]!.length }})</h4>
                  <ul class="cap-list">
                    @for (cap of group.capabilitiesByKind[kind]!; track cap.id) {
                      <li>
                        <a [routerLink]="['/capabilities']" [queryParams]="{ focus: cap.id }">
                          <span class="dot lifecycle-{{ cap.lifecycle }}"
                                [title]="'lifecycle: ' + cap.lifecycle"></span>
                          <span class="cap-name">{{ cap.name }}</span>
                        </a>
                        @if (cap.tags.length > 0) {
                          <span class="tags">
                            @for (tag of cap.tags; track tag) {
                              <span class="tag">{{ tag }}</span>
                            }
                          </span>
                        }
                        @if (cap.owner) { <span class="owner">{{ cap.owner }}</span> }
                      </li>
                    }
                  </ul>
                </div>
              }
            </details>
          }
        </div>
      }
    }
  `,
  styles: [`
    .header { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .header h1 { margin: 0; flex: 1; }
    .filters { display: flex; align-items: center; gap: 0.75rem; }
    .filters label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; }

    .summary { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; padding: 0.5rem 0; }
    .chip { background: #f1f5f9; padding: 0.125rem 0.5rem; border-radius: 999px; font-size: 0.8125rem; }
    .chip.dim { color: #64748b; }
    .chip.status-active { background: #dcfce7; color: #166534; }
    .chip.status-degraded { background: #fef9c3; color: #854d0e; }
    .chip.status-inactive { background: #fee2e2; color: #991b1b; }

    .tree { display: flex; flex-direction: column; gap: 0.75rem; }
    .group {
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      background: #fff;
    }
    .group.host-direct { background: #fafafa; }
    .group > summary {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      font-weight: 500;
    }
    .group > summary::-webkit-details-marker { display: none; }
    .kind-icon { font-size: 1.125rem; }
    .group-label { font-weight: 600; flex-grow: 0; }

    .manifest-row {
      margin: 0.5rem 0 0.75rem 1.75rem;
      font-size: 0.8125rem;
    }
    .manifest-row code {
      background: #f1f5f9; padding: 0.125rem 0.375rem; border-radius: 0.25rem;
    }

    .kind-block { margin: 0.75rem 0 0.5rem 1.75rem; }
    .kind-block h4 { margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #475569; }

    .cap-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.25rem 1rem; }
    .cap-list li { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; }
    .cap-list a { display: inline-flex; align-items: center; gap: 0.5rem; color: inherit; text-decoration: none; }
    .cap-list a:hover .cap-name { text-decoration: underline; }

    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot.lifecycle-published { background: #16a34a; }
    .dot.lifecycle-draft { background: #ca8a04; }
    .dot.lifecycle-deprecated { background: #94a3b8; }
    .dot.lifecycle-disabled { background: #dc2626; }

    .tags { display: inline-flex; gap: 0.25rem; }
    .tag { font-size: 0.6875rem; background: #e0f2fe; color: #075985; padding: 0 0.25rem; border-radius: 0.25rem; }
    .owner { font-size: 0.75rem; color: #94a3b8; margin-left: auto; }

    .empty { padding: 1.5rem; background: #fafafa; border-radius: 0.5rem; color: #64748b; }
    .error { background: #fee2e2; color: #991b1b; padding: 0.75rem; border-radius: 0.375rem; margin-bottom: 0.75rem; }
    .dim { color: #64748b; }
  `],
})
export class TopologyComponent {
  private readonly data = inject(TopologyDataService);
  private readonly router = inject(Router);

  protected readonly capabilities = this.data.capabilities;
  protected readonly mfes = this.data.mfes;
  protected readonly loading = this.data.loading;
  protected readonly error = this.data.error;

  protected readonly lifecycleFilter = signal<LifecycleFilter>('all');

  protected readonly topology = computed<Topology | null>(() => {
    const caps = this.capabilities();
    const mfes = this.mfes();
    const filter = this.lifecycleFilter();

    const filtered = filter === 'all'
      ? caps
      : caps.filter((c) => c.lifecycle === filter);

    // Bucket by source. Source lives in `body.source` (per
    // CatalogCapabilityRegistrar mapping) — fall back to 'host' if
    // missing for entries seeded before the registrar's body shape
    // landed.
    const bySource = new Map<string, Capability[]>();
    for (const cap of filtered) {
      const source = (typeof cap.body['source'] === 'string' ? cap.body['source'] : 'host');
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source)!.push(cap);
    }

    // Build groups — one per known MFE remote (even if no caps under
    // it), one for "Host-direct" (source: 'host'), one per unknown
    // source (falls under "Other" with the source name as label).
    const groups: TopologyGroup[] = [];

    // Host-direct first.
    const hostCaps = bySource.get('host') ?? [];
    bySource.delete('host');
    if (hostCaps.length > 0 || filter === 'all') {
      groups.push({
        label: 'Host-direct',
        mfe: null,
        capabilitiesByKind: groupByKind(hostCaps),
        totalCount: hostCaps.length,
      });
    }

    // Each known MFE remote.
    for (const mfe of mfes) {
      const matching = bySource.get(mfe.name) ?? [];
      bySource.delete(mfe.name);
      groups.push({
        label: mfe.name,
        mfe,
        capabilitiesByKind: groupByKind(matching),
        totalCount: matching.length,
      });
    }

    // Stragglers — capabilities whose `source` doesn't match any
    // registered MFE. Surface these explicitly so operators notice
    // the orphan + can decide whether to register the remote or
    // delete the rows.
    for (const [source, caps2] of bySource) {
      groups.push({
        label: `Orphan: ${source}`,
        mfe: null,
        capabilitiesByKind: groupByKind(caps2),
        totalCount: caps2.length,
      });
    }

    return {
      tenantId: caps[0]?.tenantId ?? mfes[0]?.tenantId ?? null,
      groups,
      totalCapabilities: filtered.length,
      totalMfes: mfes.length,
      hostCapabilities: hostCaps.length,
    };
  });

  constructor() {
    void this.refresh();
    autoStream(() => { void this.refresh(); });
  }

  protected refresh(): Promise<void> {
    return this.data.refresh();
  }

  protected kindsOf(group: TopologyGroup): readonly string[] {
    return Object.keys(group.capabilitiesByKind).sort();
  }

  // Workaround for the protected-by-default modifier on Angular
  // signals — explicit assignment lets the template bind without
  // hoisting the field.
  protected readonly routerRef = this.router;
}

function groupByKind(caps: readonly Capability[]): Readonly<Record<string, readonly Capability[]>> {
  const groups: Record<string, Capability[]> = {};
  for (const cap of caps) {
    if (!groups[cap.kind]) groups[cap.kind] = [];
    groups[cap.kind]!.push(cap);
  }
  // Stable sort within each kind by name.
  for (const k of Object.keys(groups)) {
    groups[k]!.sort((a, b) => a.name.localeCompare(b.name));
  }
  return groups;
}
