import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActionRegistry, type ActionContext } from '@maverick/agentic-ui';

/**
 * Generative-UI widget for a production set. Rendered when
 * `createProductionSet` / `assignBatesNumbers` / `exportProductionSet`
 * return `components: [{ name: 'productionSummary', props }]`.
 * Click → dispatches the host's `openProduction` action.
 */
@Component({
  selector: 'app-production-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card" [attr.data-status]="status()"
             role="button" tabindex="0"
             (click)="open()" (keydown.enter)="open()" (keydown.space)="open()">
      <header>
        <span class="badge">production</span>
        <strong>{{ name() }}</strong>
        <span class="status">{{ status() }}</span>
      </header>
      <div class="grid">
        <dl>
          <dt>ID</dt><dd><code>{{ productionId() }}</code></dd>
          <dt>Format</dt><dd><span class="format-pill" [attr.data-fmt]="format()">{{ format() }}</span></dd>
          <dt>Bates</dt><dd><code>{{ batesPattern() }}</code></dd>
          <dt>Documents</dt><dd><strong>{{ documentCount() }}</strong></dd>
          <dt>Created</dt><dd>{{ createdShort() }}</dd>
        </dl>
      </div>
      <footer>
        <div class="lifecycle">
          <span class="step" [class.done]="step() >= 1"><span class="dot">1</span> created</span>
          <span class="line"></span>
          <span class="step" [class.done]="step() >= 2"><span class="dot">2</span> bates</span>
          <span class="line"></span>
          <span class="step" [class.done]="step() >= 3"><span class="dot">3</span> finalised</span>
          <span class="line"></span>
          <span class="step" [class.done]="step() >= 4"><span class="dot">4</span> delivered</span>
        </div>
        <span class="cta">Open production →</span>
      </footer>
    </article>
  `,
  styles: `
    .card {
      padding: 0.7rem 0.9rem; border: 1px solid #d1d5db;
      border-radius: 0.5rem; background: #fff; margin-top: 0.5rem;
      font: 0.86rem system-ui; border-left: 4px solid #4f46e5;
      cursor: pointer; transition: background 120ms ease-out, border-color 120ms ease-out, transform 120ms ease-out;
    }
    .card:hover { background: #eef2ff; border-color: #c7d2fe; }
    .card:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
    .card:active { transform: translateY(1px); }
    .card[data-status="delivered"] { border-left-color: #059669; }
    .card[data-status="finalized"] { border-left-color: #d97706; }
    .card[data-status="review"]    { border-left-color: #4f46e5; }
    .card[data-status="draft"]     { border-left-color: #94a3b8; }
    header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.45rem; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; background: #ede9fe; color: #5b21b6; text-transform: uppercase; letter-spacing: 0.04em; }
    .status {
      font-size: 0.7em; padding: 1px 8px; border-radius: 999px;
      background: #f1f5f9; color: #475569; margin-left: auto;
      text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
    }
    .card[data-status="delivered"] .status { background: #d1fae5; color: #065f46; }
    .card[data-status="finalized"] .status { background: #fef3c7; color: #92400e; }
    .card[data-status="review"] .status    { background: #dbeafe; color: #1e3a8a; }

    .grid { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.55rem 0.7rem; }
    dl { margin: 0; display: grid; grid-template-columns: 4.5rem 1fr 4.5rem 1fr; gap: 0.25rem 0.7rem; font-size: 0.78em; }
    dt { color: #64748b; font-weight: 500; }
    dd { margin: 0; color: #0f172a; word-break: break-all; }
    code { font-family: ui-monospace, monospace; font-size: 0.92em; }
    .format-pill { padding: 1px 6px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.92em; background: #e0e7ff; color: #3730a3; text-transform: uppercase; letter-spacing: 0.04em; }
    .format-pill[data-fmt="tiff"]      { background: #fef3c7; color: #92400e; }
    .format-pill[data-fmt="pdf"]       { background: #fecaca; color: #991b1b; }
    .format-pill[data-fmt="native"]    { background: #d1fae5; color: #065f46; }
    .format-pill[data-fmt="load-file"] { background: #ede9fe; color: #5b21b6; }

    footer { margin-top: 0.5rem; padding-top: 0.45rem; border-top: 1px dashed #e2e8f0; display: flex; justify-content: space-between; align-items: center; gap: 0.7rem; }
    .lifecycle { display: flex; align-items: center; gap: 0.25rem; font-size: 0.7em; color: #94a3b8; }
    .step { display: inline-flex; align-items: center; gap: 4px; }
    .step .dot {
      width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;
      border-radius: 999px; background: #e2e8f0; color: #94a3b8;
      font-size: 0.65rem; font-weight: 700;
    }
    .step.done .dot { background: #4f46e5; color: white; }
    .step.done { color: #4f46e5; }
    .line { width: 14px; height: 1px; background: #e2e8f0; }
    .cta { color: #4f46e5; font-size: 0.78em; font-weight: 500; opacity: 0; transition: opacity 120ms ease-out; }
    .card:hover .cta, .card:focus-visible .cta { opacity: 1; }
  `,
})
export class ProductionSummaryComponent {
  readonly productionId = input.required<string>();
  readonly name = input.required<string>();
  readonly format = input.required<string>();
  readonly batesPattern = input.required<string>();
  readonly documentCount = input.required<number>();
  readonly status = input.required<string>();
  readonly createdAt = input.required<string>();

  protected readonly step = computed(() => {
    switch (this.status()) {
      case 'delivered': return 4;
      case 'finalized': return 3;
      case 'review':    return 2;
      case 'draft':     return 1;
      default:          return 0;
    }
  });
  protected readonly createdShort = computed(() => {
    const d = new Date(this.createdAt());
    return Number.isNaN(d.getTime()) ? this.createdAt() :
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  });

  private readonly actions = inject(ActionRegistry);

  open(): void {
    const action = this.actions.get('openProduction');
    if (!action) return;                 // standalone mode — no host route
    const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ctx: ActionContext = {
      threadId: 'widget', runId: id, actionId: id,
      signal: new AbortController().signal,
    };
    void action.effect({ productionId: this.productionId() }, ctx);
  }
}
