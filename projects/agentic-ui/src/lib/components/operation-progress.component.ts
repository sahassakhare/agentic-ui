import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { OperationRegistry } from '../internal';

/**
 * Inline progress widget for a long-running operation (Capability F5 —
 * r3 plan §9.5).
 *
 * Subscribes to the renderer-scoped (or root-scoped) `OperationRegistry`
 * and renders four lifecycle states:
 *
 *   - `started`  — waiting for first progress update
 *   - `progress` — live progress bar with percentage + phase + ETA
 *   - `finished` — terminal-success summary with duration
 *   - `failed`   — terminal-error with code + message
 *
 * The chat-shell renders this inline whenever a tool returns
 * `components: [{ name: 'mvk-operation-progress', props: { opId } }]`.
 *
 * Hosts that don't wire `OperationRegistry` see the "unknown operation"
 * placeholder — same affordance as `<mvk-widget-container>` uses for
 * unresolved widgets.
 */
@Component({
  selector: 'mvk-operation-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (op(); as o) {
      <article class="op" [attr.data-status]="o.status">
        <header>
          <span class="badge" [attr.data-status]="o.status">{{ o.status }}</span>
          <strong>{{ o.description }}</strong>
          <span class="tool">{{ o.toolName }}</span>
        </header>

        @if (o.status === 'started' || o.status === 'progress') {
          <div class="bar" role="progressbar"
               [attr.aria-valuenow]="o.pct ?? 0"
               aria-valuemin="0" aria-valuemax="100">
            <div class="fill" [style.width.%]="o.pct ?? 0"></div>
          </div>
          <p class="status-line">
            <strong>{{ pctLabel() }}</strong>
            @if (o.phase) { · {{ o.phase }} }
            @if (etaLabel(); as eta) { · ETA {{ eta }} }
          </p>
        } @else if (o.status === 'finished') {
          <p class="status-line ok">
            <strong>Completed</strong>
            @if (o.durationMs !== undefined) { · {{ humanDuration(o.durationMs) }} }
          </p>
        } @else if (o.status === 'failed') {
          <p class="status-line error" role="alert">
            <strong>Failed</strong>
            @if (o.error) { · <code>{{ o.error.code }}</code> — {{ o.error.message }} }
          </p>
        }
      </article>
    } @else {
      <p class="missing">Unknown operation: {{ opId() }}</p>
    }
  `,
  styles: `
    :host { display: block; }
    .op {
      padding: 0.7rem 0.9rem; border: 1px solid #d1d5db;
      border-radius: 0.5rem; background: #fff; margin-top: 0.5rem;
      font: 0.88rem system-ui; border-left: 4px solid #2563eb;
    }
    .op[data-status="finished"] { border-left-color: #16a34a; }
    .op[data-status="failed"]   { border-left-color: #dc2626; }
    header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; background: #dbeafe; color: #1e3a8a; }
    .badge[data-status="finished"] { background: #d1fae5; color: #065f46; }
    .badge[data-status="failed"]   { background: #fee2e2; color: #991b1b; }
    .tool { font-size: 0.78em; color: #6b7280; margin-left: auto; font-family: ui-monospace, monospace; }
    .bar { width: 100%; height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; margin-bottom: 0.4rem; }
    .fill { height: 100%; background: #2563eb; transition: width 200ms ease-out; }
    .status-line { margin: 0; font-size: 0.85rem; color: #374151; }
    .status-line.ok { color: #065f46; }
    .status-line.error { color: #991b1b; }
    .status-line code { font-family: ui-monospace, monospace; font-size: 0.78em; padding: 1px 5px; background: #fee2e2; border-radius: 3px; }
    .missing { padding: 0.4rem; background: #fef3c7; color: #92400e; border-radius: 0.3rem; font-size: 0.85rem; }
  `,
})
export class OperationProgressComponent {
  readonly opId = input.required<string>();
  private readonly registry = inject(OperationRegistry);

  protected readonly op = computed(() => this.registry.get(this.opId()));

  /** "{n}%" — clamped 0..100. */
  protected pctLabel = computed(() => {
    const o = this.op();
    if (!o) return '0%';
    const pct = o.pct ?? 0;
    return `${Math.round(pct)}%`;
  });

  /**
   * Heuristic ETA from `estDurationMs` and current `pct`. Returns
   * `undefined` until enough progress has accumulated for the estimate
   * to be meaningful.
   */
  protected etaLabel = computed<string | undefined>(() => {
    const o = this.op();
    if (!o) return undefined;
    const pct = o.pct ?? 0;
    if (pct < 1 || pct >= 100) return undefined;
    if (!o.estDurationMs) {
      // Derive from elapsed-vs-pct.
      const elapsed = Date.now() - Date.parse(o.startedAt);
      if (!Number.isFinite(elapsed) || elapsed < 1000) return undefined;
      const remaining = (elapsed / pct) * (100 - pct);
      return humanDurationStatic(remaining);
    }
    const remaining = (o.estDurationMs * (100 - pct)) / 100;
    return humanDurationStatic(remaining);
  });

  protected humanDuration(ms: number): string {
    return humanDurationStatic(ms);
  }
}

function humanDurationStatic(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS === 0 ? `${m}m` : `${m}m ${remS}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM === 0 ? `${h}h` : `${h}h ${remM}m`;
}
