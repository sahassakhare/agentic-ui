import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

/** One classification proposal the agent emitted for a single item. */
export interface CalProposal {
  /** Stable item id — typically the document id. */
  readonly itemId: string;
  /** Display title rendered above the document slot. */
  readonly title: string;
  /** Predicted label — `'privileged'`, `'responsive'`, custom-string OK. */
  readonly predictedLabel: string;
  /** Model confidence in 0..1 (or any 0..100 — the component formats both). */
  readonly confidence: number;
  /**
   * Short explanation surfacing in the proposal panel — "phrase
   * 'attorney-client'; sender outside counsel" etc.
   */
  readonly rationale?: string;
  /** Other labels the reviewer can correct to. */
  readonly alternatives?: readonly string[];
  /** Free-form summary of the underlying record. */
  readonly summary?: string;
}

/** Reviewer's decision for one proposal. */
export interface CalDecision {
  readonly itemId: string;
  readonly action: 'accept' | 'reject' | 'skip';
  /** When `action === 'reject'`, the label the reviewer picked instead. */
  readonly correctedTo?: string;
}

/** Per-round stats for the workbench header. */
export interface CalRoundStats {
  /** Round number, 1-indexed. */
  readonly round: number;
  /** How many items the reviewer has tagged in this round so far. */
  readonly tagged: number;
  /** Total items in this round's batch. */
  readonly batchSize: number;
  /**
   * Reviewer-agent agreement rate so far (0..1). Drives the convergence
   * progress bar. Hosts compute this; the workbench just renders.
   */
  readonly agreementRate?: number;
  /**
   * Whether the loop has reached convergence — set to true by the host
   * when re-train deltas stabilise. Locks further actions when true.
   */
  readonly converged?: boolean;
}

/**
 * Continuous Active Learning workbench — Workflow C from
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Two-pane review surface for the agent-classifies → reviewer-corrects
 * → agent-retrains loop. The host:
 *
 * 1. Drives the loop's outer mechanics: tags seed items, calls
 *    `runTARClassifier`, persists the model snapshot via
 *    `PersistenceRegistry`, advances rounds.
 * 2. Hands the workbench the current batch's proposals one at a time
 *    via `[current]` + provides the document content via the named
 *    slot `<ng-content select="[slot=document]">`.
 * 3. Receives `(decision)` per accept/reject/skip and `(advance)` when
 *    the reviewer signals "ready for next batch".
 *
 * @example
 * ```html
 * <mvk-cal-workbench
 *   [current]="proposals()[cursor()]"
 *   [stats]="roundStats()"
 *   (decision)="onDecision($event)"
 *   (navigate)="cursor.set($event)"
 *   (advance)="onTrainNextRound()">
 *   <app-doc-preview slot="document" [docId]="proposals()[cursor()]?.itemId" />
 * </mvk-cal-workbench>
 * ```
 *
 * Each `(decision)` is host-wired to a chain-hashed tool call —
 * *"reviewer SC tagged D-117 as privileged corrected from non-priv"*
 * — so the audit chain captures the training trajectory. Opposing
 * counsel can inspect every round.
 */
@Component({
  selector: 'mvk-cal-workbench',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="workbench" aria-label="CAL workbench" [attr.data-converged]="stats()?.converged">
      <header class="head">
        <div class="round-info">
          <span class="round-num">Round {{ stats()?.round ?? 1 }}</span>
          <span class="round-progress" aria-live="polite">
            {{ stats()?.tagged ?? 0 }} / {{ stats()?.batchSize ?? 0 }} tagged
          </span>
          @if (stats()?.converged) {
            <span class="convergence-badge">✓ Converged</span>
          }
        </div>
        @if (showAgreementBar()) {
          <div class="agreement" aria-label="Agent–reviewer agreement rate">
            <span class="agreement-label">Agreement</span>
            <progress
              class="agreement-bar"
              [attr.value]="agreementValue()"
              max="100"></progress>
            <span class="agreement-value">{{ agreementValue() }}%</span>
          </div>
        }
      </header>

      <div class="panes">
        <section class="doc-pane" aria-label="Document">
          @if (current(); as p) {
            <header class="doc-head">
              <h3 class="doc-title">{{ p.title }}</h3>
              <span class="doc-id">{{ p.itemId }}</span>
            </header>
          }
          <div class="doc-slot">
            <ng-content select="[slot=document]" />
          </div>
        </section>

        <aside class="proposal-pane" aria-label="Classification proposal">
          @if (current(); as p) {
            <header class="proposal-head">
              <span class="proposal-label">Agent proposes</span>
              <span class="proposed-label">{{ p.predictedLabel }}</span>
              <span class="confidence" [attr.data-confidence-bucket]="confidenceBucket(p.confidence)">
                {{ formatConfidence(p.confidence) }}
              </span>
            </header>

            @if (p.rationale) {
              <p class="rationale">{{ p.rationale }}</p>
            }

            @if (p.summary) {
              <details class="summary">
                <summary>Summary</summary>
                <p>{{ p.summary }}</p>
              </details>
            }

            <div class="actions" role="group" aria-label="Review actions">
              <button
                type="button"
                class="action-btn accept"
                [disabled]="stats()?.converged"
                (click)="onAction('accept')">Accept</button>
              <button
                type="button"
                class="action-btn reject"
                [disabled]="stats()?.converged"
                (click)="onReject()">Reject + Correct</button>
              <button
                type="button"
                class="action-btn skip"
                [disabled]="stats()?.converged"
                (click)="onAction('skip')">Skip</button>
            </div>

            @if (correctOpen()) {
              <div class="correct" role="group" aria-label="Choose correct label">
                <span class="correct-label">Correct to:</span>
                @if (p.alternatives && p.alternatives.length > 0) {
                  @for (alt of p.alternatives; track alt) {
                    <button
                      type="button"
                      class="alt-btn"
                      (click)="onConfirmReject(alt)">{{ alt }}</button>
                  }
                } @else {
                  <button
                    type="button"
                    class="alt-btn"
                    (click)="onConfirmReject('not-' + p.predictedLabel)">not {{ p.predictedLabel }}</button>
                }
                <button
                  type="button"
                  class="alt-btn cancel"
                  (click)="onCancelReject()">Cancel</button>
              </div>
            }

            <footer class="nav-foot">
              <button
                type="button"
                class="nav-btn"
                [disabled]="!canNavigatePrev()"
                (click)="onNavigate(-1)">← Prev</button>
              <button
                type="button"
                class="nav-btn"
                [disabled]="!canNavigateNext()"
                (click)="onNavigate(1)">Next →</button>
              @if (showAdvance()) {
                <button
                  type="button"
                  class="advance-btn"
                  [disabled]="stats()?.converged"
                  (click)="onAdvance()">{{ advanceLabel() }}</button>
              }
            </footer>
          } @else {
            <div class="empty">
              @if (stats()?.converged) {
                Training converged — every batch's deltas have stabilised.
              } @else {
                No item to review. Trigger the next training round to fetch a new batch.
              }
              @if (showAdvance()) {
                <button type="button" class="advance-btn" (click)="onAdvance()">{{ advanceLabel() }}</button>
              }
            </div>
          }
        </aside>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; }
    .workbench {
      display: grid; grid-template-rows: auto 1fr;
      gap: 0.8rem;
      padding: 1rem;
      height: 100%; min-height: 0;
      background: #f9fafb;
    }
    .workbench[data-converged="true"] { background: #f0fdf4; }
    .head {
      display: flex; justify-content: space-between; align-items: center;
      gap: 1rem; flex-wrap: wrap;
      background: white; border: 1px solid #e5e7eb;
      border-radius: 0.5rem; padding: 0.6rem 0.9rem;
    }
    .round-info { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
    .round-num { font-weight: 700; color: #111827; font-size: 1.05rem; }
    .round-progress { color: #6b7280; font-size: 0.85rem; }
    .convergence-badge {
      padding: 0.15rem 0.6rem; border-radius: 999px;
      background: #16a34a; color: white;
      font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em;
    }
    .agreement { display: flex; align-items: center; gap: 0.45rem; }
    .agreement-label { color: #6b7280; font-size: 0.78rem; font-weight: 600; }
    .agreement-bar { width: 140px; height: 8px; appearance: none; }
    .agreement-bar::-webkit-progress-bar { background: #e5e7eb; border-radius: 999px; }
    .agreement-bar::-webkit-progress-value { background: #16a34a; border-radius: 999px; transition: width 200ms; }
    .agreement-value { color: #111827; font-size: 0.78rem; font-weight: 700; }
    .panes {
      display: grid; grid-template-columns: 2fr 1fr;
      gap: 0.8rem; min-height: 0; min-width: 0;
    }
    @media (max-width: 900px) { .panes { grid-template-columns: 1fr; } }
    .doc-pane {
      display: flex; flex-direction: column; gap: 0.5rem;
      background: white; border: 1px solid #e5e7eb;
      border-radius: 0.5rem; padding: 0.9rem 1rem; min-width: 0; overflow: hidden;
    }
    .doc-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
    .doc-title { margin: 0; font-size: 1.05rem; font-weight: 700; color: #111827; }
    .doc-id { color: #6b7280; font-size: 0.75rem; font-family: ui-monospace, monospace; }
    .doc-slot { flex: 1; min-height: 0; min-width: 0; overflow: auto; }
    .proposal-pane {
      display: flex; flex-direction: column; gap: 0.7rem;
      background: white; border: 1px solid #e5e7eb;
      border-radius: 0.5rem; padding: 0.9rem 1rem; min-width: 0;
    }
    .proposal-head { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
    .proposal-label { color: #6b7280; font-size: 0.78rem; font-weight: 600; }
    .proposed-label {
      padding: 0.15rem 0.55rem; border-radius: 0.3rem;
      background: #ddd6fe; color: #5b21b6;
      font-weight: 700; font-size: 0.85rem;
    }
    .confidence {
      padding: 0.05rem 0.45rem; border-radius: 999px;
      background: #e0e7ff; color: #3730a3;
      font-size: 0.72rem; font-weight: 700; margin-left: auto;
    }
    .confidence[data-confidence-bucket="high"] { background: #dcfce7; color: #166534; }
    .confidence[data-confidence-bucket="low"] { background: #fee2e2; color: #991b1b; }
    .rationale { margin: 0; color: #4b5563; font-size: 0.85rem; line-height: 1.4; }
    .summary { font-size: 0.82rem; }
    .summary summary { cursor: pointer; color: #4b5563; }
    .summary p { margin: 0.3rem 0 0 1rem; color: #4b5563; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
    .actions .action-btn.skip { grid-column: 1 / -1; }
    .action-btn {
      padding: 0.5rem 0.8rem; font: inherit; font-size: 0.85rem; font-weight: 600;
      border-radius: 0.4rem; cursor: pointer; border: 0;
      color: white;
    }
    .action-btn.accept { background: #16a34a; }
    .action-btn.accept:hover { background: #15803d; }
    .action-btn.reject { background: #dc2626; }
    .action-btn.reject:hover { background: #b91c1c; }
    .action-btn.skip { background: white; color: #4b5563; border: 1px solid #e5e7eb; }
    .action-btn.skip:hover { background: #f3f4f6; }
    .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .action-btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .correct {
      display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center;
      padding: 0.5rem 0.6rem;
      background: #fef3c7; border: 1px solid #fcd34d;
      border-radius: 0.4rem;
    }
    .correct-label { color: #92400e; font-size: 0.8rem; font-weight: 600; margin-right: 0.3rem; }
    .alt-btn {
      padding: 0.25rem 0.7rem;
      background: white; border: 1px solid #fcd34d;
      border-radius: 0.3rem; cursor: pointer;
      font: inherit; font-size: 0.78rem; color: #92400e;
    }
    .alt-btn:hover { background: #fef9c3; }
    .alt-btn.cancel { background: transparent; border-color: transparent; color: #6b7280; }
    .nav-foot { display: flex; gap: 0.3rem; margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #f3f4f6; }
    .nav-btn {
      padding: 0.4rem 0.7rem; font: inherit; font-size: 0.8rem; font-weight: 600;
      background: white; border: 1px solid #e5e7eb; border-radius: 0.35rem;
      color: #4b5563; cursor: pointer;
    }
    .nav-btn:hover { background: #f3f4f6; }
    .nav-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .advance-btn {
      margin-left: auto;
      padding: 0.4rem 0.9rem;
      background: #4338ca; color: white; border: 0;
      border-radius: 0.35rem; cursor: pointer;
      font: inherit; font-size: 0.8rem; font-weight: 600;
    }
    .advance-btn:hover { background: #3730a3; }
    .advance-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .empty {
      flex: 1; display: flex; flex-direction: column; gap: 0.7rem;
      align-items: center; justify-content: center;
      color: #6b7280; text-align: center; padding: 2rem 1rem;
      font-size: 0.9rem;
    }
  `,
})
export class CalWorkbenchComponent {
  /**
   * The proposal currently being reviewed. `null` shows the empty state
   * (batch consumed or training just converged).
   */
  readonly current = input<CalProposal | null>(null);

  /** Round + batch + agreement state for the header. */
  readonly stats = input<CalRoundStats | null>(null);

  /** Visible label for the "advance" button. Default `'Train next round'`. */
  readonly advanceLabel = input<string>('Train next round');

  /**
   * Whether prev navigation is enabled. Host signals true when the
   * reviewer is past the first item in the batch.
   */
  readonly canNavigatePrev = input<boolean>(false);

  /**
   * Whether next navigation is enabled. Host signals true when there
   * are more items in the batch.
   */
  readonly canNavigateNext = input<boolean>(false);

  /** Hide the advance button when host wants to gate on tagged count. */
  readonly showAdvance = input<boolean>(true);

  /** Reviewer's decision for the current proposal. */
  readonly decision = output<CalDecision>();

  /**
   * Reviewer hit Prev / Next. Emits the delta (`-1` or `+1`); host
   * advances its own cursor.
   */
  readonly navigate = output<-1 | 1>();

  /** Reviewer triggers next training round. */
  readonly advance = output<void>();

  protected readonly correctOpen = signal(false);

  /** Format the confidence as a 0..100 percentage. */
  protected formatConfidence(value: number): string {
    if (value > 1) return `${Math.round(value)}%`;
    return `${Math.round(value * 100)}%`;
  }

  /** Bucket the confidence into high / medium / low for the chip colour. */
  protected confidenceBucket(value: number): 'low' | 'medium' | 'high' {
    const pct = value > 1 ? value : value * 100;
    if (pct >= 80) return 'high';
    if (pct < 50) return 'low';
    return 'medium';
  }

  protected readonly showAgreementBar = computed(() => {
    const s = this.stats();
    return s !== null && s.agreementRate !== undefined;
  });

  protected readonly agreementValue = computed(() => {
    const s = this.stats();
    const rate = s?.agreementRate ?? 0;
    return Math.round(rate > 1 ? rate : rate * 100);
  });

  protected onAction(action: 'accept' | 'skip'): void {
    const p = this.current();
    if (!p) return;
    this.decision.emit({ itemId: p.itemId, action });
  }

  protected onReject(): void {
    this.correctOpen.set(true);
  }

  protected onConfirmReject(correctedTo: string): void {
    const p = this.current();
    if (!p) return;
    this.correctOpen.set(false);
    this.decision.emit({ itemId: p.itemId, action: 'reject', correctedTo });
  }

  protected onCancelReject(): void {
    this.correctOpen.set(false);
  }

  protected onNavigate(delta: -1 | 1): void {
    this.navigate.emit(delta);
    this.correctOpen.set(false);
  }

  protected onAdvance(): void {
    this.advance.emit();
    this.correctOpen.set(false);
  }
}
