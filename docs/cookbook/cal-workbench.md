# Continuous Active Learning workbench

> **Status:** ships in v1.2.x (P4.B of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Workflow:** C — Continuous Active Learning privilege review

The agent classifies. The reviewer corrects. The agent re-trains on the corrections. Repeat until convergence. Each round is a chain-hashed step — opposing counsel can inspect the training trajectory if the privilege determinations are ever challenged. That's **CAL** (Continuous Active Learning), and `<mvk-cal-workbench>` is the per-round review surface.

The workbench is **presentation-only**. The host owns:

- The model snapshot (typically persisted via `PersistenceRegistry`).
- The classifier tool (your `runTARClassifier` or equivalent).
- Round advancement — *"reviewer agreed with 95% of round 3's proposals, retrain"*.
- The audit-chain writeback — every accept/reject lands as a chain-hashed tool call.

The lib renders one proposal at a time + accept/reject/correct/skip buttons + a round-progress header. Same dispatch-agnostic pattern as every other P0/P1/P2/P3/P4 surface.

## 1. The minimal CAL store

```ts
import { signal, Injectable, inject } from '@angular/core';
import type { CalProposal, CalDecision, CalRoundStats } from '@infra-tools/agentic-ui';

@Injectable({ providedIn: 'root' })
export class CalStore {
  // The round currently in flight (1-indexed). Bumps on each retrain.
  private readonly _round = signal(1);
  // The agent's current batch of proposals.
  private readonly _batch = signal<readonly CalProposal[]>([]);
  // Reviewer's cursor inside the batch.
  private readonly _cursor = signal(0);
  // Per-item decisions captured this round.
  private readonly _decisions = signal<readonly CalDecision[]>([]);
  // Whether re-train deltas stabilised.
  private readonly _converged = signal(false);

  readonly round = this._round.asReadonly();
  readonly batch = this._batch.asReadonly();
  readonly cursor = this._cursor.asReadonly();
  readonly current = computed(() => this._batch()[this._cursor()] ?? null);

  readonly stats = computed<CalRoundStats>(() => ({
    round: this._round(),
    tagged: this._decisions().length,
    batchSize: this._batch().length,
    agreementRate: this.computeAgreement(),
    converged: this._converged(),
  }));

  // Reviewer's decision flows in via the workbench's (decision) event.
  recordDecision(d: CalDecision): void {
    this._decisions.update((prev) => [...prev, d]);
    // Chain-hash via your normal tool-call audit machinery.
    this.audit.append({
      origin: 'cal-workbench',
      kind: 'cal-decision',
      round: this._round(),
      ...d,
      ts: new Date().toISOString(),
    });
    this.moveNext();
  }

  moveBy(delta: -1 | 1): void {
    const next = Math.max(0, Math.min(this._batch().length - 1, this._cursor() + delta));
    this._cursor.set(next);
  }

  /** Retrain: ship the round's decisions to the classifier, fetch a new batch. */
  async advance(): Promise<void> {
    const ds = this._decisions();
    const nextBatch = await this.classifier.retrainAndPropose({
      previousRoundDecisions: ds,
      round: this._round(),
    });
    const stable = ds.length > 0 && this.computeAgreement() >= 0.95;
    this._converged.set(stable);
    if (stable) return;          // workbench locks itself when converged

    this._round.update((n) => n + 1);
    this._batch.set(nextBatch);
    this._cursor.set(0);
    this._decisions.set([]);
  }

  private computeAgreement(): number {
    const ds = this._decisions();
    if (ds.length === 0) return 0;
    const accepts = ds.filter((d) => d.action === 'accept').length;
    return accepts / ds.length;
  }
}
```

## 2. Drop the workbench on a route

```ts
@Component({
  selector: 'app-cal-page',
  imports: [CalWorkbenchComponent, DocPreviewComponent],
  template: `
    <mvk-cal-workbench
      [current]="store.current()"
      [stats]="store.stats()"
      [canNavigatePrev]="store.cursor() > 0"
      [canNavigateNext]="store.cursor() + 1 < store.batch().length"
      (decision)="store.recordDecision($event)"
      (navigate)="store.moveBy($event)"
      (advance)="store.advance()">
      @if (store.current(); as p) {
        <app-doc-preview slot="document" [docId]="p.itemId" />
      }
    </mvk-cal-workbench>
  `,
})
class CalPage {
  protected readonly store = inject(CalStore);
}
```

The workbench:

- Renders the round number + `N / batchSize` tagged + an agreement-rate progress bar.
- Mounts the host's `[slot=document]` payload on the left (typically a doc preview component).
- Renders the agent's `predictedLabel` + confidence chip + rationale + summary on the right.
- Three primary actions: **Accept** (green), **Reject + Correct** (red, opens a two-click correction picker), **Skip** (neutral).
- Prev/Next navigation within the batch.
- **Train next round** button (overridable label) — emits `(advance)` so the host kicks off retrain.

## 3. The two-click reject

Reject opens an inline correction picker showing the proposal's `alternatives` (or a fallback `not-<label>` when none supplied). Click an alternative → emits `decision({ action: 'reject', correctedTo: 'work-product' })`. Click Cancel → closes without emitting. This pattern prevents accidental misclassification.

## 4. Convergence locking

When `stats.converged === true`:

- The host sets the converged badge in the header.
- All three primary action buttons disable.
- The empty-state copy reads *"Training converged — every batch's deltas have stabilised."*
- The advance button stays clickable in case the host wants to allow manual re-runs (apps can wire a different policy by setting `showAdvance: false`).

The host owns *when* to mark converged — typical heuristics: agreement-rate ≥ 95% for two consecutive rounds, or absolute disagreement count below a threshold.

## 5. Chain-hash audit — the defensibility property

Every `(decision)` emission is a candidate for a chain-hashed tool call. The store example above writes through `audit.append`, but the cleaner pattern is to dispatch through the agent's normal tool flow:

```ts
recordDecision(d: CalDecision): void {
  this.chat.sendMessage(
    `calDecision: round=${this.round()} item=${d.itemId} ` +
    `action=${d.action} corrected=${d.correctedTo ?? '-'}`,
  );
  // Cursor / batch state still mutates locally.
  this._decisions.update((prev) => [...prev, d]);
  this.moveNext();
}
```

Now the audit chain captures:

- The round number.
- The reviewer's identity (the active persona at the time of the call).
- The original proposal + the correction.
- The model snapshot id (passed in `args`).

Opposing counsel can replay the *exact* sequence that produced each privilege call — that's the property the eDiscovery plan's [§4 Workflow C](../plans/post-chat-surfaces-plan.md#4-complex-workflows-worth-modelling) called out as the defensibility win.

## 6. Composition with the other 17 surfaces

The workbench is one more lens onto the same registry layer:

- **`<mvk-review-queue>` (P4.A)** — first-pass items in `proposed_privileged` route into the CAL workbench. Reviewer accept/reject decisions feed back into the queue's state transitions.
- **`<mvk-smart-cell>` (P1.2)** — the privilege-confidence cell in the `Documents` table renders the **same** model output the workbench surfaced. Two surfaces, one source.
- **`<mvk-bulk-toolbar>` (P1.4)** — *"Send selection to CAL workbench"* surfaces when the reviewer multi-selects documents from the table.
- **`<mvk-assist-panel>` (P1.5)** — on a document detail route, suggests *"Open in CAL workbench"* as a next-best-action.
- **`<mvk-lifecycle-stages>` (P2.4)** — the CAL training rounds are one stage of a wider review lifecycle (*Seed → Train → Review → Re-train → Converge → Production*).
- **`<mvk-dashboard-canvas>` (P3.A)** — a tile shows *"Agreement rate by round"*, drill-down opens the workbench.
- **`<mvk-timeline-canvas>` (P4.C)** — events `kind: 'cal-decision'` surface every reviewer decision on the matter timeline.

Same registry layer, same persona scope, same audit chain. **Eleven composable surfaces, one privilege-review workflow.**

## 7. Reference

- **Component:** `<mvk-cal-workbench [current] [stats] [advanceLabel] [canNavigatePrev] [canNavigateNext] [showAdvance] (decision) (navigate) (advance) />`
- **Document slot:** `<your-doc-preview slot="document" />` — projects into the left pane
- **Types:** `CalProposal`, `CalDecision`, `CalRoundStats`
- **Tests:** 24 specs covering: round/tagged/agreement header rendering, percent-or-fraction agreement input, converged badge + lock, document slot projection, doc-head title+id, predicted label + confidence formatting, low/medium/high confidence buckets, rationale + summary, accept/reject/skip dispatches, reject two-click flow (open picker → confirm or cancel), alternatives + fallback "not-<label>", convergence disables decision buttons, prev/next emit ±1, custom advanceLabel, showAdvance toggle, empty + converged copy
- **Plan:** [post-chat-surfaces-plan §4 Workflow C](../plans/post-chat-surfaces-plan.md#4-complex-workflows-worth-modelling)
- **Related:**
  - [Multi-reviewer review queue](./review-queue.md) — feeds items into the CAL workbench
  - [Smart cells](./smart-cell.md) — surfaces the same model output in tables
  - [Lifecycle stages](./lifecycle-stages.md) — CAL is one stage of the review lifecycle
