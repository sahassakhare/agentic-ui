import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  WidgetContainerComponent,
  injectAgenticChat,
  type AgenticChatRef,
  type AgenticWidgetInstance,
} from '@infra-tools/agentic-ui';

/**
 * The "Personalized for you" section. Three buttons — Snapshot / Dashboard /
 * Workspace — each triggers a different *level* of agent-driven UI:
 *
 *   L1 — Snapshot: one prompt → agent fires three tool calls in a single
 *        run; the host renders the resulting widgets in a flat grid. The
 *        agent picks the *contents*; the host picks the *frame*.
 *
 *   L2 — Dashboard: the agent picks the `composeAccountDashboard` tool,
 *        which returns a `DashboardDef` (layout + tiles + refresh strategy).
 *        The host mounts the lib's `<mvk-dashboard-canvas>` — refresh-all,
 *        drilldown, explain affordances come for free. The agent picks the
 *        *layout shape*.
 *
 *   L3 — Workspace: the agent picks the `composeAccountWorkspace` tool,
 *        which returns a `SlotMap` (slot name → component + inputs + size).
 *        The host mounts the lib's `<mvk-workspace-layout>` — slot-level
 *        sizing, responsive collapse, drawer affordances come for free. The
 *        agent picks the *entire surface*.
 *
 * No chat surface anywhere; the agent runs invisibly in response to the
 * user clicking a product button.
 */
type Mode = 'snapshot' | 'dashboard' | 'workspace';

interface ModeSpec {
  readonly id: Mode;
  readonly label: string;
  readonly description: string;
  readonly prompt: string;
}

const MODES: readonly ModeSpec[] = [
  {
    id: 'snapshot',
    label: 'Snapshot',
    description: 'One run, multiple cards — flight, points, ticket.',
    prompt:
      'Book a flight from LAX to JFK on 2026-06-15, then check my loyalty points, ' +
      'then open a high-priority support ticket about my refund. Do all three in this turn.',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Composed via <mvk-dashboard-canvas>.',
    prompt: 'Compose an account dashboard for me.',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Composed via <mvk-workspace-layout>.',
    prompt: 'Compose a workspace layout for me.',
  },
];

@Component({
  selector: 'app-agent-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WidgetContainerComponent],
  template: `
    <section class="composer">
      <header>
        <h2>Personalized for you</h2>
        <p>Pick a view; we'll prepare it on the fly.</p>
      </header>

      <div class="modes" role="tablist">
        @for (m of modes; track m.id) {
          <button
            type="button"
            role="tab"
            class="mode"
            [class.active]="mode() === m.id"
            [attr.aria-selected]="mode() === m.id"
            [disabled]="chat.isLoading()"
            (click)="select(m)"
          >
            <span class="label">{{ m.label }}</span>
            <span class="desc">{{ m.description }}</span>
          </button>
        }
      </div>

      <div class="output" [attr.data-mode]="mode()">
        @if (chat.error(); as err) {
          <div class="placeholder error">
            <span class="ico">!</span>
            <p>This view is temporarily unavailable.</p>
          </div>
        } @else if (replyWidgets().length > 0) {
          <div class="render" [attr.data-mode]="mode()">
            @for (w of replyWidgets(); track w.widgetCallId) {
              <mvk-widget-container [widget]="w" />
            }
          </div>
        } @else if (chat.isLoading()) {
          <div class="skeleton" aria-busy="true">
            <span class="line w-50"></span>
            <span class="line w-90"></span>
            <span class="line w-70"></span>
            <span class="line w-80"></span>
          </div>
        } @else if (mode() === null) {
          <p class="hint">Tap a view above to compose it.</p>
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }
    .composer {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r);
      box-shadow: var(--shadow);
      padding: 1.1rem 1.25rem 1.25rem;
      display: grid; gap: 0.85rem;
    }
    header h2 { margin: 0 0 0.15rem; font-size: 1.05rem; font-weight: 700; }
    header p { margin: 0; color: var(--muted); font-size: 0.85em; }

    .modes { display: grid; gap: 0.55rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .mode {
      display: grid; gap: 0.25rem; text-align: left;
      padding: 0.7rem 0.85rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      transition: transform 0.06s, box-shadow 0.15s, border-color 0.15s;
    }
    .mode:hover:not(:disabled) { box-shadow: var(--shadow); transform: translateY(-1px); }
    .mode.active { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12); }
    .mode .label { font-weight: 600; font-size: 0.92rem; }
    .mode .desc { color: var(--muted); font-size: 0.78em; }

    .output { min-height: 80px; padding-top: 0.4rem; }
    .render {
      display: grid; gap: 0.7rem;
    }
    .render[data-mode='snapshot'] { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .render[data-mode='dashboard'], .render[data-mode='workspace'] { grid-template-columns: 1fr; }

    .hint { margin: 0.4rem 0 0; color: var(--muted); font-style: italic; font-size: 0.9em; }

    .skeleton { display: grid; gap: 0.5rem; padding: 0.3rem 0; }
    .skeleton .line {
      height: 0.9rem; border-radius: var(--r-sm);
      background: linear-gradient(90deg, #e5e7eb 25%, #f1f5f9 50%, #e5e7eb 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    .w-50 { width: 50%; } .w-70 { width: 70%; } .w-80 { width: 80%; } .w-90 { width: 90%; }
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
export class AgentComposerComponent {
  protected readonly modes = MODES;
  protected readonly mode = signal<Mode | null>(null);
  protected readonly chat: AgenticChatRef = injectAgenticChat();

  /** Collect widgets across all assistant messages — see dashboard-card. */
  protected readonly replyWidgets = computed<readonly AgenticWidgetInstance[]>(() => {
    const out: AgenticWidgetInstance[] = [];
    for (const m of this.chat.value()) {
      if (m.role !== 'assistant') continue;
      for (const w of m.widgets) out.push(w);
    }
    return out;
  });

  protected select(spec: ModeSpec): void {
    this.mode.set(spec.id);
    this.chat.reset();
    this.chat.sendMessage(spec.prompt);
  }
}
