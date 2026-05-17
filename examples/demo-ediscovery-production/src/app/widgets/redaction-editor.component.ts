import { AfterViewInit, ChangeDetectionStrategy, Component, computed, effect, ElementRef, input, viewChild } from '@angular/core';

interface Span {
  page: number;
  bbox: [number, number, number, number];
  reason: 'pii' | 'privilege' | 'confidential' | string;
}

const PAGE_W = 612;        // standard US-letter width in points
const PAGE_H = 792;
const CANVAS_W = 320;      // display width (points scaled)
const CANVAS_H = (CANVAS_W * PAGE_H) / PAGE_W;

const REASON_COLORS: Record<string, string> = {
  pii:           'rgba(220, 38, 38, 0.55)',     // red
  privilege:     'rgba(124, 58, 237, 0.55)',    // violet
  confidential:  'rgba(217, 119, 6, 0.55)',     // amber
};

/**
 * HTML5-canvas redaction overlay. Renders a stylised page (mock —
 * the demo doesn't ship a PDF rasteriser) and overlays every
 * redaction span as a translucent rectangle colour-coded by reason.
 *
 * @remarks
 * A real eDiscovery vendor would render the doc's actual page bitmap
 * underneath; that's out of scope for the library demo. The seam —
 * a canvas component reading `redactions` and an action click that
 * adds new spans — is the same in both worlds.
 */
@Component({
  selector: 'app-redaction-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="badge">redaction overlay</span>
        <strong>{{ fileName() }}</strong>
        <span class="page">page {{ page() }}</span>
      </header>
      <div class="layout">
        <div class="canvas-wrap">
          <canvas #canvas [width]="canvasW" [height]="canvasH"></canvas>
        </div>
        <div class="legend">
          <p class="caption">Spans on this page ({{ pageRedactions().length }})</p>
          <ul>
            @for (s of pageRedactions(); track $index) {
              <li>
                <span class="swatch" [style.background]="color(s.reason)"></span>
                <code>{{ s.bbox[0] }},{{ s.bbox[1] }} · {{ s.bbox[2] }}×{{ s.bbox[3] }}</code>
                <span class="reason">{{ s.reason }}</span>
              </li>
            } @empty {
              <li class="muted">No spans on this page yet.</li>
            }
          </ul>
          <p class="caption" style="margin-top: 0.5rem;">Latest applied</p>
          <p class="latest">
            <code>page {{ page() }}</code> ·
            <code>[{{ bbox()[0] }}, {{ bbox()[1] }}, {{ bbox()[2] }}, {{ bbox()[3] }}]</code>
            <span class="reason-pill" [style.background]="color(reason())">{{ reason() }}</span>
          </p>
        </div>
      </div>
      <footer>
        <code>{{ documentId() }}</code> · <strong>{{ allRedactions().length }}</strong> redaction(s) total
      </footer>
    </article>
  `,
  styles: `
    .card { padding: 0.7rem 0.9rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.86rem system-ui; border-left: 4px solid #7c3aed; }
    header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; background: #ede9fe; color: #5b21b6; text-transform: uppercase; letter-spacing: 0.04em; }
    .page { margin-left: auto; font-size: 0.7em; color: #64748b; padding: 1px 7px; background: #f1f5f9; border-radius: 4px; }

    .layout { display: grid; grid-template-columns: auto 1fr; gap: 0.7rem; align-items: start; }
    .canvas-wrap { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0.3rem; line-height: 0; }
    canvas { display: block; }

    .legend { font-size: 0.78em; color: #475569; }
    .caption { margin: 0 0 0.25rem; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; font-weight: 600; }
    .legend ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.2rem; max-height: 100px; overflow-y: auto; }
    .legend li { display: flex; align-items: center; gap: 0.35rem; font-size: 0.78em; }
    .legend .muted { color: #94a3b8; font-style: italic; }
    .swatch { width: 12px; height: 10px; border-radius: 2px; border: 1px solid rgba(0,0,0,0.1); flex-shrink: 0; }
    .legend code { font-family: ui-monospace, monospace; font-size: 0.92em; color: #334155; }
    .reason { color: #64748b; }
    .latest code { font-family: ui-monospace, monospace; font-size: 0.92em; color: #334155; padding: 1px 5px; background: #f1f5f9; border-radius: 3px; }
    .reason-pill { color: white; padding: 1px 7px; border-radius: 999px; margin-left: 4px; font-size: 0.7em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }

    footer { margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px dashed #e2e8f0; color: #94a3b8; font-size: 0.75em; }
    footer code { font-family: ui-monospace, monospace; font-size: 0.95em; }
    footer strong { color: #475569; }
  `,
})
export class RedactionEditorComponent implements AfterViewInit {
  readonly documentId = input.required<string>();
  readonly fileName = input.required<string>();
  readonly page = input.required<number>();
  readonly bbox = input.required<readonly [number, number, number, number]>();
  readonly reason = input.required<string>();
  readonly allRedactions = input.required<readonly Span[]>();

  protected readonly canvasW = CANVAS_W;
  protected readonly canvasH = CANVAS_H;
  protected readonly pageRedactions = computed(() =>
    this.allRedactions().filter((s) => s.page === this.page()),
  );

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  protected color(reason: string): string {
    return REASON_COLORS[reason] ?? 'rgba(100, 116, 139, 0.55)';
  }

  ngAfterViewInit(): void { this.draw(); }

  private readonly _redraw = effect(() => {
    // Reading the inputs to subscribe; ngAfterViewInit triggers initial paint.
    this.allRedactions(); this.page(); this.bbox();
    this.draw();
  });

  private draw(): void {
    const c = this.canvas().nativeElement;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Stylised "page" — light grey paper with horizontal text rules.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, CANVAS_W - 1, CANVAS_H - 1);

    // Fake text rules
    ctx.strokeStyle = '#f1f5f9';
    for (let y = 32; y < CANVAS_H - 24; y += 14) {
      ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(CANVAS_W - 20, y); ctx.stroke();
    }
    // Header line
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(20, 14, CANVAS_W * 0.55, 8);

    // Spans for this page — translucent fills.
    const sx = CANVAS_W / PAGE_W;
    const sy = CANVAS_H / PAGE_H;
    for (const s of this.pageRedactions()) {
      ctx.fillStyle = this.color(s.reason);
      ctx.fillRect(s.bbox[0] * sx, s.bbox[1] * sy, s.bbox[2] * sx, s.bbox[3] * sy);
    }
    // Latest span outlined for emphasis
    const b = this.bbox();
    if (b && b.length === 4) {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy);
    }
  }
}
