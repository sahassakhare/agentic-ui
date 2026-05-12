import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChildren, type ElementRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { listCustodians } from '@infra-tools/demo-ediscovery-shared';
import { environment } from '../../../environments/environment';
import { MatterStore } from '../../services/matter.store';
import { IconComponent } from '../../ui/icon.component';
import { StatusBadgeComponent } from '../../ui/status-badge.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { AgenticSlotComponent } from '../../ui/agentic-slot.component';

/**
 * Legal holds page. Each hold renders as an expanded card with the
 * full scope, custodian list, and lifecycle timeline (issued ➝
 * acknowledged ➝ released).
 */
@Component({
  selector: 'app-holds',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, StatusBadgeComponent, EmptyStateComponent, AgenticSlotComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Compliance</p>
        <h1>Legal holds</h1>
        <p class="muted">{{ active().length }} active · {{ pending().length }} pending acknowledgement · {{ released().length }} released</p>
      </div>
    </section>

    <!-- Render-target slot (plan R1). Tool handlers like placeLegalHoldTool
         publish their result widget here when they want it to mount on this
         page rather than inline in the chat panel. Empty when nothing is
         pending. -->
    <mvk-agentic-slot name="holds.primary" />

    <!-- "Just-created" confirmation banner. Lands when a workflow's
         onComplete or the placeLegalHold tool navigates here with
         ?created=1. Auto-dismisses after 6s. -->
    @if (justCreated()) {
      <div class="created-banner" role="status">
        <span class="dot" aria-hidden="true">✓</span>
        <div>
          <strong>Legal hold issued.</strong>
          @if (focusedId(); as id) {
            <span class="dim"> · id <code>{{ id }}</code> — highlighted below.</span>
          }
        </div>
        <button type="button" class="dismiss" (click)="dismissBanner()" aria-label="Dismiss">×</button>
      </div>
    }

    <div class="kpis">
      <div class="kpi" data-tone="warn">
        <span class="lbl">Active</span>
        <strong>{{ active().length }}</strong>
        <span class="sub">covering {{ uniqueCustodianCount() }} custodian(s)</span>
      </div>
      <div class="kpi" data-tone="bad">
        <span class="lbl">Pending ack</span>
        <strong>{{ pending().length }}</strong>
        <span class="sub">{{ pending().length === 0 ? 'all caught up' : 'follow-up required' }}</span>
      </div>
      <div class="kpi" data-tone="ok">
        <span class="lbl">Acknowledged</span>
        <strong>{{ acknowledged().length }}</strong>
        <span class="sub">received custodian sign-off</span>
      </div>
      <div class="kpi" data-tone="neutral">
        <span class="lbl">Released</span>
        <strong>{{ released().length }}</strong>
        <span class="sub">closed with audit reason</span>
      </div>
    </div>

    @if (holds().length === 0) {
      <mvk-empty-state title="No legal holds" icon="shield"
        message="Issue the first hold once you have custodians on the matter."
        hint="Place a legal hold on Sarah covering Project Phoenix" />
    } @else {
      <div class="grid">
        @for (hold of holds(); track hold.id) {
          <article class="hold" [attr.data-state]="state(hold)" [attr.data-id]="hold.id" [class.focused]="focusedId() === hold.id" #holdCard>
            <header>
              <div class="title">
                <code>{{ hold.id }}</code>
                @if (hold.releasedAt) { <mvk-status-badge tone="neutral">released</mvk-status-badge> }
                @else if (hold.acknowledgedAt) { <mvk-status-badge tone="ok">acknowledged</mvk-status-badge> }
                @else { <mvk-status-badge tone="warn">pending ack</mvk-status-badge> }
              </div>
              <span class="size">{{ hold.custodianIds.length }} custodian(s)</span>
            </header>

            <p class="scope">{{ hold.scope }}</p>

            <div class="timeline">
              <div class="step" data-done="true">
                <span class="dot"><svg-icon name="check" [size]="11" /></span>
                <div>
                  <strong>Issued</strong>
                  <span>{{ longDate(hold.issuedAt) }}</span>
                </div>
              </div>
              <div class="step" [attr.data-done]="hold.acknowledgedAt ? 'true' : 'false'">
                <span class="dot">
                  @if (hold.acknowledgedAt) { <svg-icon name="check" [size]="11" /> }
                </span>
                <div>
                  <strong>Acknowledged</strong>
                  <span>{{ hold.acknowledgedAt ? longDate(hold.acknowledgedAt) : 'awaiting custodian sign-off' }}</span>
                </div>
              </div>
              <div class="step" [attr.data-done]="hold.releasedAt ? 'true' : 'false'">
                <span class="dot">
                  @if (hold.releasedAt) { <svg-icon name="check" [size]="11" /> }
                </span>
                <div>
                  <strong>Released</strong>
                  <span>{{ hold.releasedAt ? longDate(hold.releasedAt) : 'still in effect' }}</span>
                </div>
              </div>
            </div>

            <footer>
              <p class="caption">Custodians covered</p>
              <div class="custodians">
                @for (id of hold.custodianIds; track id) {
                  <span class="cust">
                    <span class="avatar">{{ initials(name(id)) }}</span>
                    {{ name(id) }}
                  </span>
                }
              </div>
            </footer>
          </article>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; max-width: 1280px; margin: 0 auto; }
    .page-head { margin-bottom: var(--s-5); }
    .crumb { margin: 0; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--c-brand); font-weight: 600; }
    h1 { margin: 0.2rem 0 0.3rem; font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -0.02em; }
    .muted { color: var(--c-text-mute); margin: 0; font-size: var(--fs-sm); }

    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3); margin-bottom: var(--s-5); }
    @media (max-width: 800px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
    .kpi {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); padding: var(--s-4);
      box-shadow: var(--sh-1);
      border-left: 3px solid var(--c-text-faint);
      display: flex; flex-direction: column; gap: 2px;
    }
    .kpi[data-tone="warn"] { border-left-color: var(--c-warn); }
    .kpi[data-tone="bad"] { border-left-color: var(--c-bad); }
    .kpi[data-tone="ok"] { border-left-color: var(--c-ok); }
    .kpi .lbl { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); font-weight: 600; }
    .kpi strong { font-size: var(--fs-2xl); color: var(--c-text); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .kpi .sub { font-size: var(--fs-xs); color: var(--c-text-mute); margin-top: 2px; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: var(--s-4); }
    .hold {
      background: var(--c-surface-0); border: 1px solid var(--c-border);
      border-radius: var(--r-lg); padding: var(--s-5);
      box-shadow: var(--sh-1);
      border-left: 3px solid var(--c-warn);
    }
    .hold[data-state="acknowledged"] { border-left-color: var(--c-ok); }
    .hold[data-state="released"] { border-left-color: var(--c-text-faint); opacity: 0.85; }
    .hold.focused { box-shadow: 0 0 0 2px var(--c-brand), var(--sh-2); animation: pulse 1.4s ease-out 1; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 6px rgba(79,70,229,0.18), var(--sh-2); } 100% { box-shadow: 0 0 0 2px var(--c-brand), var(--sh-2); } }

    .hold > header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--s-2); }
    .title { display: inline-flex; align-items: center; gap: var(--s-2); }
    .title code { font-family: ui-monospace, monospace; font-size: var(--fs-sm); color: var(--c-text); font-weight: 600; }
    .size { font-size: var(--fs-xs); color: var(--c-text-mute); }

    .scope {
      margin: var(--s-2) 0 var(--s-4);
      padding: var(--s-3);
      background: var(--c-surface-1); border-radius: var(--r-md);
      font-size: var(--fs-sm); color: var(--c-text-2); line-height: 1.5;
      border-left: 2px solid var(--c-border-strong);
    }

    .timeline { display: grid; gap: var(--s-3); margin-bottom: var(--s-4); }
    .step { display: grid; grid-template-columns: 24px 1fr; gap: var(--s-2); align-items: center; }
    .step .dot {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-2); color: var(--c-text-faint);
      border-radius: var(--r-pill); border: 2px solid var(--c-surface-2);
    }
    .step[data-done="true"] .dot { background: var(--c-ok); border-color: var(--c-ok-soft); color: white; }
    .step[data-done="false"] strong { color: var(--c-text-mute); }
    .step strong { display: block; font-size: var(--fs-sm); font-weight: 500; color: var(--c-text); }
    .step span { font-size: var(--fs-xs); color: var(--c-text-mute); }

    footer { padding-top: var(--s-3); border-top: 1px solid var(--c-divider); }
    .caption { margin: 0 0 var(--s-2); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); font-weight: 600; }
    .custodians { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .cust {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px 3px 3px;
      background: var(--c-surface-1); border: 1px solid var(--c-border); border-radius: var(--r-pill);
      font-size: var(--fs-xs); color: var(--c-text-2);
    }
    .avatar {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-2); color: var(--c-text-2);
      border-radius: var(--r-pill);
      font-size: 0.6rem; font-weight: 600;
    }

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
export class HoldsComponent {
  protected readonly matterId = environment.matterId;
  private readonly store = inject(MatterStore);
  private readonly custMap = new Map(listCustodians(this.matterId).map((c) => [c.id, c.name]));

  protected readonly holds = this.store.legalHolds;
  protected readonly active = computed(() => this.holds().filter((h) => !h.releasedAt));
  protected readonly pending = computed(() => this.holds().filter((h) => !h.acknowledgedAt && !h.releasedAt));
  protected readonly acknowledged = computed(() => this.holds().filter((h) => h.acknowledgedAt && !h.releasedAt));
  protected readonly released = computed(() => this.holds().filter((h) => h.releasedAt));

  protected readonly uniqueCustodianCount = computed(() => {
    const set = new Set<string>();
    for (const h of this.active()) for (const id of h.custodianIds) set.add(id);
    return set.size;
  });

  /** Deep-link support — `?id=HOLD-001` highlights and scrolls to the
      matching card. `?created=1` flips a one-shot flash banner that
      auto-dismisses after 6s. */
  private readonly route = inject(ActivatedRoute);
  private readonly idParam = toSignal(this.route.queryParamMap, { initialValue: null });
  protected readonly focusedId = computed(() => this.idParam()?.get('id') ?? null);
  protected readonly justCreated = signal(false);
  private readonly _flashBanner = effect(() => {
    if (this.idParam()?.get('created') === '1') {
      this.justCreated.set(true);
      setTimeout(() => this.justCreated.set(false), 6000);
    }
  });

  protected dismissBanner(): void {
    this.justCreated.set(false);
  }
  private readonly holdCards = viewChildren<ElementRef<HTMLElement>>('holdCard');
  private readonly _scrollToFocused = effect(() => {
    const id = this.focusedId();
    if (!id) return;
    queueMicrotask(() => {
      const cards = this.holdCards();
      for (const ref of cards) {
        if (ref.nativeElement.dataset['id'] === id) {
          ref.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
      }
    });
  });

  state(h: { acknowledgedAt?: string; releasedAt?: string }): string {
    if (h.releasedAt) return 'released';
    if (h.acknowledgedAt) return 'acknowledged';
    return 'pending';
  }
  name(id: string): string { return this.custMap.get(id) ?? id; }
  initials(name: string): string {
    return (name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2) || '?').toUpperCase();
  }
  longDate(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
