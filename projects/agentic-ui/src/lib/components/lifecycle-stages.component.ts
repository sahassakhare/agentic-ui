import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

/**
 * One stage in a multi-step workflow.
 *
 * - `done` — completed, irreversible from the user's POV
 * - `active` — currently in-flight (shown with a pulse animation)
 * - `pending` — not yet reached
 * - `blocked` — gated on an external decision (e.g. waiting on
 *   approval, awaiting upstream data)
 * - `failed` — terminal failure; needs re-route
 */
export type StageStatus = 'done' | 'active' | 'pending' | 'blocked' | 'failed';

/** A single stage definition + its current state. */
export interface StageDef {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly status: StageStatus;
  /** Who owns this stage (e.g. 'partner: Sarah', 'auto', 'awaiting custodian'). */
  readonly owner?: string;
  /** ISO timestamp when this stage was last updated. */
  readonly updatedAt?: string;
  /** SLA hint — overdue stages render a warning chip. */
  readonly slaWarning?: string;
  /** Optional action label exposed when the stage is `active` or `blocked`. */
  readonly action?: { readonly label: string; readonly key: string };
}

/** Emitted when the user clicks a stage's action button. */
export interface StageAction {
  readonly stageId: string;
  readonly actionKey: string;
}

/**
 * Lifecycle stages widget — Workflow A from
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Renders a horizontal (or vertical, on narrow layouts) progression
 * of stages: Issue → Acknowledge → Track → Reissue → Release (for
 * the legal-hold lifecycle) or Scope → Collect → ... → Deliver (for
 * the production pipeline workflow B).
 *
 * The widget is **presentation-only**. Stage transitions, SLA
 * checks, and reminder drafting happen in tools wired to a
 * `TriggerRegistry` cron (P2.1) and `ApprovalRegistry` (F4).
 * The widget renders status, emits a typed `(action)` event when
 * the user clicks a stage's action button, and that's it.
 *
 * @example
 * ```html
 * <mvk-lifecycle-stages
 *   [stages]="holdStages()"
 *   [title]="'Hold H-117 — Project Phoenix'"
 *   [orientation]="'horizontal'"
 *   (action)="onStageAction($event)" />
 * ```
 *
 * @example
 * ```ts
 * holdStages = signal<StageDef[]>([
 *   { id: 'issue',       title: 'Issue',       status: 'done',
 *     owner: 'partner: Sarah', updatedAt: '2026-04-12T14:30:00Z' },
 *   { id: 'acknowledge', title: 'Acknowledge', status: 'active',
 *     owner: 'awaiting 3 custodians', slaWarning: '2 days overdue',
 *     action: { label: 'Send reminders', key: 'send-reminders' } },
 *   { id: 'track',       title: 'Track',       status: 'pending' },
 *   { id: 'reissue',     title: 'Reissue',     status: 'pending' },
 *   { id: 'release',     title: 'Release',     status: 'pending' },
 * ]);
 *
 * onStageAction(a: StageAction): void {
 *   // a.actionKey === 'send-reminders' → chat.sendMessage('draftReminders ...')
 * }
 * ```
 */
@Component({
  selector: 'mvk-lifecycle-stages',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="lifecycle" [attr.data-orientation]="orientation()" aria-label="Lifecycle">
      @if (title()) {
        <header class="head">
          <h3 class="title">{{ title() }}</h3>
          <span class="progress" aria-live="polite">
            {{ doneCount() }} / {{ stages().length }} complete
          </span>
        </header>
      }

      <ol class="stage-list" role="list">
        @for (s of stages(); track s.id; let i = $index; let last = $last) {
          <li
            class="stage"
            [class.done]="s.status === 'done'"
            [class.active]="s.status === 'active'"
            [class.pending]="s.status === 'pending'"
            [class.blocked]="s.status === 'blocked'"
            [class.failed]="s.status === 'failed'"
            [attr.data-status]="s.status"
            [attr.aria-current]="s.status === 'active' ? 'step' : null">

            <span class="marker" [attr.data-status]="s.status" aria-hidden="true">{{ markerGlyph(s.status) }}</span>

            <div class="content">
              <header class="stage-head">
                <span class="stage-title">{{ s.title }}</span>
                @if (s.slaWarning) {
                  <span class="sla" role="img" [attr.aria-label]="s.slaWarning">⚠ {{ s.slaWarning }}</span>
                }
              </header>

              @if (s.description) {
                <p class="desc">{{ s.description }}</p>
              }

              <footer class="stage-foot">
                @if (s.owner) {
                  <span class="owner">{{ s.owner }}</span>
                }
                @if (s.updatedAt) {
                  <time class="ts" [attr.datetime]="s.updatedAt">{{ formatTime(s.updatedAt) }}</time>
                }
                @if (s.action && (s.status === 'active' || s.status === 'blocked')) {
                  <button
                    type="button"
                    class="stage-action"
                    (click)="onAction(s.id, s.action.key)">
                    {{ s.action.label }}
                  </button>
                }
              </footer>
            </div>

            @if (!last) {
              <span class="connector"
                    [class.connector-done]="s.status === 'done'"
                    aria-hidden="true"></span>
            }
          </li>
        }
      </ol>
    </section>
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; }
    .lifecycle {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 0.5rem;
      padding: 1rem 1.2rem;
    }
    .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.8rem; }
    .title { font-size: 1.05rem; font-weight: 600; margin: 0; color: #111827; }
    .progress { color: #6b7280; font-size: 0.85rem; font-weight: 500; }

    .stage-list { list-style: none; margin: 0; padding: 0; }

    /* Horizontal layout (default) */
    .lifecycle[data-orientation="horizontal"] .stage-list {
      display: flex; gap: 0; flex-wrap: nowrap; overflow-x: auto;
    }
    .lifecycle[data-orientation="horizontal"] .stage {
      flex: 1 1 0; min-width: 140px; position: relative;
      display: flex; flex-direction: column; align-items: center;
      text-align: center; padding: 0.4rem 0.5rem;
    }
    .lifecycle[data-orientation="horizontal"] .connector {
      position: absolute; top: 0.95rem; right: -50%; width: 100%; height: 2px;
      background: #e5e7eb;
    }
    .lifecycle[data-orientation="horizontal"] .connector-done { background: #16a34a; }
    .lifecycle[data-orientation="horizontal"] .content { width: 100%; }

    /* Vertical layout (narrow / mobile) */
    .lifecycle[data-orientation="vertical"] .stage {
      display: grid; grid-template-columns: 2rem 1fr; gap: 0.6rem;
      padding: 0.5rem 0;
      position: relative;
    }
    .lifecycle[data-orientation="vertical"] .connector {
      position: absolute; top: 2.4rem; left: 0.95rem; width: 2px; height: calc(100% - 2rem);
      background: #e5e7eb;
    }
    .lifecycle[data-orientation="vertical"] .connector-done { background: #16a34a; }

    /* Marker (shared) */
    .marker {
      display: inline-flex; align-items: center; justify-content: center;
      width: 1.8rem; height: 1.8rem;
      border-radius: 50%;
      background: #e5e7eb; color: #6b7280;
      font-weight: 700; font-size: 0.8rem;
      flex-shrink: 0; z-index: 1; position: relative;
    }
    .marker[data-status="done"] { background: #16a34a; color: white; }
    .marker[data-status="active"] { background: #2563eb; color: white; animation: pulse 1.6s ease-in-out infinite; }
    .marker[data-status="blocked"] { background: #d97706; color: white; }
    .marker[data-status="failed"] { background: #dc2626; color: white; }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.6); }
      50%      { box-shadow: 0 0 0 6px rgba(37, 99, 235, 0); }
    }

    .stage-head { display: flex; align-items: center; gap: 0.4rem; justify-content: center; flex-wrap: wrap; margin-top: 0.4rem; }
    .lifecycle[data-orientation="vertical"] .stage-head { justify-content: flex-start; margin-top: 0; }
    .stage-title { font-weight: 600; color: #111827; font-size: 0.9rem; }
    .stage.pending .stage-title { color: #9ca3af; }
    .sla {
      padding: 0.1rem 0.45rem;
      background: #fef3c7; color: #92400e;
      border-radius: 999px;
      font-size: 0.7rem; font-weight: 600;
    }
    .desc { margin: 0.3rem 0; color: #6b7280; font-size: 0.8rem; line-height: 1.35; }
    .stage-foot { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; justify-content: center; font-size: 0.75rem; }
    .lifecycle[data-orientation="vertical"] .stage-foot { justify-content: flex-start; }
    .owner { color: #6b7280; }
    .ts { color: #9ca3af; }
    .stage-action {
      margin-left: auto;
      padding: 0.3rem 0.6rem;
      background: #2563eb; color: white; border: 0;
      border-radius: 0.35rem; cursor: pointer; font: inherit;
      font-size: 0.75rem; font-weight: 600;
    }
    .stage-action:hover { background: #1d4ed8; }
    .stage-action:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
  `,
})
export class LifecycleStagesComponent {
  /** The ordered list of stages. */
  readonly stages = input.required<readonly StageDef[]>();

  /** Optional title rendered above the stages. */
  readonly title = input<string | undefined>(undefined);

  /** Layout orientation. Default `'horizontal'`. */
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');

  /** Emits when the user clicks a stage's action button. */
  readonly action = output<StageAction>();

  protected readonly doneCount = computed(
    () => this.stages().filter((s) => s.status === 'done').length,
  );

  protected onAction(stageId: string, actionKey: string): void {
    this.action.emit({ stageId, actionKey });
  }

  protected markerGlyph(status: StageStatus): string {
    switch (status) {
      case 'done': return '✓';
      case 'active': return '●';
      case 'blocked': return '⏸';
      case 'failed': return '✗';
      case 'pending': return '○';
    }
  }

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
