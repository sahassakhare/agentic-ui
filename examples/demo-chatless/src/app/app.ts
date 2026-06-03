import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TaskTileComponent, type TaskConfig } from './task-tile.component';
import { AGENT_URL } from './app.config';

/**
 * Pre-baked tasks the dashboard fires on mount. Each becomes one tile on the
 * canvas; each tile owns its own `injectAgenticChat()` controller (its own
 * thread + run + loading state), so they all stream in parallel.
 *
 * Mix of three shared tools — `bookFlight` appears twice with different args
 * to show parallel invocations of the same tool against different prompts.
 */
const TASKS: readonly TaskConfig[] = [
  {
    id: 'flight-jfk',
    title: 'Flight to JFK',
    subtitle: 'LAX → JFK on 2026-06-15',
    prompt: 'Book a flight from LAX to JFK on 2026-06-15.',
    accent: '#2563eb',
    icon: '✈',
  },
  {
    id: 'flight-atl',
    title: 'Flight to ATL',
    subtitle: 'LAX → ATL on 2026-07-04',
    prompt: 'Book a flight from LAX to ATL on 2026-07-04.',
    accent: '#0ea5e9',
    icon: '✈',
  },
  {
    id: 'points',
    title: 'Loyalty status',
    subtitle: 'Current points balance + tier',
    prompt: 'How many loyalty points do I have?',
    accent: '#a855f7',
    icon: '★',
  },
  {
    id: 'ticket',
    title: 'Support ticket',
    subtitle: 'Open a high-priority refund ticket',
    prompt: 'Open a support ticket: my refund has not arrived. Priority high.',
    accent: '#f59e0b',
    icon: '✉',
  },
];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskTileComponent],
  template: `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="dot"></span>
          <strong>Chatless agent dashboard</strong>
          <span class="muted">— {{ tasks.length }} tiles, one agent backend, no chat shell</span>
        </div>
        <div class="status">
          <span class="endpoint">{{ endpoint }}</span>
          <span class="counter" aria-label="Refresh count">refreshes: {{ refreshCount() }}</span>
          <button type="button" class="refresh-all" (click)="refreshAll()">↻ Refresh all</button>
        </div>
      </header>

      <main class="canvas">
        <div class="grid">
          @for (task of tasks; track task.id) {
            <app-task-tile [task]="task" [refreshTick]="refreshTick()" />
          }
        </div>
      </main>

      <footer class="footer">
        <span>Each tile = independent <code>injectAgenticChat()</code> thread</span>
        <span>Widgets via <code>&lt;mvk-widget-container&gt;</code> (no <code>&lt;mvk-chat-shell&gt;</code>)</span>
      </footer>
    </div>
  `,
  styles: `
    :host { display: block; min-height: 100vh; }
    .shell { display: grid; grid-template-rows: auto 1fr auto; min-height: 100vh; }
    .topbar {
      display: flex; justify-content: space-between; align-items: center; gap: 1rem;
      padding: 0.75rem 1.25rem;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    .brand { display: flex; align-items: center; gap: 0.55rem; }
    .brand .dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: linear-gradient(135deg, var(--primary), #06b6d4);
    }
    .muted { color: var(--muted); }
    .status { display: flex; align-items: center; gap: 0.7rem; font-size: 0.83em; color: var(--muted); }
    .endpoint { font-family: ui-monospace, monospace; font-size: 0.8em; padding: 2px 7px; background: var(--code-bg); border-radius: var(--r-sm); }
    .counter { color: var(--muted); }
    .refresh-all {
      padding: 0.4rem 0.7rem; border: 1px solid var(--border); border-radius: var(--r-sm);
      background: var(--primary); color: #fff; font-weight: 600;
    }
    .refresh-all:hover { background: var(--primary-hover); }

    .canvas { padding: 1.25rem; background: var(--bg); }
    .grid {
      display: grid; gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }

    .footer {
      display: flex; justify-content: space-between; gap: 1rem;
      padding: 0.6rem 1.25rem;
      border-top: 1px solid var(--border);
      background: var(--surface);
      color: var(--muted); font-size: 0.8em;
    }
    code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; }
  `,
})
export class App {
  protected readonly tasks = TASKS;
  protected readonly endpoint = AGENT_URL;
  protected readonly refreshTick = signal(0);
  protected readonly refreshCount = signal(0);

  protected refreshAll(): void {
    this.refreshTick.update((n) => n + 1);
    this.refreshCount.update((n) => n + 1);
  }
}
