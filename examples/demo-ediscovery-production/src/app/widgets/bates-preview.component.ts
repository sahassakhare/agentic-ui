import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Generative-UI widget showing Bates assignment range. Rendered when
 * `assignBatesNumbers` returns `components: [{ name: 'batesPreview', props }]`.
 *
 * Pure presentational — clicking does nothing useful (a single Bates
 * range isn't navigable on its own; the production summary card is
 * the navigation surface).
 */
@Component({
  selector: 'app-bates-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="badge">bates assignment</span>
        <strong>{{ count() }} ids</strong>
        <code class="pat">{{ pattern() }}</code>
      </header>
      <div class="range">
        <span class="bound">
          <span class="lbl">First</span>
          <code>{{ first() || '—' }}</code>
        </span>
        <span class="arrow">→</span>
        <span class="bound">
          <span class="lbl">Last</span>
          <code>{{ last() || '—' }}</code>
        </span>
      </div>
      @if (sample().length > 0) {
        <div class="sample">
          <span class="lbl">Sample</span>
          <ul>
            @for (id of sample(); track id) { <li><code>{{ id }}</code></li> }
            @if (count() > sample().length) {
              <li class="more">… +{{ count() - sample().length }} more</li>
            }
          </ul>
        </div>
      }
      <footer>
        Production: <code>{{ productionId() }}</code>
      </footer>
    </article>
  `,
  styles: `
    .card { padding: 0.7rem 0.9rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.86rem system-ui; border-left: 4px solid #d97706; }
    header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; background: #fef3c7; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; }
    .pat { margin-left: auto; font-family: ui-monospace, monospace; font-size: 0.8em; color: #475569; background: #f1f5f9; padding: 1px 6px; border-radius: 3px; }
    code { font-family: ui-monospace, monospace; font-size: 0.92em; }
    .range {
      display: flex; align-items: center; justify-content: center; gap: 0.6rem;
      padding: 0.55rem; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px;
    }
    .bound { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .lbl { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; color: #92400e; font-weight: 600; }
    .bound code { font-size: 0.95em; color: #92400e; font-weight: 600; letter-spacing: 0.02em; }
    .arrow { color: #d97706; font-weight: 700; font-size: 1.1em; }

    .sample { margin-top: 0.5rem; }
    .sample .lbl { display: block; margin-bottom: 0.25rem; color: #64748b; }
    .sample ul { list-style: none; margin: 0; padding: 0; display: flex; gap: 0.3rem; flex-wrap: wrap; }
    .sample li { padding: 1px 6px; background: #f1f5f9; border-radius: 3px; font-size: 0.78em; }
    .sample .more { color: #94a3b8; font-style: italic; background: transparent; padding-left: 0; }

    footer { margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px dashed #e2e8f0; color: #94a3b8; font-size: 0.75em; }
  `,
})
export class BatesPreviewComponent {
  readonly productionId = input.required<string>();
  readonly pattern = input.required<string>();
  readonly first = input.required<string>();
  readonly last = input.required<string>();
  readonly count = input.required<number>();
  readonly sample = input.required<readonly string[]>();
}
