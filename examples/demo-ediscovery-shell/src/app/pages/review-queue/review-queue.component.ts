import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  ReviewQueueComponent as MvkReviewQueue,
  type ReviewDecision,
  type ReviewQueueItem,
} from '@infra-tools/agentic-ui';
import { PersonaService } from '../../services/persona.service';

const SEED_ITEMS: readonly ReviewQueueItem[] = [
  {
    id: 'doc-100482',
    state: 'proposed_privileged',
    title: 'Email — outside counsel re acquisition draft',
    summary:
      "Agent flagged 'attorney-client'; sender at Latham & Watkins.",
    proposedBy: 'agent',
    updatedAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    tags: ['priv-candidate', 'matter-acme'],
  },
  {
    id: 'doc-100599',
    state: 'proposed_privileged',
    title: 'Memo — legal strategy outline',
    summary: 'Header includes "Attorney Work Product".',
    proposedBy: 'agent',
    updatedAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    tags: ['work-product'],
  },
  {
    id: 'doc-099812',
    state: 'qc_pending',
    title: 'Slack thread — outside counsel discussion',
    summary: 'Reviewer accepted privilege; awaiting QC.',
    proposedBy: 'reviewer',
    updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    tags: ['qc-pending'],
  },
  {
    id: 'doc-099701',
    state: 'escalated',
    title: 'Email chain — split privilege call (mixed parties)',
    summary: 'QC reviewer escalated for partner sign-off.',
    proposedBy: 'reviewer',
    updatedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    tags: ['escalated'],
  },
];

/**
 * `/review-queue` route — Workflow E from the post-chat-surfaces
 * plan. Renders `<mvk-review-queue>` with a seeded set of items
 * across all four states. Persona maps to a `[states]` filter so a
 * junior reviewer sees only `proposed_privileged`, a senior sees
 * `qc_pending`, a partner sees `escalated`.
 */
@Component({
  selector: 'app-review-queue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MvkReviewQueue],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Workflow</p>
        <h1>Review queue</h1>
        <p class="muted">
          Workflow E (post-chat-surfaces P4) — persona-routed queue; audit
          trail extends with tool-approved / tool-rejected per decision.
        </p>
      </div>
    </section>
    <mvk-review-queue
      [items]="items()"
      [states]="visibleStates()"
      (decision)="onDecision($event)"
      (open)="onOpen($event)" />
    @if (lastDecision(); as d) {
      <p class="last">
        Last decision: <code>{{ d.action }}</code> on <code>{{ d.itemId }}</code> (was <code>{{ d.fromState }}</code>)
      </p>
    }
  `,
  styles: `
    :host { display: block; max-width: 920px; }
    .page-head { margin-bottom: var(--s-5); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
    .last { margin-top: var(--s-4); padding: var(--s-3); border-left: 3px solid var(--c-accent, #6366f1); background: var(--c-surface-1); font-size: var(--fs-sm); color: var(--c-text-2); }
    code { font-family: ui-monospace, monospace; color: var(--c-text-1); }
  `,
})
export class ReviewQueuePage {
  private readonly persona = inject(PersonaService);

  protected readonly items = signal<readonly ReviewQueueItem[]>(SEED_ITEMS);
  protected readonly lastDecision = signal<ReviewDecision | null>(null);

  /**
   * Persona → which states are visible. Lead counsel sees only
   * escalated; an associate sees QC; paralegal + vendor-reviewer
   * see the front-line `proposed_privileged` pile; lit-support gets
   * everything (so they can field questions).
   */
  protected readonly visibleStates = computed(() => {
    switch (this.persona.active()) {
      case 'lead-counsel':    return ['escalated', 'final'];
      case 'associate':       return ['qc_pending'];
      case 'paralegal':       return ['proposed_privileged'];
      case 'vendor-reviewer': return ['proposed_privileged'];
      case 'lit-support':     return [];   // empty = show all
      default:                return [];
    }
  });

  protected onDecision(d: ReviewDecision): void {
    this.lastDecision.set(d);
    // Production hosts would dispatch an `agenticAction` here to write
    // the decision back through ActionRegistry, then refresh `items`.
    this.items.update((arr) =>
      arr.map((it) => (it.id === d.itemId ? { ...it, state: nextState(it.state, d.action) } : it)),
    );
  }

  protected onOpen(itemId: string): void {
    // Production hosts would route to a detail surface; the demo just
    // logs through telemetry indirectly via the (decision) flow.
    console.info('[review-queue] open requested:', itemId);
  }
}

/** Demo-only state machine for the four-state lifecycle. */
function nextState(current: string, action: string): string {
  if (current === 'proposed_privileged' && action === 'accept') return 'qc_pending';
  if (current === 'qc_pending'          && action === 'approve') return 'final';
  if (current === 'qc_pending'          && action === 'escalate') return 'escalated';
  if (current === 'escalated'           && action === 'finalize') return 'final';
  if (action === 'reject')                                        return 'final';
  return current;
}
