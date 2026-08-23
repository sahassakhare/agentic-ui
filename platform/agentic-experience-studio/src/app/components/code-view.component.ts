import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Source view (and optional editor) for a capability body. Pretty-prints and
 * syntax-highlights JSON with zero dependencies (a small tokenizer → spans, all
 * content HTML-escaped first so it's CSP-safe), with copy-to-clipboard.
 *
 * When `editable` is set it gains an Edit mode: a monospace textarea with live
 * JSON validation that emits the parsed body on Save — the same JSON the runtime
 * and agents consume, edited as code and written straight back to the catalog.
 */
@Component({
  selector: 'aes-code-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="cv" [class.editing]="editing()">
      <div class="cv-bar">
        <span class="cv-lang">{{ language() }}</span>
        @if (label()) { <span class="cv-label">{{ label() }}</span> }
        <span class="cv-sp"></span>
        @if (editing()) {
          @if (parsed().ok) { <span class="cv-ok"><mat-icon>check_circle</mat-icon> valid JSON</span> }
          @else { <span class="cv-bad"><mat-icon>error</mat-icon> {{ parsed().error }}</span> }
          <button matButton type="button" (click)="cancel()">Cancel</button>
          <button matButton="filled" type="button" (click)="commit()" [disabled]="!parsed().ok || !dirty()">Save</button>
        } @else {
          <span class="cv-meta">{{ lineCount() }} lines · {{ text().length }} chars</span>
          @if (editable()) {
            <button matIconButton type="button" (click)="startEdit()" matTooltip="Edit as JSON" aria-label="Edit JSON"><mat-icon>edit</mat-icon></button>
          }
          <button matIconButton type="button" class="cv-copy" (click)="copy()"
            [matTooltip]="copied() ? 'Copied' : 'Copy to clipboard'" aria-label="Copy code">
            <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
          </button>
        }
      </div>
      @if (editing()) {
        <textarea class="cv-edit" [ngModel]="draft()" (ngModelChange)="draft.set($event)" spellcheck="false"
          autocomplete="off" autocapitalize="off" aria-label="Edit JSON body"></textarea>
      } @else {
        <pre class="cv-pre"><code [innerHTML]="html()"></code></pre>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .cv { border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); }
    .cv.editing { border-color: var(--brand); }
    .cv-bar { display: flex; align-items: center; gap: var(--s2); padding: 4px 6px 4px 12px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; }
    .cv-lang { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--brand);
      background: var(--brand-soft); padding: 1px 7px; border-radius: var(--r-full); }
    .cv-label { font-size: var(--fs-xs); color: var(--text-muted); }
    .cv-sp { flex: 1; }
    .cv-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
    .cv-ok, .cv-bad { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-xs); }
    .cv-ok { color: var(--ok, #16a34a); }
    .cv-bad { color: var(--danger); max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cv-ok mat-icon, .cv-bad mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .cv-copy { --mdc-icon-button-state-layer-size: 32px; }
    .cv-bar mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .cv-pre { margin: 0; padding: 12px 14px; overflow-x: auto; max-height: 460px; overflow-y: auto; }
    .cv-pre code { font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: var(--text); white-space: pre; tab-size: 2; }
    .cv-pre .tok-key { color: var(--brand); }
    .cv-pre .tok-str { color: var(--ok, #16a34a); }
    .cv-pre .tok-num { color: var(--warn, #b45309); }
    .cv-pre .tok-bool { color: #a855f7; font-weight: 600; }
    .cv-pre .tok-null { color: var(--text-faint); font-style: italic; }
    :root[data-theme="dark"] .cv-pre .tok-str, :host-context(:root:not([data-theme="light"])) .cv-pre .tok-str { color: #4ade80; }
    .cv-edit { display: block; width: 100%; box-sizing: border-box; border: 0; outline: none; resize: vertical;
      min-height: 260px; max-height: 60vh; padding: 12px 14px; background: var(--surface-2); color: var(--text);
      font-family: var(--font-mono); font-size: 12px; line-height: 1.6; tab-size: 2; white-space: pre; overflow-wrap: normal; overflow-x: auto; }
    .cv-edit:focus { box-shadow: inset 0 0 0 2px var(--brand-ring, transparent); }
  `],
})
export class CodeViewComponent {
  private readonly sanitizer = inject(DomSanitizer);

  /** The value to show — an object (pretty-printed as JSON) or a raw string. */
  readonly value = input.required<unknown>();
  readonly language = input<'json' | 'text'>('json');
  /** Optional caption shown in the toolbar (e.g. the capability name/kind). */
  readonly label = input<string>('');
  /** When true, show an Edit affordance that emits the parsed JSON on Save. */
  readonly editable = input(false);
  /** Emits the parsed body (an object) when the user saves valid edited JSON. */
  readonly save = output<Record<string, unknown>>();

  readonly copied = signal(false);
  readonly editing = signal(false);
  readonly draft = signal('');

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

  /** Live parse result for the edit buffer. */
  readonly parsed = computed<{ ok: boolean; value?: Record<string, unknown>; error?: string }>(() => {
    try {
      const v = JSON.parse(this.draft());
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Body must be a JSON object' };
      return { ok: true, value: v as Record<string, unknown> };
    } catch (e) {
      return { ok: false, error: (e as Error).message.replace(/^JSON\.parse:?\s*/i, '') };
    }
  });
  /** Whether the edit buffer differs from the original (ignoring formatting). */
  readonly dirty = computed(() => this.draft().trim() !== this.text().trim());

  startEdit(): void { this.draft.set(this.text()); this.editing.set(true); }
  cancel(): void { this.editing.set(false); }
  commit(): void {
    const p = this.parsed();
    if (!p.ok || !p.value) return;
    this.save.emit(p.value);
    this.editing.set(false);
  }

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
