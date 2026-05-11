import {
  ChangeDetectionStrategy, Component, computed,
  HostListener, inject, signal,
} from '@angular/core';
import { ChatBridgeService } from '../services/chat-bridge.service';

/**
 * Command palette — a Cmd+K natural-language entry point that drives
 * the same registered tools the chat shell does, but with a
 * lighter, keyboard-first surface (plan R4 — "no-chat, but LLM
 * interaction").
 *
 * Implementation note: the palette forwards every prompt to the
 * SAME chat shell mounted in the right rail (via ChatBridgeService).
 * Earlier the palette spun up an independent headless chat thread,
 * but that surface had subtle settle-detection races AND no UI
 * feedback while the agent worked. Routing through the existing
 * chat shell gets the operator streaming text + tool calls + widget
 * mounts for free, and there's one auditable thread instead of two.
 *
 * Lifecycle:
 *   - Cmd/Ctrl+K toggles the modal from anywhere in the shell.
 *   - On submit the prompt fires through the bridge into the chat
 *     shell. The palette closes; the rail (auto-opened) shows the
 *     agent's response live.
 *   - The chat shell + rail handle navigation when a tool emits
 *     route-target widgets (legalHoldCard mounts on /holds, etc.).
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
                 placeholder="e.g. place a legal hold for Project Phoenix"
                 maxlength="500"
                 autofocus />

          <div class="actions">
            <button class="btn primary" type="button" (click)="run()"
                    [disabled]="!canRun()">
              Send to agent
            </button>
            <span class="hint">{{ prompt().length }}/500</span>
            @if (!bridgeReady()) {
              <span class="warn">Chat shell not mounted yet — open it from the right rail first.</span>
            }
          </div>

          <p class="explain dim">
            The agent sees the same tools and registers as the chat
            on the right. Whatever it picks renders there; the
            palette is just a keyboard shortcut.
          </p>
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
    .actions { display: flex; align-items: center; gap: 0.625rem; margin-top: 0.625rem; flex-wrap: wrap; }
    .btn { padding: 0.4rem 0.875rem; border-radius: 0.375rem; font-size: 0.875rem; cursor: pointer; }
    .btn.primary { background: var(--c-accent, #3b82f6); color: white; border: 1px solid var(--c-accent, #3b82f6); }
    .btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .hint { color: var(--c-text-2); font-size: 0.75rem; }
    .warn { color: #b45309; font-size: 0.75rem; }
    .explain { margin: 0.625rem 0 0; font-size: 0.8125rem; line-height: 1.45; }
    .dim { color: var(--c-text-2); }
  `,
})
export class CommandPaletteComponent {
  private readonly bridge = inject(ChatBridgeService);

  readonly open = signal(false);
  readonly prompt = signal('');

  readonly bridgeReady = this.bridge.isReady;
  readonly canRun = computed(() =>
    this.prompt().trim().length >= 3 && this.bridgeReady(),
  );

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
  }

  close(): void {
    this.open.set(false);
  }

  run(): void {
    if (!this.canRun()) return;
    const text = this.prompt().trim();
    const dispatched = this.bridge.send(text);
    if (dispatched) {
      this.prompt.set('');
      this.close();
    }
  }
}
