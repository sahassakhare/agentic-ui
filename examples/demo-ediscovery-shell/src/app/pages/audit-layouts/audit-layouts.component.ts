import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LayoutAuditTracker } from '@infra-tools/agentic-ui';

/**
 * ADR-046 PR3 D4 — viewer for the `LAYOUT_APPLIED` chain captured by
 * `LayoutAuditTracker`. Two main affordances:
 *
 *  1. Chain list — every emitted event in oldest-first order, with
 *     attribution (who / route / matter), the resolved slot names,
 *     and prev/chain hash links so a reviewer can verify integrity.
 *
 *  2. Time-travel scrubber — paste any ISO timestamp + click
 *     "snapshot" to see the resolved layout state as-of that moment.
 *     Backed by `LayoutAuditTracker.snapshotAt`. Lets compliance ask
 *     "what did the user see at 14:30Z" and get a deterministic answer.
 *
 * Chain integrity badge — `validateChain()` reports null on a good
 * chain or the first broken event; rendered as a single green/red
 * pill above the list.
 */
@Component({
  selector: 'app-audit-layouts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-head">
      <p class="crumb">Audit · Layouts</p>
      <h1>Layout audit trail</h1>
      <p class="muted">
        Every change to the resolved layout — agent-driven, route-driven, persona-driven,
        contextual — is captured here as a chain-hashed event. Use the scrubber on the
        right to ask "what did the user see at this moment?"
      </p>
    </section>

    <div class="chain-integrity" [class.broken]="brokenEvent() !== null">
      <span class="dot" aria-hidden="true">●</span>
      @if (brokenEvent() === null) {
        <strong>Chain integrity OK.</strong>
        <span class="dim"> {{ chain().length }} event(s) captured. Every prevHash → chainHash link verified.</span>
      } @else {
        <strong>Chain broken at event {{ brokenEvent()?.id }}.</strong>
        <span class="dim"> Investigation required — event prevHash does not match the prior event's chainHash.</span>
      }
    </div>

    <div class="layout">
      <section class="list" aria-label="Layout audit events">
        <h2>Chain ({{ chain().length }})</h2>
        @if (chain().length === 0) {
          <p class="empty">No layout audit events yet. Navigate around the app — every resolved layout change is recorded.</p>
        }
        <ol class="events">
          @for (event of chain(); track event.id; let i = $index) {
            <li class="event" [class.selected]="selectedId() === event.id" (click)="selectedId.set(event.id)">
              <header>
                <span class="seq">#{{ i + 1 }}</span>
                <time>{{ event.timestamp }}</time>
              </header>
              <div class="slot-summary">
                @for (slot of slotNamesOf(event); track slot) {
                  <span class="slot-pill">{{ slot }}</span>
                }
                @if (slotNamesOf(event).length === 0) {
                  <span class="slot-pill empty-slots">(empty)</span>
                }
              </div>
              <div class="attribution">
                <span class="att-row" *ngIf="event.attribution?.['userId']">
                  <span class="key">user</span> {{ event.attribution?.['userId'] }}
                </span>
                <span class="att-row" *ngIf="event.attribution?.['route']">
                  <span class="key">route</span> {{ event.attribution?.['route'] }}
                </span>
              </div>
              <div class="hash-row">
                <span class="hash">prev <code>{{ event.prevHash ?? '—' }}</code></span>
                <span class="hash">chain <code>{{ event.chainHash }}</code></span>
              </div>
            </li>
          }
        </ol>
      </section>

      <aside class="detail" aria-label="Snapshot inspector">
        <h2>Snapshot inspector</h2>
        <p class="muted small">
          Pick an event on the left, or scrub by timestamp below.
        </p>

        <label class="scrub">
          <span>Timestamp (ISO 8601)</span>
          <input type="text" [(ngModel)]="scrubTs"
                 placeholder="2026-05-15T14:30:00.000Z"
                 (keyup.enter)="scrub()" />
          <button type="button" class="btn" (click)="scrub()">Snapshot at-or-before</button>
        </label>

        @if (snapshot()) {
          <div class="snapshot-info">
            <h3>Event {{ snapshot()?.id }}</h3>
            <p><strong>Timestamp:</strong> <time>{{ snapshot()?.timestamp }}</time></p>
            <p><strong>Chain hash:</strong> <code>{{ snapshot()?.chainHash }}</code></p>

            <h4>Resolved slots</h4>
            <pre>{{ formatSlots(snapshot()?.slots) }}</pre>

            <h4>Applied rules</h4>
            <ol class="rules">
              @for (rule of snapshot()?.appliedRules ?? []; track rule.ruleId) {
                <li>
                  <strong>{{ rule.slotName }}</strong>
                  <span class="rule-source">{{ rule.source }}</span>
                  <span class="rule-weight">w={{ rule.weight }}</span>
                  <span class="rule-reason">— {{ rule.reason }}</span>
                </li>
              }
            </ol>

            @if (snapshot()?.attribution) {
              <h4>Attribution</h4>
              <pre>{{ formatAttribution(snapshot()?.attribution) }}</pre>
            }
          </div>
        } @else {
          <p class="empty">No event selected.</p>
        }
      </aside>
    </div>
  `,
  styles: `
    :host { display: block; max-width: 1400px; }
    .page-head { margin-bottom: var(--s-4); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); max-width: 760px; }
    .muted.small { font-size: var(--fs-xs); }
    .chain-integrity {
      display: flex; align-items: center; gap: var(--s-3);
      padding: var(--s-3); margin-bottom: var(--s-4);
      background: var(--c-success-soft, #d1fae5); border: 1px solid var(--c-success, #059669);
      border-left-width: 4px; border-radius: var(--r-md); font-size: var(--fs-sm);
    }
    .chain-integrity.broken {
      background: var(--c-danger-soft, #fee2e2); border-color: var(--c-danger, #dc2626);
    }
    .chain-integrity .dot { color: inherit; }
    .chain-integrity.broken .dot { color: var(--c-danger, #dc2626); }
    .chain-integrity strong { color: var(--c-text-1); }
    .chain-integrity .dim { color: var(--c-text-2); }
    .layout { display: grid; grid-template-columns: 1fr 460px; gap: var(--s-4); align-items: start; }
    .list h2, .detail h2 { font-size: var(--fs-lg); margin: 0 0 var(--s-3); }
    .events { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--s-2); }
    .event {
      padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md);
      cursor: pointer; background: var(--c-surface); transition: background 120ms;
    }
    .event:hover { background: var(--c-surface-1); }
    .event.selected { border-color: var(--c-accent, #6366f1); background: var(--c-surface-1); }
    .event header { display: flex; justify-content: space-between; align-items: baseline; font-size: var(--fs-xs); margin-bottom: var(--s-2); }
    .event .seq { color: var(--c-text-faint); font-family: ui-monospace, monospace; }
    .event time { color: var(--c-text-2); }
    .slot-summary { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-bottom: var(--s-2); }
    .slot-pill {
      padding: 1px 8px; border-radius: var(--r-sm);
      background: var(--c-surface-1); border: 1px solid var(--c-border);
      font-family: ui-monospace, monospace; font-size: 0.78rem;
    }
    .slot-pill.empty-slots { color: var(--c-text-faint); font-style: italic; }
    .attribution { display: flex; flex-direction: column; gap: 0.1rem; font-size: var(--fs-xs); color: var(--c-text-2); margin-bottom: var(--s-2); }
    .att-row .key { color: var(--c-text-faint); margin-right: 0.4rem; font-family: ui-monospace, monospace; }
    .hash-row { display: flex; gap: var(--s-3); font-size: 0.72rem; color: var(--c-text-faint); }
    .hash code { font-family: ui-monospace, monospace; }
    .detail {
      padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md);
      position: sticky; top: var(--s-3); max-height: calc(100vh - 80px); overflow: auto;
    }
    .scrub { display: flex; flex-direction: column; gap: var(--s-2); margin: var(--s-3) 0; }
    .scrub span { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--c-text-faint); }
    .scrub input {
      padding: 0.4rem 0.6rem; border: 1px solid var(--c-border); border-radius: var(--r-sm);
      font-family: ui-monospace, monospace; font-size: var(--fs-xs);
    }
    .scrub .btn {
      padding: 0.45rem 0.8rem; border: 1px solid var(--c-border); background: var(--c-surface-1);
      border-radius: var(--r-md); font-size: var(--fs-xs); cursor: pointer;
    }
    .scrub .btn:hover { background: var(--c-surface-2, var(--c-surface-1)); border-color: var(--c-accent, #6366f1); }
    .snapshot-info h3 { margin: var(--s-3) 0 var(--s-2); font-size: var(--fs-md); }
    .snapshot-info h4 { margin: var(--s-3) 0 var(--s-2); font-size: var(--fs-sm); text-transform: uppercase; letter-spacing: 0.04em; color: var(--c-text-faint); }
    .snapshot-info pre {
      background: var(--c-surface-1); padding: var(--s-2); border-radius: var(--r-sm);
      font-family: ui-monospace, monospace; font-size: 0.78rem; overflow: auto; margin: 0;
    }
    .rules { margin: 0; padding: 0 0 0 var(--s-4); font-size: var(--fs-xs); }
    .rules .rule-source {
      display: inline-block; margin-left: var(--s-2); padding: 0 var(--s-2);
      border-radius: var(--r-sm); background: var(--c-surface-1);
      font-family: ui-monospace, monospace; font-size: 0.85em;
    }
    .rules .rule-weight { margin-left: var(--s-2); color: var(--c-text-faint); font-family: ui-monospace, monospace; font-size: 0.85em; }
    .rules .rule-reason { margin-left: var(--s-2); }
    .empty { color: var(--c-text-faint); font-style: italic; font-size: var(--fs-sm); }
  `,
})
export class AuditLayoutsPage {
  private readonly tracker = inject(LayoutAuditTracker);

  protected readonly chain = this.tracker.chain;
  protected readonly brokenEvent = computed(() => this.tracker.validateChain());

  protected readonly selectedId = signal<string | null>(null);
  protected readonly scrubTs = signal<string>('');

  /**
   * Currently inspected event: either the explicit selection from the
   * list OR the result of a scrubber query. Selection wins when both
   * are set (last-action wins via signal updates).
   */
  protected readonly snapshot = computed(() => {
    const id = this.selectedId();
    if (id) return this.chain().find((e) => e.id === id) ?? null;
    return null;
  });

  protected slotNamesOf(event: { slots: Record<string, unknown> }): readonly string[] {
    return Object.keys(event.slots);
  }

  protected scrub(): void {
    const ts = this.scrubTs();
    if (!ts) return;
    const event = this.tracker.snapshotAt(ts);
    this.selectedId.set(event?.id ?? null);
  }

  protected formatSlots(slots: Record<string, unknown> | null | undefined): string {
    if (!slots) return '(none)';
    return JSON.stringify(slots, null, 2);
  }

  protected formatAttribution(attr: Record<string, string> | undefined): string {
    if (!attr) return '(none)';
    return JSON.stringify(attr, null, 2);
  }
}
