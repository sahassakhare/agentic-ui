import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import {
  getDocument,
  listProductionSets,
  type ProductionSet,
} from '@infra-tools/demo-ediscovery-shared';
import { environment } from '../../../environments/environment';
import { MatterStore } from '../../services/matter.store';
import { IconComponent } from '../../ui/icon.component';
import { StatusBadgeComponent, type StatusTone } from '../../ui/status-badge.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';

/**
 * Productions page. Master-detail like the Custodians view: pick a
 * production set on the left, see its lifecycle + Bates range +
 * documents on the right.
 *
 * Listens to `MatterStore` signals (custodians + holds) so any tool
 * call mutating the broader state forces a recompute. Production-
 * specific signals come via the `bump` counter — `mock-data` isn't
 * itself reactive.
 */
@Component({
  selector: 'app-productions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, IconComponent, StatusBadgeComponent, EmptyStateComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Delivery</p>
        <h1>Production sets</h1>
        <p class="muted">
          {{ list().length }} set(s) on this matter ·
          {{ countByStatus('draft') }} draft ·
          {{ countByStatus('review') }} in review ·
          {{ countByStatus('finalized') }} finalised ·
          {{ countByStatus('delivered') }} delivered
        </p>
      </div>
    </section>

    @if (list().length === 0) {
      <mvk-empty-state title="No production sets yet" icon="archive"
        message="Ask the production specialist to assemble a set with a Bates pattern and scope."
        hint="Create production PROD-002 with all responsive non-privileged docs from January, TIFF format, Bates ACME-{seq:07d}" />
    } @else {
      <div class="layout">
        <aside class="list">
          @for (p of list(); track p.id) {
            <button type="button" class="row" [class.active]="active() === p.id" (click)="select(p.id)" [attr.data-status]="p.status">
              <span class="dot"></span>
              <div class="meta">
                <strong>{{ p.name }}</strong>
                <span><code>{{ p.id }}</code> · {{ p.documents.length }} doc(s)</span>
              </div>
              <mvk-status-badge [tone]="statusTone(p.status)">{{ p.status }}</mvk-status-badge>
            </button>
          }
        </aside>

        <section class="detail">
          @if (selected(); as p) {
            <header class="d-head">
              <div>
                <p class="d-meta"><code>{{ p.id }}</code> · created {{ longDate(p.createdAt) }}</p>
                <h2>{{ p.name }}</h2>
                <div class="d-badges">
                  <mvk-status-badge [tone]="statusTone(p.status)">{{ p.status }}</mvk-status-badge>
                  <span class="format" [attr.data-fmt]="p.format">{{ p.format }}</span>
                  <span class="bates"><svg-icon name="tag" [size]="11" /> <code>{{ p.batesPattern }}</code></span>
                </div>
              </div>
            </header>

            <div class="kpis">
              <div class="kpi"><span class="lbl">Documents</span><strong>{{ p.documents.length | number }}</strong></div>
              <div class="kpi"><span class="lbl">Bates first</span><strong><code>{{ batesFirst(p) }}</code></strong></div>
              <div class="kpi"><span class="lbl">Bates last</span><strong><code>{{ batesLast(p) }}</code></strong></div>
              <div class="kpi"><span class="lbl">Total redactions</span><strong>{{ totalRedactions(p) }}</strong></div>
            </div>

            <section class="block">
              <header class="b-head"><h3>Lifecycle</h3></header>
              <div class="lifecycle">
                @for (step of lifecycle(p); track step.label) {
                  <div class="step" [class.done]="step.done" [class.current]="step.current">
                    <span class="num">{{ step.idx }}</span>
                    <div>
                      <strong>{{ step.label }}</strong>
                      <span>{{ step.desc }}</span>
                    </div>
                    @if (step.idx < 4) { <span class="arrow">→</span> }
                  </div>
                }
              </div>
            </section>

            <section class="block">
              <header class="b-head"><h3>Documents in this set ({{ p.documents.length }})</h3></header>
              @if (p.documents.length === 0) {
                <p class="empty">No documents matched this set's scope filters.</p>
              } @else {
                <table>
                  <thead>
                    <tr>
                      <th>Bates</th>
                      <th>Document</th>
                      <th>Custodian</th>
                      <th class="num">Redactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (id of p.documents; track id) {
                      @if (doc(id); as d) {
                        <tr>
                          <td><code>{{ d.bates ?? '—' }}</code></td>
                          <td>
                            <span class="ext">.{{ ext(d.fileName) }}</span>
                            <strong>{{ d.fileName }}</strong>
                          </td>
                          <td><code>{{ d.custodianId }}</code></td>
                          <td class="num">{{ d.redactions.length }}</td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              }
            </section>
          } @else {
            <div class="placeholder">
              <svg-icon name="archive" [size]="32" />
              <h2>Select a production set</h2>
              <p>Pick a set on the left to inspect its Bates range, document list, and lifecycle status.</p>
            </div>
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host { display: block; max-width: 1280px; margin: 0 auto; }

    .page-head { margin-bottom: var(--s-5); }
    .crumb { margin: 0; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--c-brand); font-weight: 600; }
    h1 { margin: 0.2rem 0 0.3rem; font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -0.02em; }
    .muted { color: var(--c-text-mute); margin: 0; font-size: var(--fs-sm); }

    .layout { display: grid; grid-template-columns: 360px 1fr; gap: var(--s-4); }
    @media (max-width: 1024px) { .layout { grid-template-columns: 1fr; } }

    .list {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); padding: var(--s-2);
      display: flex; flex-direction: column; gap: 2px;
      max-height: calc(100vh - 200px); overflow-y: auto;
    }
    .row {
      width: 100%; text-align: left;
      display: grid; grid-template-columns: 8px 1fr auto; gap: var(--s-3);
      align-items: center;
      padding: var(--s-3);
      background: transparent; border: 1px solid transparent; border-radius: var(--r-md);
      cursor: pointer; transition: background var(--t-fast);
    }
    .row:hover { background: var(--c-surface-2); }
    .row.active { background: var(--c-brand-tint); border-color: var(--c-brand-soft); }
    .row .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--c-text-faint); }
    .row[data-status="draft"]     .dot { background: var(--c-text-faint); }
    .row[data-status="review"]    .dot { background: var(--c-info); }
    .row[data-status="finalized"] .dot { background: var(--c-warn); }
    .row[data-status="delivered"] .dot { background: var(--c-ok); }
    .row .meta strong { display: block; color: var(--c-text); font-size: var(--fs-sm); font-weight: 600; }
    .row .meta span { display: block; color: var(--c-text-mute); font-size: 0.7rem; }

    .detail {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); box-shadow: var(--sh-1);
      min-height: 480px;
    }
    .placeholder { padding: var(--s-12) var(--s-6); text-align: center; color: var(--c-text-faint); }
    .placeholder svg-icon { color: var(--c-text-faint); margin-bottom: var(--s-3); }
    .placeholder h2 { margin: 0 0 var(--s-2); color: var(--c-text-2); font-size: var(--fs-md); font-weight: 600; }
    .placeholder p { margin: 0 auto; font-size: var(--fs-sm); max-width: 380px; }

    .d-head { padding: var(--s-5); border-bottom: 1px solid var(--c-divider); }
    .d-meta { margin: 0; color: var(--c-text-mute); font-size: var(--fs-xs); }
    .d-meta code { font-family: ui-monospace, monospace; background: var(--c-surface-1); padding: 1px 5px; border-radius: 3px; }
    .d-head h2 { margin: 0.3rem 0 0.5rem; font-size: var(--fs-xl); font-weight: 600; }
    .d-badges { display: flex; gap: var(--s-2); flex-wrap: wrap; align-items: center; }
    .format { padding: 2px 8px; border-radius: var(--r-pill); font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; background: var(--c-surface-2); color: var(--c-text-2); }
    .format[data-fmt="tiff"] { background: var(--c-warn-soft); color: var(--c-warn); }
    .format[data-fmt="pdf"] { background: var(--c-bad-soft); color: var(--c-bad); }
    .format[data-fmt="native"] { background: var(--c-ok-soft); color: var(--c-ok); }
    .format[data-fmt="load-file"] { background: #ede9fe; color: #5b21b6; }
    .bates { display: inline-flex; align-items: center; gap: 4px; color: var(--c-text-mute); font-size: var(--fs-xs); }
    .bates code { font-family: ui-monospace, monospace; }

    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3); padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--c-divider); background: var(--c-surface-1); }
    @media (max-width: 720px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
    .kpi { display: flex; flex-direction: column; gap: 2px; }
    .kpi .lbl { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); font-weight: 600; }
    .kpi strong { font-size: var(--fs-lg); color: var(--c-text); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .kpi code { font-family: ui-monospace, monospace; font-size: 0.95em; }

    .block { padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--c-divider); }
    .block:last-child { border-bottom: 0; }
    .b-head { margin-bottom: var(--s-3); }
    .block h3 { margin: 0; font-size: var(--fs-md); color: var(--c-text); font-weight: 600; }

    .lifecycle { display: flex; gap: var(--s-2); flex-wrap: wrap; align-items: stretch; }
    .lifecycle .step {
      flex: 1; min-width: 140px;
      display: flex; align-items: center; gap: var(--s-2);
      padding: var(--s-3);
      background: var(--c-surface-1); border: 1px solid var(--c-border); border-radius: var(--r-md);
      font-size: var(--fs-sm);
      color: var(--c-text-mute);
      position: relative;
    }
    .lifecycle .step.done { background: var(--c-brand-tint); border-color: var(--c-brand-soft); color: var(--c-brand-strong); }
    .lifecycle .step.current { background: var(--c-warn-soft); border-color: var(--c-warn); color: var(--c-warn); }
    .lifecycle .step .num {
      width: 24px; height: 24px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-0); color: inherit; font-weight: 700; flex-shrink: 0;
      border: 1px solid currentColor;
    }
    .lifecycle .step strong { display: block; font-weight: 600; }
    .lifecycle .step span { font-size: 0.7rem; }
    .lifecycle .arrow { position: absolute; right: -10px; color: var(--c-text-faint); font-weight: 700; }

    table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    th, td { padding: 0.55rem 0.7rem; text-align: left; border-bottom: 1px solid var(--c-divider); }
    th { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-text-mute); font-weight: 500; }
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td strong { color: var(--c-text); font-weight: 500; margin-left: 6px; }
    .ext { padding: 1px 5px; background: var(--c-surface-2); color: var(--c-text-2); border-radius: var(--r-sm); font-family: ui-monospace, monospace; font-size: 0.62rem; font-weight: 600; text-transform: uppercase; }
    .empty { color: var(--c-text-faint); font-size: var(--fs-sm); margin: 0; }
  `,
})
export class ProductionsComponent {
  protected readonly matterId = environment.matterId;
  private readonly store = inject(MatterStore);
  private readonly route = inject(ActivatedRoute);

  /** Bumps when state changes — production list isn't a signal in shared. */
  private readonly bump = signal(0);
  protected readonly list = computed(() => {
    this.store.custodians(); this.store.legalHolds(); this.bump();
    return listProductionSets(this.matterId);
  });

  protected readonly active = signal<string | null>(null);
  private readonly idParam = toSignal(this.route.queryParamMap, { initialValue: null });
  private readonly _syncFromQuery = effect(() => {
    const id = this.idParam()?.get('id');
    if (id) this.active.set(id);
  });

  protected readonly selected = computed(() => {
    const id = this.active();
    return id ? this.list().find((p) => p.id === id) : undefined;
  });

  countByStatus(status: ProductionSet['status']): number {
    return this.list().filter((p) => p.status === status).length;
  }
  statusTone(status: string): StatusTone {
    if (status === 'delivered') return 'ok';
    if (status === 'finalized') return 'warn';
    if (status === 'review')    return 'info';
    return 'neutral';
  }
  doc(id: string) { return getDocument(id); }
  ext(name: string): string { const dot = name.lastIndexOf('.'); return dot === -1 ? 'file' : name.slice(dot + 1); }

  batesFirst(p: ProductionSet): string {
    if (p.documents.length === 0) return '—';
    return getDocument(p.documents[0]!)?.bates ?? '—';
  }
  batesLast(p: ProductionSet): string {
    if (p.documents.length === 0) return '—';
    return getDocument(p.documents[p.documents.length - 1]!)?.bates ?? '—';
  }
  totalRedactions(p: ProductionSet): number {
    return p.documents.reduce((n, id) => n + (getDocument(id)?.redactions.length ?? 0), 0);
  }
  longDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso :
      d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  lifecycle(p: ProductionSet): readonly { idx: number; label: string; desc: string; done: boolean; current: boolean }[] {
    const stage = { draft: 1, review: 2, finalized: 3, delivered: 4 }[p.status] ?? 0;
    return [
      { idx: 1, label: 'Draft',      desc: 'Set created with scope filters',          done: stage >= 1, current: stage === 1 },
      { idx: 2, label: 'Bates',      desc: 'Sequential ids stamped on every doc',     done: stage >= 2, current: stage === 2 },
      { idx: 3, label: 'Finalised',  desc: 'Set is reviewed and locked',              done: stage >= 3, current: stage === 3 },
      { idx: 4, label: 'Delivered',  desc: 'Hand-off to opposing counsel complete',   done: stage >= 4, current: stage === 4 },
    ];
  }

  select(id: string): void { this.active.set(id); }
}
