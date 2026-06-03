import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import {
  WidgetContainerComponent,
  injectAgenticChat,
  type AgenticChatRef,
  type AgenticWidgetInstance,
} from '@infra-tools/agentic-ui';

/**
 * A normal product search form. User picks origin / destination / date and
 * clicks Search; the form fires its own `injectAgenticChat()` controller
 * behind the scenes; the resulting `flightCard` widget mounts below the
 * form.
 *
 * No chat surface, no "ask the agent" affordance — the user is just using
 * a search form. The agent is invoked invisibly when the form is submitted.
 * This is the CopilotKit "chatless / generative UI integrated into
 * application UI" pattern applied to a user-initiated interaction
 * (M365 Copilot inline-edit / Linear Insights / HubSpot AI Assist).
 */
const ORIGINS = ['LAX', 'SFO', 'ORD', 'SEA'] as const;
const DESTINATIONS = ['JFK', 'BOS', 'ATL', 'MIA'] as const;

@Component({
  selector: 'app-plan-trip-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, WidgetContainerComponent],
  template: `
    <section class="planner">
      <header>
        <h2>Plan a new trip</h2>
        <p>Pick a route and we'll line up your options.</p>
      </header>

      <form class="row" (ngSubmit)="search()" #f="ngForm">
        <label class="field">
          <span class="label">From</span>
          <select [(ngModel)]="from" name="from" required>
            @for (code of origins; track code) { <option [value]="code">{{ code }}</option> }
          </select>
        </label>

        <span class="arrow" aria-hidden="true">→</span>

        <label class="field">
          <span class="label">To</span>
          <select [(ngModel)]="to" name="to" required>
            @for (code of destinations; track code) { <option [value]="code">{{ code }}</option> }
          </select>
        </label>

        <label class="field grow">
          <span class="label">Date</span>
          <input type="date" [(ngModel)]="date" name="date" required>
        </label>

        <button class="cta" type="submit" [disabled]="!f.valid || chat.isLoading()">
          @if (chat.isLoading()) { Searching… } @else { Search }
        </button>
      </form>

      <div class="output">
        @if (chat.error(); as err) {
          <div class="placeholder error">
            <span class="ico">!</span>
            <p>Search is temporarily unavailable.</p>
          </div>
        } @else if (replyWidgets().length > 0) {
          <div class="results">
            @for (w of replyWidgets(); track w.widgetCallId) {
              <mvk-widget-container [widget]="w" />
            }
          </div>
        } @else if (chat.isLoading()) {
          <div class="skeleton" aria-busy="true" aria-label="Searching">
            <span class="line w-50"></span>
            <span class="line w-80"></span>
            <span class="line w-65"></span>
          </div>
        } @else {
          <p class="hint">Your trip will appear here.</p>
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }
    .planner {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r);
      box-shadow: var(--shadow);
      padding: 1.1rem 1.25rem 1.25rem;
      display: grid; gap: 0.85rem;
    }
    header h2 { margin: 0 0 0.15rem; font-size: 1.05rem; font-weight: 700; }
    header p { margin: 0; color: var(--muted); font-size: 0.85em; }

    .row {
      display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.6rem;
    }
    .field { display: grid; gap: 0.2rem; min-width: 96px; }
    .field.grow { flex: 1 1 140px; }
    .label { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
    select, input[type='date'] {
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }
    select:focus, input:focus { outline: 2px solid var(--primary); outline-offset: 1px; }
    .arrow { padding: 0 0.1rem 0.55rem; color: var(--muted); font-size: 1.15rem; }
    .cta {
      padding: 0.55rem 1rem;
      background: var(--primary); color: #fff;
      border: 1px solid var(--primary);
      border-radius: var(--r-sm);
      font-weight: 600;
    }
    .cta:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }

    .output { min-height: 80px; }
    .hint { margin: 0.4rem 0 0; color: var(--muted); font-size: 0.9em; font-style: italic; }
    .results { display: grid; gap: 0.6rem; }

    .skeleton { display: grid; gap: 0.5rem; padding: 0.3rem 0; }
    .skeleton .line {
      height: 0.9rem; border-radius: var(--r-sm);
      background: linear-gradient(90deg, #e5e7eb 25%, #f1f5f9 50%, #e5e7eb 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    .w-50 { width: 50%; } .w-65 { width: 65%; } .w-80 { width: 80%; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .placeholder.error {
      display: flex; gap: 0.6rem; align-items: center;
      padding: 0.6rem 0.8rem; background: #fef2f2; color: #991b1b;
      border-radius: var(--r-sm); font-size: 0.85em;
    }
    .placeholder.error .ico {
      width: 22px; height: 22px; border-radius: 50%;
      background: #fee2e2; display: inline-flex; align-items: center; justify-content: center;
      font-weight: 700;
    }
    .placeholder.error p { margin: 0; }
  `,
})
export class PlanTripFormComponent {
  protected readonly origins = ORIGINS;
  protected readonly destinations = DESTINATIONS;

  protected from = 'LAX';
  protected to = 'JFK';
  protected date = defaultDate();

  protected readonly chat: AgenticChatRef = injectAgenticChat();

  /**
   * Collect widgets across every assistant message — the orchestrator may
   * attach `components` widgets to a fresh assistant message separate from
   * the one carrying the LLM's summary text (see dashboard-card.component
   * for the same rationale).
   */
  protected readonly replyWidgets = computed<readonly AgenticWidgetInstance[]>(() => {
    const out: AgenticWidgetInstance[] = [];
    for (const m of this.chat.value()) {
      if (m.role !== 'assistant') continue;
      for (const w of m.widgets) out.push(w);
    }
    return out;
  });

  protected search(): void {
    const prompt = `Book a flight from ${this.from} to ${this.to} on ${this.date}.`;
    this.chat.reset();
    this.chat.sendMessage(prompt);
  }
}

function defaultDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 2);
  return d.toISOString().slice(0, 10);
}
