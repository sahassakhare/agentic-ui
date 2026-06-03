import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import {
  WidgetContainerComponent,
  injectAgenticChat,
  type AgenticChatRef,
  type AgenticMessage,
  type AgenticWidgetInstance,
} from '@infra-tools/agentic-ui';

import { AGENT_URL } from './app.config';

/**
 * Pre-baked task templates. Each card sends a fixed prompt to the agent —
 * the user never types into a chat. The agent backend (`examples/demo-server`'s
 * `gemini` agent) picks the matching tool from `ToolRegistry`, the tool
 * handler in `@infra-tools/demo-shared-tools` returns a result whose
 * `components: [{ name, props }]` payload selects the Angular component to
 * render. No chat shell is mounted.
 */
interface Task {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
  readonly accent: string;
}

const TASKS: readonly Task[] = [
  {
    id: 'book-flight',
    title: '✈ Book a flight',
    description: 'Ask the agent to book LAX → JFK on 2026-06-15. Routes to bookFlight.',
    prompt: 'Book a flight from LAX to JFK on 2026-06-15.',
    accent: '#2563eb',
  },
  {
    id: 'check-points',
    title: '★ Check loyalty points',
    description: 'Ask the agent for the current points balance. Routes to checkPoints.',
    prompt: 'How many loyalty points do I have?',
    accent: '#a855f7',
  },
  {
    id: 'open-ticket',
    title: '✉ Open a support ticket',
    description: 'Ask the agent to file a refund support ticket. Routes to openTicket.',
    prompt: 'Open a support ticket: my refund has not arrived. Priority high.',
    accent: '#f59e0b',
  },
];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WidgetContainerComponent, JsonPipe],
  template: `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="dot"></span>
          <strong>Chatless agent demo</strong>
          <span class="muted">— no chat shell, same agent loop</span>
        </div>
        <div class="status">
          <span class="connection">
            <span class="pulse" [class.live]="!chat.error()"></span>
            {{ endpoint }}
          </span>
          <span class="counter" title="Turns sent">turns: {{ turnCount() }}</span>
          @if (chat.isLoading()) { <span class="loading">streaming…</span> }
        </div>
      </header>

      <main class="grid">
        <section class="launcher" aria-label="Task launcher">
          <h2>Task launcher</h2>
          <p class="lead">Pick a task — the app sends a structured prompt programmatically through <code>injectAgenticChat()</code>. The agent picks the tool; the result widget renders in the panel on the right.</p>
          <ul class="cards">
            @for (task of tasks; track task.id) {
              <li>
                <button
                  type="button"
                  class="task"
                  [style.--accent]="task.accent"
                  [disabled]="chat.isLoading()"
                  (click)="runTask(task)"
                >
                  <span class="title">{{ task.title }}</span>
                  <span class="desc">{{ task.description }}</span>
                  <code class="prompt">{{ task.prompt }}</code>
                </button>
              </li>
            }
          </ul>
          @if (chat.value().length > 0) {
            <button class="reset" type="button" (click)="chat.reset()">↺ Reset session</button>
          }
        </section>

        <section class="results" aria-label="Agent results">
          <h2>Results</h2>
          @if (chat.error(); as err) {
            <div class="error">
              <strong>Error:</strong> {{ err.message }}
              <p class="hint">Is <code>examples/demo-server</code> running on port 4111 with <code>GOOGLE_GENERATIVE_AI_API_KEY</code> set?</p>
            </div>
          }
          @if (chat.value().length === 0 && !chat.isLoading()) {
            <div class="empty">No results yet — pick a task to begin.</div>
          }
          @if (lastReply(); as reply) {
            <article class="reply">
              @if (replyText(); as text) {
                <p class="text">{{ text }}</p>
              }
              @if (replyWidgets().length > 0) {
                <div class="widgets">
                  @for (w of replyWidgets(); track w.widgetCallId) {
                    <mvk-widget-container [widget]="w" />
                  }
                </div>
              }
              @if (replyToolCalls().length > 0) {
                <details class="trace">
                  <summary>Tool calls ({{ replyToolCalls().length }})</summary>
                  <ul>
                    @for (tc of replyToolCalls(); track tc.toolCallId) {
                      <li><code>{{ tc.name }}</code> — <code>{{ tc.args | json }}</code></li>
                    }
                  </ul>
                </details>
              }
            </article>
          }
        </section>
      </main>

      <footer class="footer">
        <span>Transport: AG-UI · SSE</span>
        <span>Widgets via <code>&lt;mvk-widget-container&gt;</code> (no <code>&lt;mvk-chat-shell&gt;</code>)</span>
      </footer>
    </div>
  `,
  styles: `
    :host { display: block; height: 100vh; }
    .shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100vh; }
    .topbar { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--border); background: var(--surface); }
    .brand { display: flex; align-items: center; gap: 0.5rem; }
    .brand .dot { width: 10px; height: 10px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), #06b6d4); }
    .muted { color: var(--muted); }
    .status { display: flex; gap: 0.85rem; align-items: center; font-size: 0.85em; color: var(--muted); }
    .connection { display: inline-flex; align-items: center; gap: 0.4rem; }
    .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--error); }
    .pulse.live { background: var(--success); box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.5); animation: pulse 2s infinite; }
    @keyframes pulse {
      70% { box-shadow: 0 0 0 8px rgba(22, 163, 74, 0); }
      100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
    }
    .loading { color: var(--primary); font-weight: 600; }
    code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; }

    .grid { display: grid; grid-template-columns: minmax(320px, 1fr) 2fr; gap: 1.25rem; padding: 1.25rem; overflow: hidden; min-height: 0; }
    .launcher, .results { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); padding: 1rem 1.1rem; box-shadow: var(--shadow); overflow: auto; min-height: 0; }
    h2 { margin: 0 0 0.4rem; font-size: 1rem; }
    .lead { color: var(--muted); margin: 0 0 1rem; }

    .cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.7rem; }
    .task { display: grid; gap: 0.3rem; text-align: left; width: 100%; padding: 0.85rem 0.95rem; border: 1px solid var(--border); border-left: 3px solid var(--accent, var(--primary)); border-radius: var(--r); background: var(--surface); transition: transform 0.06s, box-shadow 0.15s; }
    .task:hover:not(:disabled) { box-shadow: var(--shadow); transform: translateY(-1px); }
    .task .title { font-weight: 600; }
    .task .desc { color: var(--muted); font-size: 0.85em; }
    .task .prompt { background: var(--code-bg); padding: 4px 7px; border-radius: var(--r-sm); font-size: 11px; color: #475569; }
    .reset { margin-top: 1rem; padding: 0.4rem 0.7rem; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface); }

    .empty { color: var(--muted); padding: 2rem 0; text-align: center; }
    .error { padding: 0.7rem 0.85rem; border-radius: var(--r-sm); background: #fee2e2; color: #991b1b; margin-bottom: 0.8rem; }
    .error .hint { margin: 0.3rem 0 0; font-size: 0.85em; color: #b91c1c; }
    .reply { display: grid; gap: 0.85rem; }
    .reply .text { margin: 0; }
    .widgets { display: grid; gap: 0.7rem; }
    .trace { margin-top: 0.4rem; color: var(--muted); font-size: 0.85em; }
    .trace ul { margin: 0.4rem 0 0; padding-left: 1.2rem; }

    .footer { display: flex; justify-content: space-between; padding: 0.6rem 1.25rem; border-top: 1px solid var(--border); background: var(--surface); color: var(--muted); font-size: 0.8em; }
  `,
})
export class App {
  protected readonly tasks = TASKS;
  protected readonly endpoint = AGENT_URL;
  protected readonly chat: AgenticChatRef = injectAgenticChat();

  protected readonly turnCount = computed(() => {
    // Recount on every messages-signal change; user-role messages are the
    // "turns I asked the agent to run."
    return this.chat.value().filter((m: AgenticMessage) => m.role === 'user').length;
  });

  /** Last assistant message — the result of the most recent task run. */
  protected readonly lastReply = computed<AgenticMessage | null>(() => {
    const msgs = this.chat.value();
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return msgs[i];
    }
    return null;
  });

  protected readonly replyText = computed<string>(() => {
    const reply = this.lastReply();
    if (!reply) return '';
    return typeof reply.content === 'string' ? reply.content : '';
  });

  protected readonly replyWidgets = computed<readonly AgenticWidgetInstance[]>(() => {
    return this.lastReply()?.widgets ?? [];
  });

  protected readonly replyToolCalls = computed(() => {
    return this.lastReply()?.toolCalls ?? [];
  });

  protected runTask(task: Task): void {
    this.chat.sendMessage(task.prompt);
  }
}
