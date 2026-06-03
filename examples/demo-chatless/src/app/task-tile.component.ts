import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
} from '@angular/core';
import {
  WidgetContainerComponent,
  injectAgenticChat,
  type AgenticChatRef,
  type AgenticMessage,
  type AgenticToolCall,
  type AgenticWidgetInstance,
} from '@infra-tools/agentic-ui';

/**
 * One dashboard tile. Owns its OWN `injectAgenticChat()` controller — so its
 * thread, its run, its loading + error state are independent of every other
 * tile on the canvas. On mount, fires the task prompt automatically; the
 * Refresh button re-fires it.
 *
 * The agent-emitted widgets render in-tile through `<mvk-widget-container>`.
 * No chat shell, no chat transcript — just a dashboard cell driven by the
 * same controller the chat shell uses.
 */
export interface TaskConfig {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly prompt: string;
  readonly accent: string;
  readonly icon: string;
}

@Component({
  selector: 'app-task-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WidgetContainerComponent],
  template: `
    <article class="tile" [style.--accent]="task().accent">
      <header>
        <span class="icon">{{ task().icon }}</span>
        <hgroup>
          <h3>{{ task().title }}</h3>
          <p>{{ task().subtitle }}</p>
        </hgroup>
        <div class="actions">
          <span class="status" [class]="'status--' + statusKind()">{{ statusLabel() }}</span>
          <button type="button" class="refresh" [disabled]="chat.isLoading()" (click)="refresh()" aria-label="Refresh tile">↻</button>
        </div>
      </header>

      <div class="body">
        @if (chat.error(); as err) {
          <div class="error">{{ err.message }}</div>
        } @else if (chat.isLoading() && replyWidgets().length === 0 && !replyText()) {
          <div class="skeleton">
            <span></span><span></span><span></span>
          </div>
        } @else if (replyWidgets().length > 0) {
          <div class="widgets">
            @for (w of replyWidgets(); track w.widgetCallId) {
              <mvk-widget-container [widget]="w" />
            }
          </div>
        } @else if (replyText(); as text) {
          <p class="text">{{ text }}</p>
        } @else {
          <div class="empty">Idle</div>
        }
      </div>

      <footer>
        <span class="trace" [class.muted]="replyToolCalls().length === 0">
          @if (replyToolCalls().length > 0) {
            tools fired: {{ toolNames() }}
          } @else {
            no tool calls yet
          }
        </span>
        <code class="prompt" [title]="task().prompt">{{ task().prompt }}</code>
      </footer>
    </article>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .tile {
      display: grid; grid-template-rows: auto minmax(140px, 1fr) auto; gap: 0.6rem;
      padding: 0.9rem 1rem 0.7rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-top: 3px solid var(--accent, var(--primary));
      border-radius: var(--r);
      box-shadow: var(--shadow);
      transition: transform 0.08s, box-shadow 0.15s;
    }
    .tile:hover { box-shadow: 0 4px 14px rgba(15, 23, 42, 0.07); }
    header { display: flex; gap: 0.55rem; align-items: flex-start; }
    .icon { font-size: 1.3rem; line-height: 1; padding-top: 0.05rem; }
    hgroup { margin: 0; flex: 1 1 auto; min-width: 0; }
    hgroup h3 { margin: 0; font-size: 0.95rem; font-weight: 600; }
    hgroup p { margin: 0.1rem 0 0; color: var(--muted); font-size: 0.78em; }
    .actions { display: flex; gap: 0.35rem; align-items: center; }
    .status { font-size: 0.7em; padding: 2px 7px; border-radius: 999px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .status--idle { background: #e5e7eb; color: #6b7280; }
    .status--loading { background: #dbeafe; color: #1e3a8a; }
    .status--ready { background: #d1fae5; color: #065f46; }
    .status--error { background: #fee2e2; color: #991b1b; }
    .refresh {
      width: 26px; height: 26px; border-radius: 50%;
      border: 1px solid var(--border); background: var(--surface);
      font-size: 13px; padding: 0;
    }
    .refresh:hover:not(:disabled) { background: #f1f5f9; }

    .body { padding: 0.2rem 0; min-height: 80px; }
    .empty, .skeleton { color: var(--muted); display: flex; align-items: center; min-height: 80px; }
    .skeleton { display: grid; gap: 0.4rem; }
    .skeleton span { height: 0.9rem; border-radius: var(--r-sm); background: linear-gradient(90deg, #e5e7eb 25%, #f1f5f9 50%, #e5e7eb 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
    .skeleton span:nth-child(1) { width: 65%; }
    .skeleton span:nth-child(2) { width: 90%; }
    .skeleton span:nth-child(3) { width: 75%; }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .text { margin: 0; }
    .error { padding: 0.5rem 0.6rem; background: #fee2e2; color: #991b1b; border-radius: var(--r-sm); font-size: 0.85em; }
    .widgets { display: grid; gap: 0.5rem; }

    footer { display: flex; gap: 0.6rem; align-items: center; justify-content: space-between; padding-top: 0.4rem; border-top: 1px dashed var(--border); font-size: 0.72em; color: var(--muted); }
    .trace.muted { font-style: italic; }
    .prompt { background: var(--code-bg); padding: 2px 5px; border-radius: 3px; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class TaskTileComponent {
  readonly task = input.required<TaskConfig>();
  /**
   * Bumped by the parent's global "Refresh all" button. The effect below
   * watches both `refreshTick()` and `task()` and re-fires the prompt — a
   * single source of truth for refresh, agnostic to who triggered it.
   */
  readonly refreshTick = input<number>(0);

  protected readonly chat: AgenticChatRef = injectAgenticChat();

  /** Last assistant message — the latest result for this tile's task. */
  private readonly lastReply = computed<AgenticMessage | null>(() => {
    const msgs = this.chat.value();
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return msgs[i];
    }
    return null;
  });

  protected readonly replyText = computed<string>(() => {
    const r = this.lastReply();
    return r && typeof r.content === 'string' ? r.content : '';
  });

  protected readonly replyWidgets = computed<readonly AgenticWidgetInstance[]>(
    () => this.lastReply()?.widgets ?? [],
  );

  protected readonly replyToolCalls = computed<readonly AgenticToolCall[]>(
    () => this.lastReply()?.toolCalls ?? [],
  );

  protected readonly toolNames = computed<string>(() =>
    this.replyToolCalls().map((t) => t.name).join(', '),
  );

  protected readonly statusKind = computed<'idle' | 'loading' | 'ready' | 'error'>(() => {
    if (this.chat.error()) return 'error';
    if (this.chat.isLoading()) return 'loading';
    if (this.lastReply()) return 'ready';
    return 'idle';
  });

  protected readonly statusLabel = computed<string>(() => {
    const k = this.statusKind();
    if (k === 'loading') return 'streaming';
    return k;
  });

  constructor() {
    // Fire on mount; re-fire whenever refreshTick changes. effect() needs an
    // injection context — the constructor of an Injectable / Component is one.
    let lastFiredTick = -1;
    effect(() => {
      const tick = this.refreshTick();
      const t = this.task();
      if (tick === lastFiredTick) return;
      lastFiredTick = tick;
      // Microtask delay so the parent's binding has flushed before send.
      queueMicrotask(() => {
        this.chat.reset();
        this.chat.sendMessage(t.prompt);
      });
    });
  }

  protected refresh(): void {
    this.chat.reset();
    this.chat.sendMessage(this.task().prompt);
  }
}
