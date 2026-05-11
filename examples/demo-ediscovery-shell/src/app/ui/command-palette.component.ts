import {
  ChangeDetectionStrategy, Component, computed, EnvironmentInjector,
  HostListener, inject, signal,
} from '@angular/core';
import { runHeadlessIn } from '../agentic/headless';
import { RenderHandoffStore } from '../services/render-handoff.store';

/**
 * Command palette -- Cmd+K / Ctrl+K natural-language entry point.
 *
 * Behaviour (plan R4, refined 2026-05-11):
 *   - Press the shortcut anywhere in the shell -> modal opens.
 *   - Type a prompt, hit Enter (or click "Run") -> a one-shot,
 *     headless agent run via `runHeadlessIn()`. The chat shell is
 *     NOT involved -- the LLM picks one tool, the tool runs, and
 *     any side-effect (navigation, widget mount) happens directly
 *     in the app. The chat panel stays untouched.
 *   - During the run the palette shows a spinner + the prompt.
 *   - When the run finishes:
 *       * If the tool navigated (router state changed mid-run),
 *         the palette closes -- the user is already on the
 *         destination page with the widget mounted.
 *       * If the tool returned widgets but didn't navigate, the
 *         palette publishes them to the `palette.primary` slot
 *         and closes. The hosting page's slot mounts them.
 *       * If the tool only returned markdown (no widgets, no
 *         navigation), the palette stays open with the markdown
 *         visible -- gives the user a confirmation + somewhere
 *         to retry / refine.
 *       * On error / no tool match, surface the message and stay
 *         open.
 */
@Component({
  selector: 'mvk-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="overlay" (click)="close()" role="presentation">
        <div class="palette" role="dialog" aria-label="Command palette" (click)="$event.stopPropagation()">
          <header class="head">
            <span class="kbd">{{ shortcutLabel }}</span>
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
                 placeholder="e.g. place a legal hold for Project Phoenix"
                 maxlength="500"
                 [disabled]="loading()"
                 autofocus />

          <div class="actions">
            <button class="btn primary" type="button" (click)="run()"
                    [disabled]="!canRun()">
              @if (loading()) {
                <span class="spinner" aria-hidden="true"></span>
                Running…
              } @else {
                Run
              }
            </button>
            <span class="hint">{{ prompt().length }}/500</span>
            @if (loading()) {
              <button class="btn ghost" type="button" (click)="cancel()">Cancel</button>
            }
          </div>

          @if (loading()) {
            <p class="status">
              <span class="dot pulse" aria-hidden="true"></span>
              Agent is thinking. The action will happen here in the app — no chat panel needed.
            </p>
          } @else if (result(); as r) {
            @if (r.errored) {
              <div class="alert error">
                <strong>Couldn't complete that.</strong>
                <p>{{ r.error || 'Try rephrasing or use the menu.' }}</p>
              </div>
            } @else if (r.markdown) {
              <div class="alert ok">
                <p class="markdown">{{ r.markdown }}</p>
                @if (r.toolCalls.length > 0) {
                  <p class="dim small">
                    Ran <code>{{ r.toolCalls[0]?.name }}</code>{{ r.toolCalls.length > 1 ? ' (+' + (r.toolCalls.length - 1) + ' more)' : '' }}.
                  </p>
                }
              </div>
            }
          } @else {
            <p class="explain dim">
              Press <kbd>Enter</kbd> to run. The agent picks one
              tool and the result lands directly in the app — a
              form opens on its page, a widget mounts on the
              right route, etc. The chat panel stays out of the way.
            </p>
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
    .input:disabled { background: var(--c-surface-2, #f8fafc); cursor: wait; }
    .actions { display: flex; align-items: center; gap: 0.625rem; margin-top: 0.625rem; flex-wrap: wrap; }
    .btn { padding: 0.4rem 0.875rem; border-radius: 0.375rem; font-size: 0.875rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem; }
    .btn.primary { background: var(--c-accent, #3b82f6); color: white; border: 1px solid var(--c-accent, #3b82f6); }
    .btn.primary:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn.ghost { background: transparent; color: var(--c-text-2); border: 1px solid var(--c-border, #d1d5db); }
    .hint { color: var(--c-text-2); font-size: 0.75rem; }
    .explain { margin: 0.75rem 0 0; font-size: 0.8125rem; line-height: 1.45; }
    .explain kbd {
      font-family: ui-monospace, monospace; font-size: 0.7rem;
      background: var(--c-surface-2, #f1f5f9); border: 1px solid var(--c-border, #e5e7eb);
      padding: 0.0625rem 0.3125rem; border-radius: 0.25rem;
    }
    .dim { color: var(--c-text-2); }
    .small { font-size: 0.75rem; }

    .status {
      margin: 0.875rem 0 0; padding: 0.625rem 0.75rem;
      background: var(--c-surface-2, #f1f5f9);
      border-radius: 0.4rem;
      font-size: 0.85rem; color: var(--c-text-2);
      display: flex; align-items: center; gap: 0.5rem;
    }
    .alert {
      margin: 0.875rem 0 0; padding: 0.625rem 0.875rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
    }
    .alert.ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
    .alert.error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
    .alert .markdown { margin: 0; white-space: pre-wrap; }
    .alert .dim { color: inherit; opacity: 0.85; margin: 0.25rem 0 0; }
    .alert code { font-family: ui-monospace, monospace; background: rgba(0, 0, 0, 0.06); padding: 0.0625rem 0.3125rem; border-radius: 0.25rem; }

    .spinner {
      width: 12px; height: 12px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 700ms linear infinite;
      display: inline-block;
    }
    .dot.pulse {
      width: 8px; height: 8px; border-radius: 999px;
      background: var(--c-accent, #3b82f6);
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse {
      0%, 100% { opacity: 0.35; transform: scale(0.85); }
      50% { opacity: 1; transform: scale(1.15); }
    }
  `,
})
export class CommandPaletteComponent {
  private readonly env = inject(EnvironmentInjector);
  private readonly handoff = inject(RenderHandoffStore);

  protected readonly shortcutLabel = detectShortcutLabel();
  readonly open = signal(false);
  readonly prompt = signal('');
  readonly loading = signal(false);
  readonly result = signal<Awaited<ReturnType<typeof runHeadlessIn>> | null>(null);

  private abort: AbortController | null = null;

  readonly canRun = computed(() => this.prompt().trim().length >= 3 && !this.loading());

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
    if (this.open()) this.result.set(null);
  }

  close(): void {
    this.open.set(false);
    this.result.set(null);
  }

  cancel(): void {
    this.abort?.abort();
  }

  async run(): Promise<void> {
    if (!this.canRun()) return;
    const text = this.prompt().trim();
    this.loading.set(true);
    this.result.set(null);
    this.abort?.abort();
    this.abort = new AbortController();

    // Note where the user was when the run started. If a tool
    // navigates mid-run we close the palette without showing a
    // result -- the destination page IS the result.
    const initialPath = typeof location !== 'undefined' ? location.pathname : '';

    try {
      const out = await runHeadlessIn(this.env, {
        prompt: text,
        signal: this.abort.signal,
      });
      this.result.set(out);

      // If the tool routed the user, just close. Empty palette ->
      // operator sees the destination page directly.
      const navigated = typeof location !== 'undefined' && location.pathname !== initialPath;
      if (navigated && !out.errored) {
        this.prompt.set('');
        this.close();
        return;
      }

      // Tool produced widgets but didn't navigate -- park them in
      // the palette's own slot so the host page can render them.
      if (out.widgets.length > 0 && !out.errored) {
        this.handoff.publish('palette.primary', out.widgets.map((w) => ({
          name: w.name, props: w.props,
        })));
        // Leave the palette open one beat so the user sees the
        // confirmation markdown before clicking elsewhere.
      }
    } catch (err) {
      this.result.set({
        markdown: '', widgets: [], toolCalls: [],
        errored: true,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.loading.set(false);
    }
  }
}

/** Pick the right shortcut label for the platform. Modern browsers
 *  surface platform via `navigator.userAgentData.platform`, with a
 *  fallback to `navigator.platform`. SSR-safe (returns the Ctrl
 *  label when window/navigator are absent). */
function detectShortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl + K';
  const ua = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const plat = (ua?.platform || navigator.platform || '').toLowerCase();
  const isMac = plat.includes('mac') || plat.includes('iphone') || plat.includes('ipad');
  return isMac ? '⌘ K' : 'Ctrl + K';
}
