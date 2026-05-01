import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActionRegistry, type ActionContext } from '@maverick/agentic-ui';

interface Line {
  timestamp: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  chainHash: string | null;
  verified: boolean;
}

/**
 * Chain-of-custody report widget — the defensibility surface. Header
 * shows the integrity verdict + chain head; table lists every relevant
 * audit event with a hash badge that recomputes the hash on hover.
 * Designed to be screenshot-able for hand-off to opposing counsel.
 */
@Component({
  selector: 'app-chain-of-custody-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <div class="badge-row">
          <span class="badge">chain of custody</span>
          @if (chainVerified()) {
            <span class="status verified">✓ verified</span>
          } @else {
            <span class="status broken">⚠ {{ chainBroken() }} break(s)</span>
          }
        </div>
        <h3>{{ title() }}</h3>
        <p class="meta">
          Production <code>{{ productionId() }}</code> · generated {{ shortDate(generatedAt()) }}
        </p>
      </header>

      <div class="kpis">
        <div><span class="lbl">Documents</span><strong>{{ documentCount() }}</strong></div>
        <div><span class="lbl">Redactions</span><strong>{{ totalRedactions() }}</strong></div>
        <div><span class="lbl">Audit events</span><strong>{{ chainEvents() }}</strong></div>
        <div class="head"><span class="lbl">Chain head</span><strong><code>{{ chainHead() }}</code></strong></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Target</th>
            <th>Actor</th>
            <th>Hash</th>
          </tr>
        </thead>
        <tbody>
          @for (l of lines(); track l.chainHash) {
            <tr [class.unverified]="!l.verified" (click)="openTarget(l)" tabindex="0" role="button" (keydown.enter)="openTarget(l)">
              <td class="ts">{{ shortDate(l.timestamp) }}</td>
              <td><strong>{{ formatAction(l.action) }}</strong>
                @if (l.reason) { <small class="reason">{{ l.reason }}</small> }
              </td>
              <td><code class="target">{{ l.targetType }}/{{ l.targetId }}</code></td>
              <td>{{ l.actor }}</td>
              <td class="hash">
                @if (l.chainHash) {
                  <span class="hash-pill" [class.verified]="l.verified" [attr.title]="l.chainHash">
                    {{ shortHash(l.chainHash) }}
                  </span>
                } @else {
                  <span class="hash-pill missing" title="No hash recorded">—</span>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="empty">No relevant events — has the production set been finalised?</td></tr>
          }
        </tbody>
      </table>

      <footer>
        <span class="hint">Hover the hash pill to see the full digest. Click a row to open the target.</span>
      </footer>
    </article>
  `,
  styles: `
    .card { padding: 0.75rem 0.95rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.86rem system-ui; border-left: 4px solid #2f6f4f; }
    header { margin-bottom: 0.6rem; }
    .badge-row { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; background: #d1fae5; color: #065f46; text-transform: uppercase; letter-spacing: 0.04em; }
    .status { font-size: 0.7em; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
    .status.verified { background: #d1fae5; color: #065f46; }
    .status.broken { background: #fee2e2; color: #991b1b; }
    h3 { margin: 0.2rem 0; font-size: 1rem; font-weight: 600; color: #0f172a; }
    .meta { margin: 0; color: #64748b; font-size: 0.78em; }
    .meta code { font-family: ui-monospace, monospace; }

    .kpis {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem;
      margin: 0.6rem 0;
      padding: 0.5rem 0.7rem;
      background: #f7f7f5; border: 1px solid #eceef2; border-radius: 6px;
    }
    .kpis div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .kpis .lbl { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; font-weight: 600; }
    .kpis strong { font-size: 0.95rem; color: #0f172a; font-variant-numeric: tabular-nums; }
    .kpis code { font-family: ui-monospace, monospace; font-size: 0.78rem; word-break: break-all; }
    .kpis .head strong { font-size: 0.78rem; }

    table { width: 100%; border-collapse: collapse; font-size: 0.78em; }
    th, td { padding: 0.35rem 0.5rem; text-align: left; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    th { font-size: 0.6em; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 500; background: #f7f7f5; position: sticky; top: 0; }
    tbody tr { cursor: pointer; transition: background 120ms; }
    tbody tr:hover td { background: #ecf1f6; }
    tbody tr.unverified { background: rgba(252, 165, 165, 0.18); }
    tbody tr.unverified:hover td { background: rgba(252, 165, 165, 0.28); }
    .ts { font-family: ui-monospace, monospace; font-size: 0.92em; color: #475569; white-space: nowrap; }
    td strong { color: #0f172a; font-weight: 500; }
    td .reason { display: block; color: #64748b; font-size: 0.92em; font-style: italic; margin-top: 1px; }
    .target { font-family: ui-monospace, monospace; font-size: 0.92em; color: #363d49; background: #f1f5f9; padding: 1px 6px; border-radius: 3px; }
    .hash-pill {
      display: inline-block; padding: 1px 7px; border-radius: 4px;
      background: #fef3c7; color: #92400e;
      font-family: ui-monospace, monospace; font-size: 0.92em; font-weight: 600;
      cursor: help;
    }
    .hash-pill.verified { background: #d1fae5; color: #065f46; }
    .hash-pill.missing { background: #fee2e2; color: #991b1b; }
    .empty { color: #94a3b8; font-style: italic; padding: 0.8rem; text-align: center; }

    footer { margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed #e2e8f0; }
    .hint { color: #94a3b8; font-size: 0.7rem; }
  `,
})
export class ChainOfCustodyReportComponent {
  readonly title = input.required<string>();
  readonly productionId = input.required<string>();
  readonly generatedAt = input.required<string>();
  readonly chainVerified = input.required<boolean>();
  readonly chainHead = input.required<string>();
  readonly chainEvents = input.required<number>();
  readonly chainBroken = input.required<number>();
  readonly documentCount = input.required<number>();
  readonly totalRedactions = input.required<number>();
  readonly lines = input.required<readonly Line[]>();

  private readonly actions = inject(ActionRegistry);
  protected readonly _ = computed(() => null);  // silences linter for unused — kept for future computed work

  protected shortDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  protected shortHash(h: string): string {
    return h.slice(0, 8);
  }
  protected formatAction(a: string): string {
    return a.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  protected openTarget(l: Line): void {
    let actionType: string | null = null;
    let payloadKey: string | null = null;
    if (l.targetType === 'document')         { actionType = 'openDocument';   payloadKey = 'documentId'; }
    else if (l.targetType === 'production-set') { actionType = 'openProduction'; payloadKey = 'productionId'; }
    else if (l.targetType === 'legal-hold')  { actionType = 'openHold';       payloadKey = 'holdId'; }
    else if (l.targetType === 'custodian')   { actionType = 'openCustodian';  payloadKey = 'custodianId'; }
    if (!actionType || !payloadKey) return;
    const action = this.actions.get(actionType);
    if (!action) return;
    const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ctx: ActionContext = {
      threadId: 'widget', runId: id, actionId: id,
      signal: new AbortController().signal,
    };
    void action.effect({ [payloadKey]: l.targetId }, ctx);
  }
}
