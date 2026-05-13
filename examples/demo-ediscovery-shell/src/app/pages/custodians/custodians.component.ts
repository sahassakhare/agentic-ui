import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AssistPanelComponent, type AssistAction } from '@infra-tools/agentic-ui';
import { listAuditEvents, listDocuments, listLegalHolds } from '@infra-tools/demo-ediscovery-shared';
import { environment } from '../../../environments/environment';
import { CUSTODIAN_CONTEXT_INTENT_IDS } from '../../agentic/post-chat-surfaces';
import { MatterStore } from '../../services/matter.store';
import { IconComponent } from '../../ui/icon.component';
import { TagChipComponent } from '../../ui/tag-chip.component';
import { StatusBadgeComponent, type StatusTone } from '../../ui/status-badge.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';

/**
 * Custodians page. Master list with a drill-in detail view: pick a
 * custodian to see their documents, holds, and recent audit activity.
 */
@Component({
  selector: 'app-custodians',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, IconComponent, TagChipComponent, StatusBadgeComponent, EmptyStateComponent, AssistPanelComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">People</p>
        <h1>Custodians</h1>
        <p class="muted">{{ list().length }} on this matter — {{ onHoldCount() }} under legal hold, {{ completedCount() }} collections complete.</p>
      </div>
    </section>

    <!-- "Just-created" confirmation banner. Lands when the intake
         form's submit handler navigates here with ?created=1 -->
    @if (justCreated()) {
      <div class="created-banner" role="status">
        <span class="dot" aria-hidden="true">✓</span>
        <div>
          <strong>Custodian created.</strong>
          @if (active(); as id) {
            <span class="dim"> · id <code>{{ id }}</code> — highlighted below.</span>
          }
        </div>
        <button type="button" class="dismiss" (click)="dismissBanner()" aria-label="Dismiss">×</button>
      </div>
    }

    @if (list().length === 0) {
      <mvk-empty-state title="No custodians yet" icon="users"
        message="Use the coordinator to onboard the first custodian."
        hint="Add Sarah Chen from Engineering as a custodian on this matter" />
    } @else {
      <div class="layout">
        <aside class="list">
          @for (c of list(); track c.id) {
            <button type="button" class="row" [class.active]="active() === c.id" (click)="select(c.id)">
              <span class="avatar" [attr.data-tone]="tone(c.id)">{{ initials(c.name) }}</span>
              <div class="meta">
                <strong>{{ c.name }}</strong>
                <span>{{ c.department }} · {{ c.email }}</span>
              </div>
              <div class="badges">
                @if (c.hasLegalHold) { <mvk-status-badge tone="warn">hold</mvk-status-badge> }
                <mvk-status-badge [tone]="collectionTone(c.collectionStatus)">{{ c.collectionStatus }}</mvk-status-badge>
              </div>
            </button>
          }
        </aside>

        <section class="detail">
          @if (selected(); as c) {
            <header class="d-head">
              <span class="avatar lg" [attr.data-tone]="tone(c.id)">{{ initials(c.name) }}</span>
              <div>
                <h2>{{ c.name }}</h2>
                <p class="d-meta">
                  {{ c.department }} · <a href="mailto:{{ c.email }}">{{ c.email }}</a>
                  · ID <code>{{ c.id }}</code>
                </p>
                <div class="d-badges">
                  @if (c.hasLegalHold) { <mvk-status-badge tone="warn">legal hold active</mvk-status-badge> }
                  <mvk-status-badge [tone]="collectionTone(c.collectionStatus)">collection {{ c.collectionStatus }}</mvk-status-badge>
                </div>
              </div>
            </header>

            <div class="kpis">
              <div class="kpi">
                <span class="lbl">Total documents</span>
                <strong>{{ totalDocs() | number }}</strong>
              </div>
              <div class="kpi">
                <span class="lbl">Tagged</span>
                <strong>{{ taggedCount() | number }}</strong>
              </div>
              <div class="kpi">
                <span class="lbl">Privileged</span>
                <strong>{{ privCount() | number }}</strong>
              </div>
              <div class="kpi">
                <span class="lbl">Hot / responsive</span>
                <strong>{{ hotCount() }} / {{ respCount() }}</strong>
              </div>
            </div>

            <!-- Post-chat surfaces P1 (pattern 6 — "next best action"
                 sidebar / Cursor pattern). Renders persona-filtered
                 intents for the active custodian. (intentSelected)
                 dispatches the mapsTo target through Router / Tool /
                 Action registries; the demo logs for visibility. -->
            <section class="block assist-block">
              <header class="b-head">
                <h3>Suggested for {{ c.name.split(' ')[0] }}</h3>
              </header>
              <mvk-assist-panel
                context="custodian"
                [intents]="custodianIntentIds"
                [filterContext]="c"
                [focusedItem]="c"
                [focusLabel]="c.name"
                askPlaceholder="Ask about this custodian…"
                (intentSelected)="onAssistIntent($event)"
                (ask)="onAssistAsk($event)" />
            </section>

            <section class="block">
              <header class="b-head">
                <h3>Holds covering {{ c.name.split(' ')[0] }}</h3>
              </header>
              @if (holdsForCustodian().length === 0) {
                <p class="empty">No holds cover this custodian.</p>
              } @else {
                <ul class="hold-list">
                  @for (h of holdsForCustodian(); track h.id) {
                    <li>
                      <header><code>{{ h.id }}</code>
                        @if (h.releasedAt) { <mvk-status-badge tone="neutral">released</mvk-status-badge> }
                        @else if (h.acknowledgedAt) { <mvk-status-badge tone="ok">acknowledged</mvk-status-badge> }
                        @else { <mvk-status-badge tone="warn">pending ack</mvk-status-badge> }
                      </header>
                      <p>{{ h.scope }}</p>
                      <p class="meta">issued {{ shortDate(h.issuedAt) }} · {{ h.custodianIds.length }} custodian(s) total</p>
                    </li>
                  }
                </ul>
              }
            </section>

            <section class="block">
              <header class="b-head">
                <h3>Documents</h3>
                <span class="cnt">{{ docs().length }}</span>
              </header>
              @if (docs().length === 0) {
                <p class="empty">No documents collected yet for this custodian.</p>
              } @else {
                <table>
                  <thead><tr><th>File</th><th>Authored</th><th class="num">Size</th><th>Tags</th></tr></thead>
                  <tbody>
                    @for (d of docs(); track d.id) {
                      <tr>
                        <td>
                          <span class="ext">.{{ ext(d.fileName) }}</span>
                          <strong>{{ d.fileName }}</strong>
                        </td>
                        <td>{{ shortDate(d.authoredAt) }}</td>
                        <td class="num">{{ kb(d.fileSize) }}</td>
                        <td>
                          <div class="tags">
                            @if (d.tags.length === 0) { <span class="muted">—</span> }
                            @for (t of d.tags; track t) { <mvk-tag-chip [tag]="t" /> }
                          </div>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </section>

            <section class="block">
              <header class="b-head"><h3>Recent activity</h3></header>
              @if (events().length === 0) {
                <p class="empty">No activity recorded for this custodian.</p>
              } @else {
                <ol class="feed">
                  @for (e of events(); track e.id) {
                    <li>
                      <span class="dot"></span>
                      <div>
                        <p><strong>{{ formatAction(e.action) }}</strong> <code>{{ e.target.id }}</code></p>
                        <p class="meta">{{ e.actor }} · {{ shortDate(e.timestamp) }}</p>
                      </div>
                    </li>
                  }
                </ol>
              }
            </section>
          } @else {
            <div class="placeholder">
              <svg-icon name="users" [size]="32" />
              <h2>Select a custodian</h2>
              <p>Pick someone from the list to inspect their documents, holds, and chain-of-custody activity.</p>
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

    .layout { display: grid; grid-template-columns: 320px 1fr; gap: var(--s-4); }
    @media (max-width: 1024px) { .layout { grid-template-columns: 1fr; } }

    .list {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); padding: var(--s-2);
      display: flex; flex-direction: column; gap: 2px;
      max-height: calc(100vh - 200px); overflow-y: auto;
    }
    .row {
      width: 100%; text-align: left;
      display: grid; grid-template-columns: auto 1fr auto; gap: var(--s-3);
      align-items: center;
      padding: var(--s-3);
      background: transparent; border: 1px solid transparent; border-radius: var(--r-md);
      cursor: pointer; transition: background var(--t-fast);
    }
    .row:hover { background: var(--c-surface-2); }
    .row.active {
      background: var(--c-brand-tint); border-color: var(--c-brand-soft);
    }
    .row .meta strong { display: block; color: var(--c-text); font-size: var(--fs-sm); font-weight: 600; }
    .row .meta span { display: block; color: var(--c-text-mute); font-size: 0.7rem; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badges { display: flex; flex-direction: column; gap: 3px; align-items: flex-end; }

    .avatar {
      width: 34px; height: 34px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-2); color: var(--c-text-2);
      border-radius: var(--r-pill);
      font-size: 0.78rem; font-weight: 600;
    }
    .avatar.lg { width: 56px; height: 56px; font-size: 1.1rem; }
    .avatar[data-tone="0"] { background: #e0e7ff; color: #3730a3; }
    .avatar[data-tone="1"] { background: #fce7f3; color: #9f1239; }
    .avatar[data-tone="2"] { background: #d1fae5; color: #065f46; }
    .avatar[data-tone="3"] { background: #fef3c7; color: #92400e; }
    .avatar[data-tone="4"] { background: #dbeafe; color: #1e40af; }

    .detail {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); box-shadow: var(--sh-1);
      min-height: 480px;
    }
    .placeholder {
      padding: var(--s-12) var(--s-6);
      text-align: center; color: var(--c-text-faint);
    }
    .placeholder svg-icon { color: var(--c-text-faint); margin-bottom: var(--s-3); }
    .placeholder h2 { margin: 0 0 var(--s-2); color: var(--c-text-2); font-size: var(--fs-md); font-weight: 600; }
    .placeholder p { margin: 0; font-size: var(--fs-sm); max-width: 380px; margin-inline: auto; }

    .d-head {
      display: flex; align-items: center; gap: var(--s-4);
      padding: var(--s-5);
      border-bottom: 1px solid var(--c-divider);
    }
    .d-head h2 { margin: 0; font-size: var(--fs-xl); font-weight: 600; }
    .d-meta { margin: 0.2rem 0 0.4rem; color: var(--c-text-mute); font-size: var(--fs-sm); }
    .d-meta a { color: var(--c-brand); }
    .d-meta code { font-family: ui-monospace, monospace; font-size: 0.78rem; }
    .d-badges { display: flex; gap: 4px; flex-wrap: wrap; }

    .kpis {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3);
      padding: var(--s-4) var(--s-5);
      border-bottom: 1px solid var(--c-divider);
      background: var(--c-surface-1);
    }
    @media (max-width: 720px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
    .kpi { display: flex; flex-direction: column; gap: 2px; }
    .kpi .lbl { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); font-weight: 600; }
    .kpi strong { font-size: var(--fs-lg); color: var(--c-text); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }

    .block { padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--c-divider); }
    .block:last-child { border-bottom: 0; }
    .b-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: var(--s-3); }
    .block h3 { margin: 0; font-size: var(--fs-md); color: var(--c-text); font-weight: 600; }
    .cnt {
      padding: 1px 8px;
      background: var(--c-surface-2); color: var(--c-text-2);
      border-radius: var(--r-pill); font-size: var(--fs-xs); font-weight: 600;
    }

    .hold-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
    .hold-list li {
      padding: var(--s-3);
      background: var(--c-surface-1); border: 1px solid var(--c-border); border-radius: var(--r-md);
      border-left: 3px solid var(--c-warn);
    }
    .hold-list header { display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-2); }
    .hold-list code { font-family: ui-monospace, monospace; font-size: var(--fs-xs); color: var(--c-text-mute); }
    .hold-list p { margin: 0; font-size: var(--fs-sm); color: var(--c-text-2); line-height: 1.4; }
    .hold-list .meta { color: var(--c-text-faint); font-size: var(--fs-xs); margin-top: 4px; }

    table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    th, td { padding: 0.55rem 0.7rem; text-align: left; border-bottom: 1px solid var(--c-divider); }
    th { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-text-mute); font-weight: 500; }
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td strong { color: var(--c-text); font-weight: 500; margin-left: 6px; }
    .ext {
      padding: 1px 5px;
      background: var(--c-surface-2); color: var(--c-text-2);
      border-radius: var(--r-sm);
      font-family: ui-monospace, monospace; font-size: 0.62rem; font-weight: 600; text-transform: uppercase;
    }
    .tags { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }

    .feed { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
    .feed li { display: flex; gap: var(--s-3); }
    .feed .dot {
      width: 8px; height: 8px; border-radius: 999px;
      background: var(--c-brand); flex-shrink: 0; margin-top: 6px;
    }
    .feed p { margin: 0; font-size: var(--fs-sm); }
    .feed code { font-family: ui-monospace, monospace; font-size: 0.74rem; color: var(--c-text-mute); margin-left: 4px; }
    .feed .meta { color: var(--c-text-faint); font-size: var(--fs-xs); margin-top: 2px; }

    .empty { color: var(--c-text-faint); font-size: var(--fs-sm); margin: 0; }
    .muted { color: var(--c-text-faint); }

    .created-banner {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.625rem 0.875rem;
      background: #ecfdf5; color: #065f46;
      border: 1px solid #a7f3d0; border-radius: 0.5rem;
      margin-bottom: var(--s-4);
      animation: slide-in 200ms ease-out;
    }
    .created-banner .dot {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 999px; background: #10b981; color: white; font-weight: 700;
      flex-shrink: 0;
    }
    .created-banner .dim { color: var(--c-text-faint); }
    .created-banner code { font-family: ui-monospace, monospace; font-size: 0.78rem; }
    .created-banner .dismiss {
      margin-left: auto;
      background: transparent; border: none; cursor: pointer;
      font-size: 1.25rem; line-height: 1; color: #065f46;
    }
    @keyframes slide-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `,
})
export class CustodiansComponent {
  protected readonly matterId = environment.matterId;
  private readonly store = inject(MatterStore);

  protected readonly list = this.store.custodians;
  protected readonly active = signal<string | null>(null);

  /** Intent allow-list for the per-custodian `<mvk-assist-panel>`. */
  protected readonly custodianIntentIds = CUSTODIAN_CONTEXT_INTENT_IDS;

  /** Assist-panel intent click → dispatch the mapsTo target. */
  protected onAssistIntent(ev: AssistAction): void {
    console.info('[custodians] assist intent:', ev.intentId, 'mapsTo', ev.mapsTo);
    // Production: dispatch through Router (kind:'route') /
    // ActionRegistry (kind:'action') / ToolRegistry (kind:'tool').
  }

  /** Assist-panel free-text ask → forward to chat. */
  protected onAssistAsk(text: string): void {
    console.info('[custodians] assist ask:', text);
    // Production: send to ChatShell via injectAgenticChat().sendMessage().
  }

  /** Sync `?id=…` from the URL into the active selection so the
      `openCustodian` action and direct deep-links both work.
      `?created=1` flips a one-shot banner the form-submit path uses
      to confirm a new custodian landed. */
  private readonly route = inject(ActivatedRoute);
  private readonly idParam = toSignal(this.route.queryParamMap, { initialValue: null });
  protected readonly justCreated = signal(false);
  private readonly _syncFromQuery = effect(() => {
    const params = this.idParam();
    const id = params?.get('id');
    if (id) this.active.set(id);
    // Auto-dismiss the banner ~6s after the navigation lands.
    if (params?.get('created') === '1') {
      this.justCreated.set(true);
      setTimeout(() => this.justCreated.set(false), 6000);
    }
  });

  protected dismissBanner(): void {
    this.justCreated.set(false);
  }

  protected readonly selected = computed(() => {
    const id = this.active();
    return id ? this.list().find((c) => c.id === id) : undefined;
  });

  protected readonly onHoldCount = computed(() => this.list().filter((c) => c.hasLegalHold).length);
  protected readonly completedCount = computed(() => this.list().filter((c) => c.collectionStatus === 'complete').length);

  protected readonly docs = computed(() => {
    const id = this.active();
    return id ? listDocuments(this.matterId).filter((d) => d.custodianId === id) : [];
  });
  protected readonly totalDocs = computed(() => this.docs().length);
  protected readonly taggedCount = computed(() => this.docs().filter((d) => d.tags.length > 0).length);
  protected readonly privCount = computed(() => this.docs().filter((d) => d.tags.includes('privileged')).length);
  protected readonly hotCount = computed(() => this.docs().filter((d) => d.tags.includes('hot')).length);
  protected readonly respCount = computed(() => this.docs().filter((d) => d.tags.includes('responsive')).length);

  protected readonly holdsForCustodian = computed(() => {
    const id = this.active();
    return id ? listLegalHolds(this.matterId).filter((h) => h.custodianIds.includes(id)) : [];
  });

  protected readonly events = computed(() => {
    const id = this.active();
    if (!id) return [];
    return listAuditEvents(this.matterId, 1000)
      .filter((e) => e.target.id === id || (e.target.type === 'document' && this.docs().some((d) => d.id === e.target.id)))
      .slice(-12).reverse();
  });

  select(id: string): void { this.active.set(id); }

  initials(name: string): string {
    return (name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2) || '?').toUpperCase();
  }
  tone(id: string): string {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return String(h % 5);
  }
  collectionTone(s: string): StatusTone {
    if (s === 'complete') return 'ok';
    if (s === 'in-progress') return 'info';
    return 'warn';
  }
  ext(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? 'file' : name.slice(dot + 1);
  }
  kb(b: number): string {
    if (b < 1024) return b + ' B';
    if (b < 1_048_576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1_048_576).toFixed(1) + ' MB';
  }
  shortDate(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  formatAction(action: string): string {
    return action.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
