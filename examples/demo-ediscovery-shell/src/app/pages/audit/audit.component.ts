import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { listAuditEvents, verifyAuditChain, type AuditEvent } from '@maverick/demo-ediscovery-shared';
import { environment } from '../../../environments/environment';
import { MatterStore } from '../../services/matter.store';
import { IconComponent } from '../../ui/icon.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';

type ActionFamily = 'all' | 'matter' | 'custodian' | 'hold' | 'document' | 'privilege';

const FAMILY_LABELS: Record<ActionFamily, string> = {
  all: 'All events',
  matter: 'Matter',
  custodian: 'Custodians',
  hold: 'Legal holds',
  document: 'Documents',
  privilege: 'Privilege',
};

/**
 * Audit Trail page. Live tail of `listAuditEvents` with action-family
 * filtering and a JSON-diff viewer for the per-event before/after state.
 *
 * @remarks
 * Phase 5 productionises this — adds tamper-evident hashing, exports a
 * chain-of-custody report, and routes the feed through a real append-only
 * store. The demo's mock implementation gives the page enough surface
 * for the UX to land at the same shape now.
 */
@Component({
  selector: 'app-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, EmptyStateComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Compliance</p>
        <h1>Audit trail</h1>
        <p class="muted">Chain-of-custody log — every tool call, tag, hold change, and persona action lands here. Each entry stamps a tamper-evident chain hash; integrity is verified live below.</p>
      </div>
      <div class="head-actions">
        <span class="counter">{{ filtered().length }} / {{ all().length }} events</span>
      </div>
    </section>

    <section class="integrity" [attr.data-state]="chain().broken.length === 0 && chain().chained > 0 ? 'verified' : (chain().chained === 0 ? 'empty' : 'broken')">
      <div class="badge">
        @if (chain().broken.length === 0 && chain().chained > 0) {
          <svg-icon name="check" [size]="16" />
          <strong>Chain verified</strong>
          <span>{{ chain().verified }} of {{ chain().chained }} hashes recompute</span>
        } @else if (chain().chained === 0) {
          <svg-icon name="alert-triangle" [size]="16" />
          <strong>No chain yet</strong>
          <span>Run a tool call to start the chain</span>
        } @else {
          <svg-icon name="alert-triangle" [size]="16" />
          <strong>Chain integrity broken</strong>
          <span>{{ chain().broken.length }} mismatch(es) — investigate before delivery</span>
        }
      </div>
      <div class="head">
        <span class="lbl">Chain head</span>
        <code>{{ chain().head ?? '—' }}</code>
      </div>
    </section>

    <section class="filters">
      <div class="filter-group">
        <span class="filter-label">Family</span>
        <div class="pills">
          @for (f of families; track f) {
            <button type="button" class="chip" [class.on]="family() === f" (click)="family.set(f)">
              {{ familyLabel(f) }}
              <span class="cnt">{{ countFor(f) }}</span>
            </button>
          }
        </div>
      </div>
    </section>

    @if (filtered().length === 0) {
      <mvk-empty-state title="No events yet" icon="audit"
        message="Run a tool call from the coordinator to see the audit trail populate."
        hint="Add Sarah Chen as a custodian on this matter" />
    } @else {
      <ol class="trail">
        @for (e of filtered(); track e.id) {
          <li>
            <div class="time">
              <span class="day">{{ shortDay(e.timestamp) }}</span>
              <span class="hour">{{ shortTime(e.timestamp) }}</span>
            </div>
            <div class="rail-dot" [attr.data-family]="familyOf(e.action)">
              <svg-icon [name]="iconFor(e.action)" [size]="12" />
            </div>
            <article class="card">
              <header>
                <span class="action">{{ formatAction(e.action) }}</span>
                <code>{{ e.target.type }}/{{ e.target.id }}</code>
              </header>
              <p class="actor"><strong>{{ e.actor }}</strong></p>
              @if (e.reason) {
                <p class="reason"><svg-icon name="message" [size]="11" /> {{ e.reason }}</p>
              }
              @if (e.before || e.after) {
                <details>
                  <summary>State diff</summary>
                  <div class="diff">
                    @if (e.before) {
                      <div class="col">
                        <span class="lbl">Before</span>
                        <pre>{{ json(e.before) }}</pre>
                      </div>
                    }
                    @if (e.after) {
                      <div class="col">
                        <span class="lbl">After</span>
                        <pre>{{ json(e.after) }}</pre>
                      </div>
                    }
                  </div>
                </details>
              }
            </article>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    :host { display: block; max-width: 1100px; margin: 0 auto; }
    .page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--s-4); margin-bottom: var(--s-5); }
    .crumb { margin: 0; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--c-brand); font-weight: 600; }
    h1 { margin: 0.2rem 0 0.3rem; font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -0.02em; }
    .muted { color: var(--c-text-mute); margin: 0; font-size: var(--fs-sm); max-width: 580px; }
    .counter { font-size: var(--fs-xs); color: var(--c-text-mute); font-variant-numeric: tabular-nums; }

    .integrity {
      display: flex; align-items: center; justify-content: space-between;
      gap: var(--s-3); padding: var(--s-3) var(--s-4);
      background: var(--c-surface-0);
      border: 1px solid var(--c-border);
      border-left: 4px solid var(--c-ok);
      border-radius: var(--r-md);
      margin-bottom: var(--s-3);
    }
    .integrity[data-state="broken"] { border-left-color: var(--c-bad); background: var(--c-bad-soft); }
    .integrity[data-state="empty"]  { border-left-color: var(--c-text-faint); }
    .integrity .badge { display: inline-flex; align-items: center; gap: var(--s-2); }
    .integrity .badge svg-icon { color: var(--c-ok); }
    .integrity[data-state="broken"] .badge svg-icon { color: var(--c-bad); }
    .integrity[data-state="empty"]  .badge svg-icon { color: var(--c-text-faint); }
    .integrity .badge strong { color: var(--c-text); font-size: var(--fs-sm); }
    .integrity .badge span { color: var(--c-text-mute); font-size: var(--fs-xs); }
    .integrity .head { display: flex; align-items: baseline; gap: 0.4rem; }
    .integrity .head .lbl { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); font-weight: 600; }
    .integrity .head code { font-family: ui-monospace, monospace; font-size: 0.8rem; color: var(--c-text); padding: 1px 6px; background: var(--c-surface-2); border-radius: 3px; }

    .filters {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); padding: var(--s-4);
      margin-bottom: var(--s-4);
    }
    .filter-group { display: flex; align-items: center; gap: var(--s-3); }
    .filter-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); font-weight: 600; min-width: 60px; }
    .pills { display: flex; gap: 4px; flex-wrap: wrap; }
    .chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px;
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-pill); font-size: var(--fs-xs); color: var(--c-text-2);
      cursor: pointer; transition: all var(--t-fast);
    }
    .chip:hover { background: var(--c-surface-2); }
    .chip.on { background: var(--c-brand); border-color: var(--c-brand); color: white; }
    .chip .cnt {
      padding: 0 6px; min-width: 16px; height: 16px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-2); color: var(--c-text-2);
      border-radius: var(--r-pill); font-size: 0.6rem; font-weight: 600;
    }
    .chip.on .cnt { background: rgba(255,255,255,0.25); color: white; }

    .trail {
      list-style: none; margin: 0; padding: 0;
      display: grid; gap: var(--s-3);
      position: relative;
    }
    .trail::before {
      content: ''; position: absolute;
      left: 92px; top: 4px; bottom: 4px; width: 2px;
      background: var(--c-divider);
    }
    .trail li { display: grid; grid-template-columns: 80px 24px 1fr; gap: var(--s-3); align-items: flex-start; position: relative; }

    .time { text-align: right; padding-top: 6px; }
    .time .day { display: block; font-size: var(--fs-xs); color: var(--c-text); font-weight: 600; }
    .time .hour { display: block; font-size: 0.65rem; color: var(--c-text-mute); font-variant-numeric: tabular-nums; }

    .rail-dot {
      width: 24px; height: 24px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-0); border: 2px solid var(--c-text-faint);
      border-radius: var(--r-pill); color: var(--c-text-faint);
      position: relative; z-index: 1; margin-top: 6px;
    }
    .rail-dot[data-family="hold"]      { background: var(--c-warn-soft); border-color: var(--c-warn); color: var(--c-warn); }
    .rail-dot[data-family="custodian"] { background: var(--c-info-soft); border-color: var(--c-info); color: var(--c-info); }
    .rail-dot[data-family="document"]  { background: var(--c-brand-tint); border-color: var(--c-brand); color: var(--c-brand-strong); }
    .rail-dot[data-family="privilege"] { background: var(--c-bad-soft); border-color: var(--c-bad); color: var(--c-bad); }
    .rail-dot[data-family="matter"]    { background: var(--c-ok-soft); border-color: var(--c-ok); color: var(--c-ok); }

    .card {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-md); padding: var(--s-3) var(--s-4);
      box-shadow: var(--sh-1);
    }
    .card header { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; margin-bottom: 4px; }
    .action { font-size: var(--fs-sm); color: var(--c-text); font-weight: 600; }
    .card code { font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--c-text-mute); background: var(--c-surface-1); padding: 1px 6px; border-radius: var(--r-sm); }
    .actor { margin: 0; color: var(--c-text-2); font-size: var(--fs-xs); }
    .actor strong { color: var(--c-text); }
    .reason {
      margin: var(--s-2) 0 0; padding: var(--s-2) var(--s-3);
      background: var(--c-surface-1); border-left: 2px solid var(--c-brand);
      border-radius: var(--r-sm);
      font-size: var(--fs-xs); color: var(--c-text-2);
      display: inline-flex; align-items: flex-start; gap: 6px;
    }

    details { margin-top: var(--s-2); }
    summary {
      cursor: pointer; font-size: 0.7rem; color: var(--c-brand);
      padding: 3px 0; user-select: none;
    }
    summary:hover { color: var(--c-brand-strong); }
    .diff { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); margin-top: var(--s-2); }
    @media (max-width: 720px) { .diff { grid-template-columns: 1fr; } }
    .col .lbl { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); font-weight: 600; }
    .col pre {
      margin: 4px 0 0;
      padding: var(--s-2);
      background: var(--c-surface-1); border-radius: var(--r-sm);
      font: inherit; font-family: ui-monospace, monospace; font-size: 0.7rem;
      white-space: pre-wrap; word-break: break-word;
      color: var(--c-text-2); max-height: 160px; overflow: auto;
    }
  `,
})
export class AuditComponent {
  protected readonly matterId = environment.matterId;
  /** Subscribe to MatterStore so the page rerenders when tools mutate state. */
  private readonly store = inject(MatterStore);
  protected readonly families: readonly ActionFamily[] = ['all', 'custodian', 'hold', 'document', 'privilege', 'matter'];
  protected readonly family = signal<ActionFamily>('all');

  /** Read directly from MatterStore's signal-backed audit log so
   *  the page re-renders the instant a mutation appends an event,
   *  without polling and without losing rows on page refresh
   *  (MatterStore now persists to localStorage). */
  protected readonly all = computed(() =>
    this.store.auditLog().slice().reverse(),
  );

  /** Chain verification — recomputes when the audit log mutates.
   *  Reads from the shared module which has the same events
   *  rehydrated from localStorage on init, so chainHash links
   *  survive the refresh. */
  protected readonly chain = computed(() => {
    // Touch the audit log so this recomputes when events append.
    this.store.auditLog();
    return verifyAuditChain(this.matterId);
  });

  protected readonly filtered = computed(() => {
    const f = this.family();
    if (f === 'all') return this.all();
    return this.all().filter((e) => this.familyOf(e.action) === f);
  });

  countFor(f: ActionFamily): number {
    if (f === 'all') return this.all().length;
    return this.all().filter((e) => this.familyOf(e.action) === f).length;
  }

  familyLabel(f: ActionFamily): string { return FAMILY_LABELS[f]; }

  familyOf(action: string): ActionFamily {
    if (action.startsWith('hold')) return 'hold';
    if (action.startsWith('custodian')) return 'custodian';
    if (action.includes('priv')) return 'privilege';
    if (action.startsWith('document')) return 'document';
    if (action.startsWith('matter')) return 'matter';
    return 'matter';
  }

  iconFor(action: string): 'shield' | 'users' | 'documents' | 'lock' | 'audit' {
    const f = this.familyOf(action);
    switch (f) {
      case 'hold': return 'shield';
      case 'custodian': return 'users';
      case 'document': return 'documents';
      case 'privilege': return 'lock';
      default: return 'audit';
    }
  }

  formatAction(action: string): string {
    return action.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  shortDay(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  shortTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(11, 16);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  json(v: unknown): string {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }
}
