import {
  ChangeDetectionStrategy, Component, EnvironmentInjector,
  HostListener, inject, signal,
} from '@angular/core';
import { runHeadlessIn, type HeadlessRunResult } from '../agentic/headless';
import { RenderHandoffStore } from '../services/render-handoff.store';

/**
 * Command palette — a Cmd+K natural-language entry point that drives
 * the same registered tools the chat shell does, without mounting a
 * chat (plan R4 — "no-chat, but LLM interaction").
 *
 * Lifecycle:
 *   - Cmd/Ctrl+K toggles the modal from anywhere in the shell.
 *   - On submit, the prompt fires through `runHeadless()` (action-
 *     router preset) which lets the LLM pick exactly one tool.
 *   - Any widgets the tool produces land in the `palette.primary`
 *     handoff slot; smart routing tools (placeLegalHoldTool, etc.)
 *     navigate themselves to the right route.
 *   - Empty / errored runs surface a soft "couldn't match" message
 *     instead of dismissing silently.
 *
 * The palette intentionally stays minimal — one input, one Run
 * button, one result strip. Adopters who want a richer UI (recent
 * commands, suggestions, voice) can build on top of `runHeadless`.
 */
@Component({
  selector: 'mvk-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="overlay" (click)="close()" role="presentation">
        <div class="palette" role="dialog" aria-label="Command palette" (click)="$event.stopPropagation()">
          <header class="head">
            <span class="kbd">⌘ K</span>
            <span class="title">Ask the agent</span>
            <button class="close" type="button" (click)="close()" aria-label="Close">×</button>
          </header>

          <input #input
                 class="input"
                 type="text"
                 [value]="prompt()"
                 (input)="prompt.set(($any($event.target)).value)"
                 (keydown.enter)="run()"
                 (keydown.escape)="close()"
                 [disabled]="loading()"
                 placeholder="e.g. place a legal hold for Project Phoenix"
                 maxlength="500"
                 autofocus />

          <div class="actions">
            <button class="btn primary" type="button" (click)="run()"
                    [disabled]="loading() || prompt().trim().length < 3">
              {{ loading() ? 'Running…' : 'Run' }}
            </button>
            <span class="hint">{{ prompt().length }}/500</span>
          </div>

          @if (result(); as r) {
            <div class="result" [class.error]="r.errored">
              @if (r.errored) {
                <strong>Couldn't match that to an action.</strong>
                <p>{{ r.error || "Try rephrasing or use the menu." }}</p>
              } @else {
                @if (r.markdown) { <p class="markdown">{{ r.markdown }}</p> }
                @if (r.toolCalls.length > 0) {
                  <p class="dim">
                    Ran <code>{{ r.toolCalls[0]?.name }}</code>{{ r.toolCalls.length > 1 ? ' (+' + (r.toolCalls.length - 1) + ' more)' : '' }}.
                    @if (r.widgets.length > 0) {
                      Widget mounted on the destination route.
                    }
                  </p>
                }
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .overlay {
      position: fixed; inset: 0;
      background: rgba(15, 23, 42, 0.5);
      backdrop-filter: blur(4px);
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 12vh;
      z-index: 200;
    }
    .palette {
      width: min(640px, 92vw);
      background: var(--c-surface, #fff);
      border: 1px solid var(--c-border, #e5e7eb);
      border-radius: 0.75rem;
      box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.45);
      padding: 1rem 1.25rem 1.25rem;
    }
    .head { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 0.75rem; }
    .kbd {
      font-family: ui-monospace, monospace; font-size: 0.75rem;
      padding: 0.0625rem 0.375rem; border-radius: 0.25rem;
      background: var(--c-surface-2, #f1f5f9); color: var(--c-text-2);
    }
    .title { font-weight: 600; flex: 1; }
    .close {
      background: transparent; border: none; cursor: pointer;
      font-size: 1.5rem; line-height: 1; color: var(--c-text-2);
    }
    .input {
      width: 100%; box-sizing: border-box;
      font-size: 1rem; padding: 0.625rem 0.75rem;
      border: 1px solid var(--c-border, #d1d5db);
      border-radius: 0.5rem;
      background: var(--c-surface, #fff);
      color: var(--c-text, #111827);
      outline: 2px solid transparent; outline-offset: -1px;
    }
    .input:focus { outline-color: var(--c-accent, #3b82f6); }
    .actions { display: flex; align-items: center; gap: 0.625rem; margin-top: 0.625rem; }
    .btn { padding: 0.4rem 0.875rem; border-radius: 0.375rem; font-size: 0.875rem; cursor: pointer; }
    .btn.primary { background: var(--c-accent, #3b82f6); color: white; border: 1px solid var(--c-accent, #3b82f6); }
    .btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .hint { color: var(--c-text-2); font-size: 0.75rem; }
    .result {
      margin-top: 0.875rem;
      padding: 0.75rem 0.875rem;
      border-radius: 0.5rem;
      background: var(--c-surface-2, #f8fafc);
      font-size: 0.875rem;
    }
    .result.error { background: #fef2f2; color: #991b1b; }
    .markdown { margin: 0; white-space: pre-wrap; }
    .dim { color: var(--c-text-2); margin: 0.25rem 0 0; font-size: 0.8125rem; }
    .dim code { font-family: ui-monospace, monospace; background: var(--c-surface, #fff); padding: 0.0625rem 0.3125rem; border-radius: 0.25rem; }
  `,
})
export class CommandPaletteComponent {
  private readonly env = inject(EnvironmentInjector);
  private readonly handoff = inject(RenderHandoffStore);

  readonly open = signal(false);
  readonly prompt = signal('');
  readonly loading = signal(false);
  readonly result = signal<HeadlessRunResult | null>(null);

  /** Cmd/Ctrl+K from anywhere — toggles the palette. Escape closes
   *  it (also wired on the input element to short-circuit the IME). */
  @HostListener('window:keydown', ['$event'])
  onWindowKey(ev: KeyboardEvent): void {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      this.toggle();
    } else if (ev.key === 'Escape' && this.open()) {
      this.close();
    }
  }

  toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) {
      this.result.set(null);
    }
  }

  close(): void {
    this.open.set(false);
  }

  async run(): Promise<void> {
    const text = this.prompt().trim();
    if (text.length < 3 || this.loading()) return;
    this.loading.set(true);
    this.result.set(null);
    try {
      const out = await runHeadlessIn(this.env, { prompt: text });
      this.result.set(out);
      // If the LLM produced widgets but nothing dispatched them to a
      // specific page slot, drop them in the palette's own slot so
      // the user at least sees them somewhere.
      if (out.widgets.length > 0 && !out.errored) {
        this.handoff.publish('palette.primary', out.widgets.map((w) => ({
          name: w.name, props: w.props,
        })));
      }
    } catch (err) {
      this.result.set({
        markdown: '', widgets: [], toolCalls: [],
        errored: true, error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.loading.set(false);
    }
  }
}
