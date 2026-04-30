import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatterStore } from '../services/matter.store';

/**
 * Matter snapshot — top-level dashboard. Reads from `MatterStore` so
 * tool handlers that mutate state (Phase 1+) reflect here automatically.
 *
 * Phase 0 ships the read-only snapshot; Phase 5 will add the audit-trail
 * pane and Phase 6's MCP integration won't change this view at all
 * (paralegals see the same data through Claude Desktop).
 */
@Component({
  selector: 'app-matter-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Matter snapshot</h1>
    <p class="muted">Read-only view. Use the chat panel to add custodians, place holds, and search documents.</p>

    <div class="grid">
      <article class="kpi">
        <h3>Custodians</h3>
        <p class="value">{{ custodianCount() }}</p>
        <p class="sub">{{ custodiansOnHold() }} under legal hold</p>
      </article>
      <article class="kpi">
        <h3>Documents</h3>
        <p class="value">{{ documentCount() }}</p>
        <p class="sub">across {{ collectionsComplete() }} completed collections</p>
      </article>
      <article class="kpi">
        <h3>Active holds</h3>
        <p class="value">{{ activeHoldCount() }}</p>
        <p class="sub">{{ holdAcknowledgedCount() }} acknowledged</p>
      </article>
    </div>

    <h2>Custodians</h2>
    @if (custodians().length === 0) {
      <p class="muted">No custodians yet. Try: <em>"Add Sarah Chen as a custodian on the Acme matter"</em>.</p>
    } @else {
      <table>
        <thead>
          <tr>
            <th>Custodian</th>
            <th>Department</th>
            <th>Hold</th>
            <th>Collection</th>
            <th>Documents</th>
          </tr>
        </thead>
        <tbody>
          @for (c of custodians(); track c.id) {
            <tr>
              <td>
                <strong>{{ c.name }}</strong>
                <small class="muted">{{ c.email }}</small>
              </td>
              <td>{{ c.department }}</td>
              <td>
                <span class="hold" [class.active]="c.hasLegalHold">
                  {{ c.hasLegalHold ? 'Active' : '—' }}
                </span>
              </td>
              <td>
                <span class="status" [attr.data-status]="c.collectionStatus">
                  {{ c.collectionStatus }}
                </span>
              </td>
              <td class="num">{{ c.documentCount | number }}</td>
            </tr>
          }
        </tbody>
      </table>
    }

    <h2>Active legal holds</h2>
    @if (legalHolds().length === 0) {
      <p class="muted">No legal holds.</p>
    } @else {
      @for (hold of legalHolds(); track hold.id) {
        <article class="hold-card">
          <header>
            <strong>{{ hold.id }}</strong>
            <span class="muted">{{ hold.custodianIds.length }} custodian(s)</span>
            @if (hold.acknowledgedAt) {
              <span class="badge ok">acknowledged</span>
            } @else {
              <span class="badge warn">pending acknowledgement</span>
            }
          </header>
          <p>{{ hold.scope }}</p>
        </article>
      }
    }
  `,
  styles: `
    :host { display: block; }
    h1 { margin: 0 0 0.4rem; font-size: 1.4rem; }
    h2 { margin: 1.6rem 0 0.6rem; font-size: 1.05rem; color: #1e293b; }
    .muted { color: #64748b; font-size: 0.9rem; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.8rem; margin: 1rem 0 0.4rem; }
    .kpi { padding: 0.9rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 0.5rem; }
    .kpi h3 { margin: 0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    .kpi .value { margin: 0.3rem 0 0.1rem; font-size: 1.6rem; font-weight: 700; color: #0f172a; }
    .kpi .sub { margin: 0; font-size: 0.78rem; color: #64748b; }

    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 0.5rem; overflow: hidden; font-size: 0.88rem; }
    th, td { padding: 0.55rem 0.8rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-weight: 500; color: #475569; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
    tr:last-child td { border-bottom: none; }
    td.num { font-variant-numeric: tabular-nums; }
    td small { display: block; }

    .hold { font-size: 0.75rem; padding: 1px 6px; border-radius: 4px; background: #f1f5f9; color: #64748b; }
    .hold.active { background: #fef3c7; color: #92400e; }

    .status { font-size: 0.75rem; padding: 1px 8px; border-radius: 999px; text-transform: capitalize; }
    .status[data-status="complete"] { background: #d1fae5; color: #065f46; }
    .status[data-status="in-progress"] { background: #dbeafe; color: #1e3a8a; }
    .status[data-status="pending"] { background: #fee2e2; color: #991b1b; }

    .hold-card { padding: 0.8rem 1rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 0.5rem; margin-bottom: 0.6rem; border-left: 4px solid #d97706; }
    .hold-card header { display: flex; gap: 0.6rem; align-items: center; margin-bottom: 0.4rem; }
    .hold-card p { margin: 0; color: #475569; font-size: 0.85rem; }
    .badge { font-size: 0.7em; padding: 1px 8px; border-radius: 999px; }
    .badge.ok { background: #d1fae5; color: #065f46; }
    .badge.warn { background: #fef3c7; color: #92400e; }
  `,
  imports: [DecimalPipe],
})
export class MatterDashboardComponent {
  private readonly store = inject(MatterStore);

  protected readonly custodians = this.store.custodians;
  protected readonly legalHolds = this.store.legalHolds;

  protected readonly custodianCount = computed(() => this.custodians().length);
  protected readonly custodiansOnHold = computed(
    () => this.custodians().filter((c) => c.hasLegalHold).length,
  );
  protected readonly documentCount = computed(
    () => this.custodians().reduce((sum, c) => sum + c.documentCount, 0),
  );
  protected readonly collectionsComplete = computed(
    () => this.custodians().filter((c) => c.collectionStatus === 'complete').length,
  );
  protected readonly activeHoldCount = computed(
    () => this.legalHolds().filter((h) => !h.releasedAt).length,
  );
  protected readonly holdAcknowledgedCount = computed(
    () => this.legalHolds().filter((h) => h.acknowledgedAt && !h.releasedAt).length,
  );
}
