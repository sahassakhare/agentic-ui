import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { listAuditEvents, listDocuments } from '@maverick/demo-ediscovery-shared';
import { environment } from '../../environments/environment';
import { MatterStore } from '../services/matter.store';
import { IconComponent } from '../ui/icon.component';
import { KpiCardComponent } from '../ui/kpi-card.component';
import { StatusBadgeComponent, type StatusTone } from '../ui/status-badge.component';
import { TagChipComponent } from '../ui/tag-chip.component';
import { EmptyStateComponent } from '../ui/empty-state.component';

/**
 * Matter dashboard. The default landing page for any user — gives a
 * single-screen view of where the matter stands across collection,
 * review, and audit dimensions.
 *
 * Reads from `MatterStore` signals (custodians + holds) so tool calls
 * mutate the dashboard live, and from the framework-agnostic mock-data
 * accessors for documents + audit events.
 */
@Component({
  selector: 'app-matter-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RouterLink, IconComponent, KpiCardComponent, StatusBadgeComponent, TagChipComponent, EmptyStateComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Matter</p>
        <h1>Matter snapshot</h1>
        <p class="muted">Real-time view of collection, review, and chain-of-custody activity. Use the coordinator on the right to drive any action.</p>
      </div>
      <div class="head-actions">
        <span class="pill"><span class="dot"></span> {{ matterStatus }}</span>
        <span class="pill range">Bates range <code>{{ bates }}</code></span>
      </div>
    </section>

    <!-- KPI grid -->
    <section class="kpi-grid">
      <mvk-kpi-card label="Custodians" [value]="custodianCount()" icon="users"
                    [sub]="custodiansOnHold() + ' under legal hold'"
                    [deltaPct]="custodianCount() > 0 ? 12.5 : null" deltaLabel="onboarded this month" />
      <mvk-kpi-card label="Documents" [value]="documentCount() | number" icon="documents" tone="info"
                    [sub]="reviewedCount() + ' reviewed · ' + (documentCount() - reviewedCount()) + ' pending'" />
      <mvk-kpi-card label="Active holds" [value]="activeHoldCount()" icon="shield" tone="warn"
                    [sub]="holdAcknowledgedCount() + ' acknowledged · ' + holdPendingCount() + ' pending ack'" />
      <mvk-kpi-card label="Audit events" [value]="auditCount() | number" icon="audit" tone="ok"
                    sub="immutable chain-of-custody trail" />
    </section>

    <!-- Trimodal launcher (plan R3) — same registry definitions, three triggers.
         Proves the agentic UI tier is surface-independent: chat is one trigger,
         not the only trigger. -->
    <section class="trimodal panel" aria-labelledby="trimodal-h2">
      <header class="panel-h">
        <div>
          <h2 id="trimodal-h2">Launch from any surface</h2>
          <p class="muted">
            Same registered form / workflow definition. Three triggers — chat,
            direct page, headless LLM (Cmd+K). Audit row is identical regardless
            of which one fired.
          </p>
        </div>
      </header>

      <table class="trimodal-grid">
        <thead>
          <tr>
            <th scope="col">Capability</th>
            <th scope="col">Chat</th>
            <th scope="col">Direct page</th>
            <th scope="col">Cmd+K (LLM)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Custodian intake (form)</th>
            <td><code>"onboard a Finance custodian"</code></td>
            <td><a routerLink="/intake/custodian" [queryParams]="{ department: 'Finance' }" class="link">→ /intake/custodian</a></td>
            <td><span class="muted">"add finance person to project phoenix"</span></td>
          </tr>
          <tr>
            <th scope="row">Place legal hold (workflow)</th>
            <td><code>"place a legal hold"</code></td>
            <td><a routerLink="/workflows/place-hold" class="link">→ /workflows/place-hold</a></td>
            <td><span class="muted">"hold custodians for matter X"</span></td>
          </tr>
          <tr>
            <th scope="row">Production preview</th>
            <td><code>"preview production"</code></td>
            <td><a routerLink="/productions" class="link">→ /productions</a></td>
            <td><span class="muted">"show me the next production batch"</span></td>
          </tr>
          <tr>
            <th scope="row">Place hold + collect (multi-actor)</th>
            <td><span class="muted">— wizard is page-only —</span></td>
            <td><a routerLink="/workflows/place-hold-and-collect" class="link">→ /workflows/place-hold-and-collect</a></td>
            <td><span class="muted">— wizard is page-only —</span></td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="two-col">
      <section class="panel">
        <header class="panel-h">
          <div>
            <h2>Custodians</h2>
            <p class="muted">{{ custodianCount() }} on this matter · {{ collectionsComplete() }} collections complete</p>
          </div>
          <a routerLink="/custodians" class="link"><svg-icon name="chevron-right" [size]="14" /> View all</a>
        </header>

        @if (custodians().length === 0) {
          <mvk-empty-state title="No custodians yet" icon="users"
            message="Add the first custodian and place a legal hold to start the matter."
            hint="Add Sarah Chen from Engineering as a custodian on this matter" />
        } @else {
          <table>
            <thead>
              <tr>
                <th>Custodian</th>
                <th>Department</th>
                <th>Hold</th>
                <th>Collection</th>
                <th class="num">Documents</th>
              </tr>
            </thead>
            <tbody>
              @for (c of custodians(); track c.id) {
                <tr>
                  <td>
                    <div class="who">
                      <span class="avatar small" [attr.data-tone]="avatarTone(c.id)">{{ initials(c.name) }}</span>
                      <div>
                        <strong>{{ c.name }}</strong>
                        <small>{{ c.email }}</small>
                      </div>
                    </div>
                  </td>
                  <td><span class="dept">{{ c.department }}</span></td>
                  <td>
                    @if (c.hasLegalHold) {
                      <mvk-status-badge tone="warn">active</mvk-status-badge>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td><mvk-status-badge [tone]="collectionTone(c.collectionStatus)">{{ c.collectionStatus }}</mvk-status-badge></td>
                  <td class="num">{{ c.documentCount | number }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section class="panel side">
        <header class="panel-h">
          <h2>Hold acknowledgements</h2>
          <p class="muted">{{ holdAcknowledgedCount() }} of {{ activeHoldCount() }} acknowledged</p>
        </header>

        <div class="ack-bar">
          <div class="track"><div class="fill" [style.width.%]="ackPct()"></div></div>
          <span class="num">{{ ackPct() }}%</span>
        </div>

        @if (legalHolds().length === 0) {
          <p class="empty">No legal holds.</p>
        } @else {
          <ul class="hold-list">
            @for (hold of legalHolds(); track hold.id) {
              <li>
                <header>
                  <code>{{ hold.id }}</code>
                  @if (hold.releasedAt) {
                    <mvk-status-badge tone="neutral">released</mvk-status-badge>
                  } @else if (hold.acknowledgedAt) {
                    <mvk-status-badge tone="ok">acknowledged</mvk-status-badge>
                  } @else {
                    <mvk-status-badge tone="warn">pending ack</mvk-status-badge>
                  }
                </header>
                <p>{{ hold.scope }}</p>
                <p class="meta"><svg-icon name="users" [size]="12" /> {{ hold.custodianIds.length }} custodian(s) · issued {{ shortDate(hold.issuedAt) }}</p>
              </li>
            }
          </ul>
        }
      </section>
    </div>

    <div class="two-col">
      <section class="panel">
        <header class="panel-h">
          <div>
            <h2>Tag distribution</h2>
            <p class="muted">Across all {{ documentCount() }} documents</p>
          </div>
          <a routerLink="/documents" class="link"><svg-icon name="chevron-right" [size]="14" /> Open documents</a>
        </header>

        @if (tagBreakdown().length === 0) {
          <mvk-empty-state title="No tags applied yet" icon="tag"
            message="Use search + tag tools to start triaging the document set."
            hint="Tag DOC-7891234 as responsive" />
        } @else {
          <ul class="tag-bars">
            @for (entry of tagBreakdown(); track entry.tag) {
              <li>
                <mvk-tag-chip [tag]="entry.tag" />
                <span class="bar"><span class="fill" [style.width.%]="entry.pct"></span></span>
                <span class="num">{{ entry.count }}</span>
              </li>
            }
          </ul>
        }
      </section>

      <section class="panel side">
        <header class="panel-h">
          <div>
            <h2>Recent activity</h2>
            <p class="muted">Live audit-trail tail · {{ auditCount() }} total events</p>
          </div>
          <a routerLink="/audit" class="link"><svg-icon name="chevron-right" [size]="14" /> View full trail</a>
        </header>

        @if (recentEvents().length === 0) {
          <p class="empty">No activity yet.</p>
        } @else {
          <ol class="feed">
            @for (e of recentEvents(); track e.id) {
              <li>
                <span class="dot" [attr.data-action]="actionFamily(e.action)"></span>
                <div class="content">
                  <p><strong>{{ formatAction(e.action) }}</strong> <code>{{ e.target.id }}</code></p>
                  <p class="meta">{{ e.actor }} · {{ shortDate(e.timestamp) }}</p>
                </div>
              </li>
            }
          </ol>
        }
      </section>
    </div>
  `,
  styles: `
    :host { display: block; max-width: 1280px; margin: 0 auto; }

    .page-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: var(--s-4); margin-bottom: var(--s-6);
    }
    .crumb { margin: 0; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--c-brand); font-weight: 600; }
    h1 { margin: 0.2rem 0 0.3rem; font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -0.02em; }
    h2 { margin: 0; font-size: var(--fs-md); color: var(--c-text); font-weight: 600; }
    .muted { color: var(--c-text-mute); font-size: var(--fs-sm); margin: 0; }
    .head-actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
    .pill {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 4px 10px;
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-pill); font-size: var(--fs-xs); color: var(--c-text-2);
    }
    .pill .dot { width: 6px; height: 6px; border-radius: 999px; background: var(--c-ok); }
    .pill.range code { font-family: ui-monospace, monospace; color: var(--c-text); margin-left: 4px; }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--s-4); margin-bottom: var(--s-6);
    }

    /* Trimodal launcher — three triggers, one definition. */
    .trimodal { margin-bottom: var(--s-6); }
    .trimodal-grid { width: 100%; border-collapse: collapse; }
    .trimodal-grid th, .trimodal-grid td {
      text-align: left; padding: var(--s-3) var(--s-4);
      border-bottom: 1px solid var(--c-border); font-size: var(--fs-sm);
    }
    .trimodal-grid thead th {
      font-weight: 600; color: var(--c-text-2);
      text-transform: uppercase; font-size: var(--fs-xs); letter-spacing: 0.04em;
    }
    .trimodal-grid tbody th { font-weight: 600; color: var(--c-text); }
    .trimodal-grid code {
      font-family: ui-monospace, monospace; font-size: 0.8125rem;
      background: var(--c-surface-2, var(--c-surface-0));
      padding: 0.0625rem 0.3125rem; border-radius: var(--r-1);
    }
    .trimodal-grid .link { color: var(--c-accent); text-decoration: none; }
    .trimodal-grid .link:hover { text-decoration: underline; }
    .trimodal-grid tbody tr:last-child th, .trimodal-grid tbody tr:last-child td { border-bottom: none; }
    @media (max-width: 900px) {
      .trimodal-grid thead { display: none; }
      .trimodal-grid tbody tr { display: grid; grid-template-columns: 1fr; gap: 0.25rem; padding: var(--s-3) 0; border-bottom: 1px solid var(--c-border); }
      .trimodal-grid tbody th, .trimodal-grid tbody td { padding: 0; border: none; }
      .trimodal-grid tbody td::before { content: attr(data-label) ': '; color: var(--c-text-2); font-size: var(--fs-xs); }
    }

    .two-col {
      display: grid; grid-template-columns: 1.5fr 1fr; gap: var(--s-4);
      margin-bottom: var(--s-6);
    }
    @media (max-width: 1100px) { .two-col { grid-template-columns: 1fr; } }

    .panel {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); padding: var(--s-5);
      box-shadow: var(--sh-1);
    }
    .panel-h {
      display: flex; align-items: center; justify-content: space-between;
      gap: var(--s-3); margin-bottom: var(--s-4);
    }
    .panel-h .muted { font-size: var(--fs-sm); margin-top: 2px; }
    .link {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: var(--fs-sm); color: var(--c-brand); font-weight: 500;
    }
    .link:hover { text-decoration: none; color: var(--c-brand-strong); }

    table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    th, td { padding: 0.6rem 0.7rem; text-align: left; border-bottom: 1px solid var(--c-divider); }
    th {
      font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--c-text-mute); font-weight: 500;
      background: var(--c-surface-1);
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--c-surface-1); }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .who { display: flex; align-items: center; gap: var(--s-3); }
    .who strong { display: block; color: var(--c-text); }
    .who small { display: block; color: var(--c-text-mute); font-size: 0.7rem; }
    .avatar.small {
      width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-2); color: var(--c-text-2);
      border-radius: var(--r-pill);
      font-size: 0.7rem; font-weight: 600;
    }
    .avatar.small[data-tone="0"] { background: #e0e7ff; color: #3730a3; }
    .avatar.small[data-tone="1"] { background: #fce7f3; color: #9f1239; }
    .avatar.small[data-tone="2"] { background: #d1fae5; color: #065f46; }
    .avatar.small[data-tone="3"] { background: #fef3c7; color: #92400e; }
    .avatar.small[data-tone="4"] { background: #dbeafe; color: #1e40af; }
    .dept { color: var(--c-text-2); font-size: var(--fs-sm); }

    .ack-bar { display: flex; align-items: center; gap: var(--s-3); margin-bottom: var(--s-4); }
    .track { flex: 1; height: 8px; background: var(--c-surface-2); border-radius: var(--r-pill); overflow: hidden; }
    .fill { height: 100%; background: linear-gradient(90deg, var(--c-ok), #34d399); border-radius: var(--r-pill); }
    .ack-bar .num { font-size: var(--fs-sm); color: var(--c-text); font-weight: 600; font-variant-numeric: tabular-nums; min-width: 40px; }

    .hold-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
    .hold-list li {
      padding: var(--s-3); background: var(--c-surface-1);
      border: 1px solid var(--c-border); border-radius: var(--r-md);
      border-left: 3px solid var(--c-warn);
    }
    .hold-list header { display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-2); }
    .hold-list code { font-family: ui-monospace, monospace; font-size: var(--fs-xs); color: var(--c-text-mute); }
    .hold-list p { margin: 0; font-size: var(--fs-sm); color: var(--c-text-2); line-height: 1.45; }
    .hold-list .meta { color: var(--c-text-faint); font-size: var(--fs-xs); margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; }

    .empty { padding: var(--s-4); text-align: center; color: var(--c-text-faint); font-size: var(--fs-sm); margin: 0; }

    .tag-bars { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
    .tag-bars li { display: grid; grid-template-columns: 130px 1fr 32px; align-items: center; gap: var(--s-3); }
    .tag-bars .bar { height: 6px; background: var(--c-surface-2); border-radius: var(--r-pill); overflow: hidden; }
    .tag-bars .bar .fill { height: 100%; background: var(--c-brand); border-radius: var(--r-pill); }
    .tag-bars .num { font-size: var(--fs-xs); color: var(--c-text-2); text-align: right; font-variant-numeric: tabular-nums; }

    .feed { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); position: relative; }
    .feed::before {
      content: ''; position: absolute; left: 5px; top: 4px; bottom: 4px;
      width: 2px; background: var(--c-divider);
    }
    .feed li { display: flex; gap: var(--s-3); position: relative; }
    .feed .dot {
      width: 12px; height: 12px; border-radius: 999px;
      background: var(--c-surface-2); border: 2px solid var(--c-text-faint);
      flex-shrink: 0; margin-top: 4px; position: relative; z-index: 1;
    }
    .feed .dot[data-action="hold"]      { background: var(--c-warn-soft); border-color: var(--c-warn); }
    .feed .dot[data-action="custodian"] { background: var(--c-info-soft); border-color: var(--c-info); }
    .feed .dot[data-action="document"]  { background: var(--c-brand-tint); border-color: var(--c-brand); }
    .feed .dot[data-action="privilege"] { background: var(--c-bad-soft); border-color: var(--c-bad); }
    .feed .content p { margin: 0; font-size: var(--fs-sm); color: var(--c-text); }
    .feed .content code { font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--c-text-mute); margin-left: 4px; }
    .feed .meta { color: var(--c-text-faint); font-size: var(--fs-xs); margin-top: 2px; }
  `,
})
export class MatterDashboardComponent {
  private readonly store = inject(MatterStore);
  protected readonly matterStatus = 'Active';
  protected readonly bates = 'ACME-0000001 to ACME-9999999';

  protected readonly custodians = this.store.custodians;
  protected readonly legalHolds = this.store.legalHolds;

  protected readonly custodianCount = computed(() => this.custodians().length);
  protected readonly custodiansOnHold = computed(() => this.custodians().filter((c) => c.hasLegalHold).length);
  protected readonly collectionsComplete = computed(() => this.custodians().filter((c) => c.collectionStatus === 'complete').length);
  protected readonly documentCount = computed(() => listDocuments(environment.matterId).length);
  protected readonly reviewedCount = computed(() => listDocuments(environment.matterId).filter((d) => d.tags.length > 0).length);
  protected readonly auditCount = computed(() => listAuditEvents(environment.matterId, 1000).length);

  protected readonly activeHoldCount = computed(() => this.legalHolds().filter((h) => !h.releasedAt).length);
  protected readonly holdAcknowledgedCount = computed(() => this.legalHolds().filter((h) => h.acknowledgedAt && !h.releasedAt).length);
  protected readonly holdPendingCount = computed(() => this.legalHolds().filter((h) => !h.acknowledgedAt && !h.releasedAt).length);
  protected readonly ackPct = computed(() => {
    const active = this.activeHoldCount();
    return active === 0 ? 0 : Math.round((this.holdAcknowledgedCount() / active) * 100);
  });

  protected readonly tagBreakdown = computed(() => {
    const docs = listDocuments(environment.matterId);
    const counts = new Map<string, number>();
    for (const d of docs) for (const t of d.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    const total = docs.length;
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count, pct: total === 0 ? 0 : Math.round((count / total) * 100) }));
  });

  protected readonly recentEvents = computed(() =>
    listAuditEvents(environment.matterId, 8).slice().reverse(),
  );

  protected initials(name: string): string {
    return name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  }
  protected avatarTone(id: string): string {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return String(h % 5);
  }
  protected collectionTone(s: string): StatusTone {
    if (s === 'complete') return 'ok';
    if (s === 'in-progress') return 'info';
    return 'warn';
  }
  protected actionFamily(action: string): string {
    if (action.startsWith('hold')) return 'hold';
    if (action.startsWith('custodian')) return 'custodian';
    if (action.includes('priv')) return 'privilege';
    if (action.startsWith('document') || action.startsWith('privilege')) return 'document';
    return '';
  }
  protected formatAction(action: string): string {
    return action.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  protected shortDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
