import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  CalWorkbenchComponent as MvkCalWorkbench,
  type CalDecision,
  type CalProposal,
  type CalRoundStats,
} from '@infra-tools/agentic-ui';

function seedProposals(): readonly CalProposal[] {
  return [
    {
      itemId: 'doc-110001',
      title: 'Email — "attorney-client privileged"',
      predictedLabel: 'privileged',
      confidence: 0.92,
      rationale: "Subject line contains 'A/C Privileged'; sender outside counsel.",
      alternatives: ['responsive', 'non-responsive'],
      summary: '"Forwarding the engagement letter draft from Latham…"',
    },
    {
      itemId: 'doc-110002',
      title: 'Slack DM — strategy thread',
      predictedLabel: 'privileged',
      confidence: 0.68,
      rationale: "Tagged as 'priv-candidate'; mixed-party thread.",
      alternatives: ['work-product', 'responsive'],
      summary: '"Reminder — keep counsel looped on the QC pass…"',
    },
    {
      itemId: 'doc-110003',
      title: 'Doc — meeting minutes',
      predictedLabel: 'responsive',
      confidence: 0.81,
      rationale: 'Topic match: deal-related; no privilege markers.',
      alternatives: ['privileged', 'non-responsive'],
      summary: 'Board meeting notes from 2026-04-22, deal status update.',
    },
  ];
}

/**
 * `/cal` route — Continuous Active Learning workbench
 * (Workflow C, post-chat-surfaces P4).
 *
 * Renders `<mvk-cal-workbench>` with seeded proposals + a synthetic
 * round-stats block. The host (this page) owns the cursor, decision
 * tally, and convergence stats; the lib component is presentation-
 * only — `(decision)` / `(navigate)` / `(advance)` emit, host writes
 * back. Production wires a `runTarClassifier` operation on `advance`.
 */
@Component({
  selector: 'app-cal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MvkCalWorkbench],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Workflow</p>
        <h1>CAL workbench</h1>
        <p class="muted">
          Workflow C — accept the agent's prediction, reject + relabel, or
          skip. Train the next round when the batch is done.
        </p>
      </div>
    </section>
    <mvk-cal-workbench
      [current]="current()"
      [stats]="stats()"
      [canNavigatePrev]="cursor() > 0"
      [canNavigateNext]="cursor() < total() - 1"
      (decision)="onDecision($event)"
      (navigate)="onNavigate($event)"
      (advance)="onAdvance()" />
  `,
  styles: `
    :host { display: block; max-width: 920px; }
    .page-head { margin-bottom: var(--s-5); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
  `,
})
export class CalPage {
  protected readonly proposals = signal<readonly CalProposal[]>(seedProposals());
  protected readonly cursor = signal(0);
  protected readonly tagged = signal(0);
  protected readonly round = signal(1);

  protected readonly total = computed(() => this.proposals().length);
  protected readonly current = computed<CalProposal | null>(
    () => this.proposals()[this.cursor()] ?? null,
  );
  protected readonly stats = computed<CalRoundStats>(() => ({
    round: this.round(),
    tagged: this.tagged(),
    batchSize: this.total(),
    agreementRate: this.tagged() > 0 ? 0.82 : undefined,
    converged: false,
  }));

  protected onDecision(d: CalDecision): void {
    this.tagged.update((n) => n + 1);
    if (this.cursor() < this.total() - 1) {
      this.cursor.update((n) => n + 1);
    }
    console.info('[cal] decision:', d);
  }

  protected onNavigate(delta: -1 | 1): void {
    this.cursor.update((n) => Math.max(0, Math.min(this.total() - 1, n + delta)));
  }

  protected onAdvance(): void {
    // Production: dispatch a `runTarClassifier` long-running operation,
    // refresh proposals on completion. Demo: just bump the round + reset.
    this.round.update((n) => n + 1);
    this.tagged.set(0);
    this.cursor.set(0);
  }
}
