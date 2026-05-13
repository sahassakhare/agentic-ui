import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

/**
 * Built-in review-queue item states modelled on the eDiscovery
 * privilege-review flow. Apps with a different lifecycle can use
 * arbitrary state strings — the component accepts any string and
 * only relies on `[states]` for filtering, not on this union.
 */
export type ReviewQueueState =
  | 'proposed_privileged'
  | 'qc_pending'
  | 'escalated'
  | 'final';

/** One item in the review queue. */
export interface ReviewQueueItem {
  readonly id: string;
  /** Current state — drives grouping + which actions surface. */
  readonly state: ReviewQueueState | string;
  readonly title: string;
  readonly summary?: string;
  /** Who proposed this item — `'agent'` or a persona id. */
  readonly proposedBy?: 'agent' | string;
  /** ISO timestamp; rendered as relative time. */
  readonly updatedAt?: string;
  readonly tags?: readonly string[];
}

/** One action available on items in a given state. */
export interface ReviewQueueAction {
  /** Stable key forwarded into `ReviewDecision.action`. */
  readonly key: string;
  /** Button label rendered to the user. */
  readonly label: string;
  /** Visual emphasis. `'primary'` is filled; default is outlined. */
  readonly emphasis?: 'primary' | 'danger' | 'default';
}

/**
 * Map from state name → ordered list of actions available in that
 * state. Hosts override to fit their domain lifecycle; the lib ships
 * a sensible eDiscovery default.
 */
export type ReviewQueueActionConfig = Readonly<Record<string, readonly ReviewQueueAction[]>>;

/** Emitted when the user clicks a decision button. */
export interface ReviewDecision {
  readonly itemId: string;
  readonly action: string;
  /** Whatever state the item was in when the decision was made. */
  readonly fromState: string;
}

/** Default action config for the eDiscovery privilege-review flow. */
export const DEFAULT_REVIEW_QUEUE_ACTIONS: ReviewQueueActionConfig = {
  proposed_privileged: [
    { key: 'accept', label: 'Accept', emphasis: 'primary' },
    { key: 'reject', label: 'Reject', emphasis: 'danger' },
  ],
  qc_pending: [
    { key: 'approve', label: 'Approve', emphasis: 'primary' },
    { key: 'escalate', label: 'Escalate', emphasis: 'default' },
  ],
  escalated: [
    { key: 'finalize', label: 'Finalize', emphasis: 'primary' },
    { key: 'reject', label: 'Reject', emphasis: 'danger' },
  ],
  final: [],
};

/**
 * Per-persona-routed review queue — Pillar 1 Workflow E from
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Renders items grouped by state. Junior reviewers see
 * `proposed_privileged`; senior reviewers see `qc_pending`;
 * partners see `escalated`. The component is **presentation-only**:
 * the host filters `[states]` per active persona, supplies the item
 * list, and owns the state-transition + audit-chain writeback when
 * a decision is emitted.
 *
 * Three properties this gives you for free that a bespoke queue
 * component would not:
 *
 * - **Persona routing without forks.** One component renders all
 *   four eDiscovery personas' queues. The `[states]` input filters
 *   what's visible; nothing else changes per persona.
 * - **Customisable actions per state.** `[actionConfig]` maps each
 *   state to its action set (`accept` / `reject` / `escalate` /
 *   `approve` / `finalize` / ...). Apps with non-eDiscovery flows
 *   pass their own config; the default fits the most common case.
 * - **Dispatch-agnostic.** Same pattern as every other P0/P1/P2/P3
 *   surface — `(decision)` emits a typed `ReviewDecision`; host
 *   wires the actual mutation + chain-hash. `(open)` emits when the
 *   user clicks the item body so the host can mount a doc workbench
 *   on a sister route.
 *
 * @example
 * ```ts
 * // Junior reviewer's queue: only the proposed-privileged state.
 * personaStates = computed(() => {
 *   switch (this.activePersona()) {
 *     case 'junior-reviewer': return ['proposed_privileged'];
 *     case 'senior-reviewer': return ['qc_pending'];
 *     case 'partner':         return ['escalated'];
 *     case 'gc':              return ['proposed_privileged', 'qc_pending', 'escalated', 'final'];
 *     default: return [];
 *   }
 * });
 * ```
 *
 * @example
 * ```html
 * <mvk-review-queue
 *   [items]="queueStore.items()"
 *   [states]="personaStates()"
 *   (decision)="onDecision($event)"
 *   (open)="onOpenItem($event)" />
 * ```
 */
@Component({
  selector: 'mvk-review-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="queue" aria-label="Review queue">
      @if (visibleGroups().length === 0) {
        <p class="empty">Nothing to review right now.</p>
      }
      @for (group of visibleGroups(); track group.state) {
        <section class="group" [attr.data-state]="group.state">
          <header class="group-head">
            <h3 class="group-title">{{ labelForState(group.state) }}</h3>
            <span class="group-count" aria-live="polite">{{ group.items.length }}</span>
          </header>
          @if (group.items.length === 0) {
            <p class="group-empty">No items in this stage.</p>
          } @else {
            <ul class="item-list" role="list">
              @for (item of group.items; track item.id) {
                <li class="item">
                  <button
                    type="button"
                    class="item-body"
                    [attr.aria-label]="'Open ' + item.title"
                    (click)="onOpen(item.id)">
                    <header class="item-head">
                      <span class="item-title">{{ item.title }}</span>
                      @if (item.proposedBy) {
                        <span class="proposed">by {{ item.proposedBy }}</span>
                      }
                      @if (item.updatedAt) {
                        <time class="ts" [attr.datetime]="item.updatedAt">{{ formatTime(item.updatedAt) }}</time>
                      }
                    </header>
                    @if (item.summary) {
                      <p class="summary">{{ item.summary }}</p>
                    }
                    @if (item.tags && item.tags.length > 0) {
                      <ul class="tags" role="list">
                        @for (t of item.tags; track t) {
                          <li class="tag">{{ t }}</li>
                        }
                      </ul>
                    }
                  </button>
                  @if (actionsFor(item.state).length > 0) {
                    <div class="actions" role="group" [attr.aria-label]="'Actions for ' + item.title">
                      @for (a of actionsFor(item.state); track a.key) {
                        <button
                          type="button"
                          class="action-btn"
                          [class.primary]="a.emphasis === 'primary'"
                          [class.danger]="a.emphasis === 'danger'"
                          (click)="onAction(item, a)">
                          {{ a.label }}
                        </button>
                      }
                    </div>
                  }
                </li>
              }
            </ul>
          }
        </section>
      }
    </section>
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; }
    .queue { display: flex; flex-direction: column; gap: 1rem; padding: 1rem 1.2rem; }
    .empty { text-align: center; padding: 3rem 1rem; color: #6b7280; }
    .group { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 0.8rem 1rem; }
    .group-head { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.6rem; }
    .group-title { margin: 0; font-size: 0.85rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.04em; }
    .group-count {
      padding: 0.1rem 0.5rem; border-radius: 999px;
      background: #eef2ff; color: #4338ca;
      font-size: 0.75rem; font-weight: 600;
    }
    .group-empty { color: #9ca3af; font-style: italic; font-size: 0.85rem; margin: 0; }
    .item-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .item {
      display: grid; grid-template-columns: 1fr auto; gap: 0.6rem;
      align-items: center;
      border: 1px solid #e5e7eb; border-radius: 0.4rem;
      padding: 0.55rem 0.7rem;
      background: #fafafa;
    }
    .item-body {
      background: transparent; border: 0; padding: 0;
      text-align: left; cursor: pointer; font: inherit; min-width: 0;
      display: flex; flex-direction: column; gap: 0.25rem;
    }
    .item-body:hover .item-title { text-decoration: underline; }
    .item-body:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; border-radius: 0.35rem; }
    .item-head { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
    .item-title { font-weight: 600; color: #111827; font-size: 0.92rem; }
    .proposed { color: #6b7280; font-size: 0.75rem; }
    .ts { color: #9ca3af; font-size: 0.75rem; margin-left: auto; }
    .summary { margin: 0; color: #4b5563; font-size: 0.85rem; line-height: 1.35; }
    .tags { list-style: none; margin: 0.15rem 0 0; padding: 0; display: flex; gap: 0.25rem; flex-wrap: wrap; }
    .tag {
      padding: 0.05rem 0.45rem; border-radius: 999px;
      background: #ede9fe; color: #5b21b6;
      font-size: 0.7rem; font-weight: 500;
    }
    .actions { display: flex; gap: 0.3rem; flex-wrap: wrap; justify-content: flex-end; }
    .action-btn {
      padding: 0.35rem 0.75rem;
      background: white; border: 1px solid #e5e7eb;
      border-radius: 0.35rem; cursor: pointer;
      font: inherit; font-size: 0.8rem; font-weight: 600;
      color: #1e1b4b;
    }
    .action-btn:hover { background: #f5f3ff; }
    .action-btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .action-btn.primary { background: #2563eb; border-color: #2563eb; color: white; }
    .action-btn.primary:hover { background: #1d4ed8; }
    .action-btn.danger { background: white; border-color: #fca5a5; color: #b91c1c; }
    .action-btn.danger:hover { background: #fee2e2; }
  `,
})
export class ReviewQueueComponent {
  /** All items to consider. The component groups by state internally. */
  readonly items = input.required<readonly ReviewQueueItem[]>();

  /**
   * Which states the active persona is allowed to see. The component
   * renders one group per state in the order given here. When omitted
   * or empty, every distinct state present in the items list is
   * shown.
   */
  readonly states = input<readonly string[]>([]);

  /** Maps state name → ordered list of actions. Falls back to the eDiscovery default. */
  readonly actionConfig = input<ReviewQueueActionConfig>(DEFAULT_REVIEW_QUEUE_ACTIONS);

  /**
   * Optional human-readable label per state. Keys are state strings;
   * values are the displayed title. Falls back to a humanised form
   * of the state string ('proposed_privileged' → 'Proposed
   * Privileged').
   */
  readonly stateLabels = input<Readonly<Record<string, string>>>({});

  /** Click on the item body — host mounts the doc workbench. */
  readonly open = output<string>();

  /** Click on a decision action button — host writes back the new state. */
  readonly decision = output<ReviewDecision>();

  /** Pre-grouped + per-states-filtered view used by the template. */
  protected readonly visibleGroups = computed<readonly { state: string; items: readonly ReviewQueueItem[] }[]>(() => {
    const items = this.items();
    const personaStates = this.states();
    const usePersonaStates = personaStates.length > 0;
    const ordered = usePersonaStates
      ? personaStates
      : Array.from(new Set(items.map((i) => i.state)));
    return ordered.map((state) => ({
      state,
      items: items.filter((i) => i.state === state),
    }));
  });

  protected actionsFor(state: string): readonly ReviewQueueAction[] {
    return this.actionConfig()[state] ?? [];
  }

  protected labelForState(state: string): string {
    const explicit = this.stateLabels()[state];
    if (explicit) return explicit;
    return state
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  protected onOpen(itemId: string): void {
    this.open.emit(itemId);
  }

  protected onAction(item: ReviewQueueItem, a: ReviewQueueAction): void {
    this.decision.emit({ itemId: item.id, action: a.key, fromState: item.state });
  }

  /** Render an ISO timestamp as relative time. */
  protected formatTime(iso: string): string {
    const ts = Date.parse(iso);
    if (isNaN(ts)) return '';
    const diffMs = Date.now() - ts;
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d ago`;
  }
}
