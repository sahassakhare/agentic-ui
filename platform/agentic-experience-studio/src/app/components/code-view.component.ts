import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Read-only source view for a capability body (or any value). Pretty-prints and
 * syntax-highlights JSON with zero dependencies (a small tokenizer → spans, all
 * content HTML-escaped first so it's CSP-safe), with copy-to-clipboard. Used to
 * expose the underlying definition behind every designer/section — the same JSON
 * the runtime and agents consume.
 */
@Component({
  selector: 'aes-code-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="cv">
      <div class="cv-bar">
        <span class="cv-lang">{{ language() }}</span>
        @if (label()) { <span class="cv-label">{{ label() }}</span> }
        <span class="cv-sp"></span>
        <span class="cv-meta">{{ lineCount() }} lines · {{ text().length }} chars</span>
        <button matIconButton type="button" class="cv-copy" (click)="copy()"
          [matTooltip]="copied() ? 'Copied' : 'Copy to clipboard'" aria-label="Copy code">
          <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
        </button>
      </div>
      <pre class="cv-pre"><code [innerHTML]="html()"></code></pre>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .cv { border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); }
    .cv-bar { display: flex; align-items: center; gap: var(--s2); padding: 4px 6px 4px 12px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .cv-lang { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--brand);
      background: var(--brand-soft); padding: 1px 7px; border-radius: var(--r-full); }
    .cv-label { font-size: var(--fs-xs); color: var(--text-muted); }
    .cv-sp { flex: 1; }
    .cv-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
    .cv-copy { --mdc-icon-button-state-layer-size: 32px; }
    .cv-copy mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .cv-pre { margin: 0; padding: 12px 14px; overflow-x: auto; max-height: 460px; overflow-y: auto; }
    .cv-pre code { font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: var(--text); white-space: pre; tab-size: 2; }
    .cv-pre .tok-key { color: var(--brand); }
    .cv-pre .tok-str { color: var(--ok, #16a34a); }
    .cv-pre .tok-num { color: var(--warn, #b45309); }
    .cv-pre .tok-bool { color: #a855f7; font-weight: 600; }
    .cv-pre .tok-null { color: var(--text-faint); font-style: italic; }
    :root[data-theme="dark"] .cv-pre .tok-str, :host-context(:root:not([data-theme="light"])) .cv-pre .tok-str { color: #4ade80; }
  `],
})
export class CodeViewComponent {
  private readonly sanitizer = inject(DomSanitizer);

  /** The value to show — an object (pretty-printed as JSON) or a raw string. */
  readonly value = input.required<unknown>();
  readonly language = input<'json' | 'text'>('json');
  /** Optional caption shown in the toolbar (e.g. the capability name/kind). */
  readonly label = input<string>('');

  readonly copied = signal(false);

  readonly text = computed<string>(() => {
    const v = this.value();
    if (this.language() === 'text' || typeof v === 'string') return String(v ?? '');
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  });
  readonly lineCount = computed(() => this.text().split('\n').length);
  readonly html = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      this.language() === 'json' ? highlightJson(this.text()) : escapeHtml(this.text()),
    ),
  );

  copy(): void {
    const write = navigator.clipboard?.writeText(this.text());
    Promise.resolve(write).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    }).catch(() => { /* clipboard blocked — no-op */ });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Classic dependency-free JSON highlighter — runs over already-escaped text. */
function highlightJson(json: string): string {
  const esc = escapeHtml(json);
  return esc.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'num';
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'key' : 'str';
      else if (/true|false/.test(match)) cls = 'bool';
      else if (/null/.test(match)) cls = 'null';
      return `<span class="tok-${cls}">${match}</span>`;
    },
  );
}
