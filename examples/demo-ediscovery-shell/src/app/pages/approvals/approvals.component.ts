import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ApprovalCardComponent, ApprovalRegistry } from '@maverick/agentic-ui';
import { PersonaService } from '../../services/persona.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';

/**
 * `/approvals` queue page (Capability F4 — r3 plan §9.4.4).
 *
 * Lists pending approvals visible to the active persona and the most
 * recent decided approvals. Mounts `<mvk-approval-card>` per row so
 * the same Approve / Reject affordances appear here as appear inline
 * in the chat panel — one approval, one component, two surfaces.
 *
 * Drives the asynchronous-handoff flow that AC-F4-5 calls out:
 *   1. Paralegal triggers a gated tool from the chat — the intercept
 *      queues the approval and shows the card inline.
 *   2. Paralegal logs out (or just navigates away). State persists in
 *      `ApprovalRegistry` for the duration of the session; production
 *      deployments back this with `PersistenceRegistry` for cross-
 *      session durability.
 *   3. Lead counsel logs in the next morning, opens `/approvals`, and
 *      sees the queue. Approve / Reject from this page does the same
 *      thing as Approve / Reject from the chat-inline card.
 */
@Component({
  selector: 'app-approvals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ApprovalCardComponent, EmptyStateComponent, IconComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Governance</p>
        <h1>Approvals queue</h1>
        <p class="muted">
          Active persona: <strong>{{ activePersonaLabel() }}</strong>
          · {{ visiblePending().length }} pending visible to you
          · {{ totalPending() }} total in the queue
        </p>
      </div>
    </section>

    <div class="kpis">
      <div class="kpi" data-tone="warn">
        <span class="lbl">Awaiting your decision</span>
        <strong>{{ visiblePending().length }}</strong>
        <span class="sub">{{ visiblePending().length === 0 ? 'all caught up' : 'review and sign off' }}</span>
      </div>
      <div class="kpi" data-tone="neutral">
        <span class="lbl">Pending elsewhere</span>
        <strong>{{ pendingForOthers() }}</strong>
        <span class="sub">approvers from other roles</span>
      </div>
      <div class="kpi" data-tone="ok">
        <span class="lbl">Approved (recent)</span>
        <strong>{{ recentApproved().length }}</strong>
        <span class="sub">last 20</span>
      </div>
      <div class="kpi" data-tone="bad">
        <span class="lbl">Rejected (recent)</span>
        <strong>{{ recentRejected().length }}</strong>
        <span class="sub">last 20</span>
      </div>
    </div>

    <section class="block">
      <header class="block-head">
        <h2>
          <svg-icon name="circle-check" [size]="18" />
          Pending — your queue
        </h2>
        <p class="hint">Approvals routed to your persona role.</p>
      </header>
      @if (visiblePending().length === 0) {
        <mvk-empty-state
          title="No approvals waiting on you"
          icon="check"
          message="Either nothing is pending, or pending items are routed to a different approver role."
          [hint]="otherPersonaHint()"
        />
      } @else {
        <div class="cards">
          @for (a of visiblePending(); track a.id) {
            <mvk-approval-card [approvalId]="a.id" />
          }
        </div>
      }
    </section>

    @if (recentDecided().length > 0) {
      <section class="block">
        <header class="block-head">
          <h2>
            <svg-icon name="audit" [size]="18" />
            Recent decisions
          </h2>
          <p class="hint">Last 20 decided approvals (any role).</p>
        </header>
        <div class="cards">
          @for (a of recentDecided(); track a.id) {
            <mvk-approval-card [approvalId]="a.id" />
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host { display: block; max-width: 920px; }
    .page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: var(--s-5); gap: var(--s-4); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--s-3); margin-bottom: var(--s-5); }
    .kpi { padding: var(--s-3) var(--s-4); background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-md); display: flex; flex-direction: column; gap: 2px; border-left: 4px solid var(--c-border); }
    .kpi[data-tone="warn"] { border-left-color: #f59e0b; }
    .kpi[data-tone="ok"] { border-left-color: #10b981; }
    .kpi[data-tone="bad"] { border-left-color: #ef4444; }
    .kpi[data-tone="neutral"] { border-left-color: #6b7280; }
    .kpi .lbl { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .kpi strong { font-size: var(--fs-2xl); line-height: 1.1; color: var(--c-text-1); }
    .kpi .sub { font-size: var(--fs-xs); color: var(--c-text-2); }
    .block { margin-bottom: var(--s-5); }
    .block-head { margin-bottom: var(--s-3); }
    .block-head h2 { display: flex; align-items: center; gap: var(--s-2); margin: 0; font-size: var(--fs-lg); }
    .block-head .hint { margin: 0.2rem 0 0; font-size: var(--fs-sm); color: var(--c-text-2); }
    .cards { display: flex; flex-direction: column; gap: var(--s-3); }
  `,
})
export class ApprovalsComponent {
  private readonly approvals = inject(ApprovalRegistry);
  private readonly personaService = inject(PersonaService);

  protected readonly activePersona = this.personaService.active;

  protected readonly activePersonaLabel = computed(() => {
    const p = this.activePersona();
    return this.personaService.profile(p)?.label ?? p;
  });

  /** Pending approvals routed to the active persona. */
  protected readonly visiblePending = computed(() =>
    this.approvals.pendingForApprover(this.activePersona()),
  );

  /** Total pending across all roles — informational. */
  protected readonly totalPending = computed(
    () => this.approvals.byStatus('pending').length,
  );

  /** Pending approvals visible to OTHER roles (queue overflow signal). */
  protected readonly pendingForOthers = computed(
    () => this.totalPending() - this.visiblePending().length,
  );

  /** Last 20 decided approvals (any role), newest first. */
  protected readonly recentDecided = computed(() => {
    const all = [...this.approvals.approvals()].reverse();
    return all
      .filter((a) => a.status !== 'pending')
      .slice(0, 20);
  });

  protected readonly recentApproved = computed(() =>
    this.recentDecided().filter((a) => a.status === 'approved'),
  );
  protected readonly recentRejected = computed(() =>
    this.recentDecided().filter((a) => a.status === 'rejected'),
  );

  protected otherPersonaHint(): string {
    const others = this.pendingForOthers();
    if (others === 0) return 'Try triggering an approval-gated tool from the chat (e.g. "release HOLD-001").';
    return `${others} approval${others === 1 ? ' is' : 's are'} routed to a different role. Switch persona via the header to see them.`;
  }
}
