import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendRegistry, injectAgenticChat, type AgenticChatRef } from '../internal';
import { WidgetContainerComponent } from './widget-container.component';

@Component({
  selector: 'mvk-chat-shell',
  imports: [FormsModule, WidgetContainerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; font-family: system-ui, sans-serif; }
    .transcript { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .msg { max-width: 80%; padding: 0.6rem 0.8rem; border-radius: 0.6rem; line-height: 1.4; white-space: pre-wrap; }
    .msg.user { align-self: flex-end; background: #2563eb; color: white; }
    .msg.assistant { align-self: flex-start; background: #f3f4f6; color: #111827; }
    .msg.system { align-self: center; background: #fee2e2; color: #991b1b; font-size: 0.85em; }
    .msg.tool { align-self: flex-start; background: #ecfeff; color: #155e75; font-family: ui-monospace, monospace; font-size: 0.85em; }
    .widgets { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
    .composer { display: flex; gap: 0.5rem; padding: 0.75rem; border-top: 1px solid #e5e7eb; }
    .composer input { flex: 1; padding: 0.6rem 0.8rem; border: 1px solid #d1d5db; border-radius: 0.4rem; font: inherit; }
    .composer button { padding: 0.6rem 1.1rem; background: #2563eb; color: white; border: 0; border-radius: 0.4rem; font-weight: 600; cursor: pointer; }
    .composer button:disabled { opacity: 0.5; cursor: not-allowed; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 1rem; border-bottom: 1px solid #e5e7eb; font-size: 0.85em; color: #6b7280; }
    .backend-pill { padding: 0.15rem 0.5rem; border-radius: 999px; background: #eef2ff; color: #4338ca; font-weight: 600; }
    .error { background: #fee2e2; color: #991b1b; padding: 0.5rem 1rem; font-size: 0.85em; }
  `,
  template: `
    <div class="header">
      <span>Agentic chat</span>
      @if (activeBackend(); as b) {
        <span class="backend-pill">{{ b.label }}</span>
      } @else {
        <span class="backend-pill" style="background:#fee2e2;color:#991b1b">no backend</span>
      }
    </div>

    @if (chat.error(); as err) {
      <div class="error">{{ err.message }}</div>
    }

    <div class="transcript">
      @for (m of chat.value(); track m.id) {
        <div class="msg" [class]="m.role">
          @if (m.content) { {{ m.content }} }
          @for (tc of m.toolCalls; track tc.toolCallId) {
            @if (showToolCalls() !== 'hidden') {
              <div class="msg tool" style="margin-top:0.4rem">
                @switch (showToolCalls()) {
                  @case ('compact') {
                    → {{ tc.name }}
                    @if (tc.error) { ✗ {{ tc.error.message }} }
                  }
                  @default {
                    → {{ tc.name }}({{ stringify(tc.args) }})
                    @if (tc.result !== undefined) { ⇒ {{ stringify(tc.result) }} }
                    @if (tc.error) { ✗ {{ tc.error.message }} }
                  }
                }
              </div>
            }
          }
          @if (m.widgets.length) {
            <div class="widgets">
              @for (w of m.widgets; track w.widgetCallId) {
                <mvk-widget-container [widget]="w" />
              }
            </div>
          }
        </div>
      }
      @if (chat.isLoading()) {
        <div class="msg assistant">…</div>
      }
    </div>

    <form class="composer" (ngSubmit)="onSubmit()">
      <input
        [(ngModel)]="draft"
        name="composer"
        [placeholder]="placeholder()"
        [disabled]="chat.isLoading()"
        autocomplete="off"
      />
      <button type="submit" [disabled]="chat.isLoading() || !draft().trim()">Send</button>
    </form>
  `,
})
export class ChatShellComponent {
  readonly placeholder = input<string>('Ask the agent…');
  readonly maxLocalTurns = input<number>(10);

  /**
   * Controls how tool calls render inside the assistant message bubble.
   *
   *  - `'full'` *(default)* — emits `→ name(args) ⇒ result` with both the
   *    args and the result serialised to JSON. Useful for debugging
   *    handler shapes; can clutter the transcript when results carry
   *    bulky payloads or render through generative-UI widgets.
   *  - `'compact'` — emits just `→ name` (plus an `✗ error` line on
   *    failure). The widget below the bubble is the visible result.
   *  - `'hidden'` — suppresses the tool-call block entirely. Use when
   *    every tool result has a corresponding widget and the agent
   *    summarises in text.
   *
   * @default 'full'
   */
  readonly showToolCalls = input<'full' | 'compact' | 'hidden'>('full');

  protected readonly chat: AgenticChatRef = injectAgenticChat({ maxLocalTurns: this.maxLocalTurns() });
  protected readonly draft = signal<string>('');

  private readonly backends = inject(BackendRegistry);
  protected readonly activeBackend = computed(() => this.backends.active());

  protected onSubmit(): void {
    const text = this.draft().trim();
    if (!text) return;
    this.draft.set('');
    this.chat.sendMessage(text);
  }

  protected stringify(value: unknown): string {
    try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); }
  }
}
