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
  type AgenticWidgetInstance,
} from '@infra-tools/agentic-ui';

/**
 * One card on the product dashboard. Owns its own `injectAgenticChat()`
 * controller and silently runs an agent turn on mount; the rendered widget
 * IS the card's content. No status pills, no prompt previews, no
 * tool-call traces, no "agent" indicators — the agent is the invisible
 * engine that populated the card.
 *
 * This is the CopilotKit "chatless / generative UI integrated into
 * application UI" pattern: the app decides when and where generative UI
 * appears; the user just sees their dashboard.
 */
export interface CardSpec {
  /** Stable id used as ngFor track + telemetry attribution. */
  readonly id: string;
  /** Hidden — what we send the agent. The user never sees this. */
  readonly prompt: string;
  /** Optional human label for the skeleton placeholder while the card loads. */
  readonly skeletonHint?: string;
}

@Component({
  selector: 'app-dashboard-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WidgetContainerComponent],
  template: `
    @if (chat.error(); as err) {
      <div class="error-placeholder" role="status">
        <span class="ico">!</span>
        <p>This section is temporarily unavailable.</p>
      </div>
    } @else if (replyWidgets().length > 0) {
      @for (w of replyWidgets(); track w.widgetCallId) {
        <mvk-widget-container [widget]="w" />
      }
    } @else if (replyText(); as text) {
      <p class="text">{{ text }}</p>
    } @else {
      <div class="skeleton" aria-busy="true" [attr.aria-label]="card().skeletonHint ?? 'Loading'">
        <span class="line w-60"></span>
        <span class="line w-90"></span>
        <span class="line w-75"></span>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .text { margin: 0; color: var(--text); }

    .skeleton { display: grid; gap: 0.45rem; padding: 0.4rem 0; min-height: 80px; }
    .skeleton .line {
      height: 0.95rem; border-radius: var(--r-sm);
      background: linear-gradient(90deg, #e5e7eb 25%, #f1f5f9 50%, #e5e7eb 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    .w-60 { width: 60%; }
    .w-75 { width: 75%; }
    .w-90 { width: 90%; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .error-placeholder {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.65rem 0.8rem;
      background: #fef2f2;
      border-radius: var(--r-sm);
      color: #991b1b;
      font-size: 0.85em;
    }
    .error-placeholder .ico {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      background: #fee2e2; border-radius: 50%;
      font-weight: 700;
    }
    .error-placeholder p { margin: 0; }
  `,
})
export class DashboardCardComponent {
  readonly card = input.required<CardSpec>();
  /**
   * Bumped by the page-level "Refresh" affordance. Each card re-runs its
   * own agent turn when this changes — independent from every other card.
   */
  readonly refreshTick = input<number>(0);

  protected readonly chat: AgenticChatRef = injectAgenticChat();

  /**
   * The trailing assistant message — its `content` carries the natural-language
   * summary. Note: this is NOT where widgets necessarily live (see below).
   */
  private readonly lastTextReply = computed<AgenticMessage | null>(() => {
    const msgs = this.chat.value();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 0) {
        return m;
      }
    }
    return null;
  });

  protected readonly replyText = computed<string>(() => {
    const r = this.lastTextReply();
    return r && typeof r.content === 'string' ? r.content : '';
  });

  /**
   * Widgets the agent emitted during this turn.
   *
   * The orchestrator attaches `components: []` widgets from a tool result to
   * `activeMessageId ?? randomId('msg')`. When the agent emits the tool call
   * BEFORE any text (the common case for `bookFlight` / `checkPoints` /
   * `openTicket`), the active message id is undefined, so the widget lands on
   * a freshly-minted assistant message whose `content` is empty — separate
   * from the message that later carries the natural-language summary.
   *
   * Reading only the trailing assistant message therefore loses the widget.
   * Collect widgets across every assistant message in the thread instead.
   */
  protected readonly replyWidgets = computed<readonly AgenticWidgetInstance[]>(() => {
    const out: AgenticWidgetInstance[] = [];
    for (const m of this.chat.value()) {
      if (m.role !== 'assistant') continue;
      for (const w of m.widgets) out.push(w);
    }
    return out;
  });

  constructor() {
    // Fire on mount; re-fire on refreshTick change OR when the bound card
    // spec changes (the parent switches routes and reuses this component
    // instance with a new spec). Without keying on both, the second case
    // shows the previous card's content forever — the bug that surfaced as
    // "the side nav looks broken." Microtask delay so the parent's input
    // binding has flushed before send.
    let lastFiredKey = '';
    effect(() => {
      const tick = this.refreshTick();
      const spec = this.card();
      const key = `${spec.id}::${tick}`;
      if (key === lastFiredKey) return;
      lastFiredKey = key;
      queueMicrotask(() => {
        this.chat.reset();
        this.chat.sendMessage(spec.prompt);
      });
    });
  }
}
