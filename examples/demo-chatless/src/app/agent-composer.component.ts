import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import {
  WidgetContainerComponent,
  injectAgenticChat,
  type AgenticChatRef,
  type AgenticWidgetInstance,
} from '@infra-tools/agentic-ui';

/**
 * The "Personalized for you" section. The user picks one of six tabs; each
 * triggers a different LEVEL of agent-driven UI:
 *
 *   L1 — Snapshot
 *        One run, multiple tool calls; widgets in a flat grid.
 *
 *   L2 — Dashboard
 *        LLM emits a full `DashboardDef` as composeAccountDashboard's
 *        Zod-typed argument. Mounted via <mvk-dashboard-canvas>.
 *
 *   L3 — Workspace
 *        LLM emits a full `SlotMap` as composeAccountWorkspace's
 *        Zod-typed argument. Mounted via <mvk-workspace-layout>.
 *
 *   B (L4) — Page
 *        LLM emits a SlotMap *for a specific route* via composePageLayout.
 *
 *   C (L5) — Shell
 *        LLM emits the entire shell (brand + nav + main slots) via
 *        composeShell. Mounted through <app-agent-shell-wrapper>.
 *
 *   D (L6) — Layout channel
 *        LLM emits a `layout-render`-shaped event (mirroring ADR-043's
 *        wire-level layout channel). The host listens for the
 *        `layoutEvent` payload in the tool result and surfaces it on a
 *        dedicated signal (the closest the demo can get to a real
 *        `chat.activeLayout()` flow without backend changes).
 */
type Mode = 'snapshot' | 'dashboard' | 'workspace' | 'page' | 'shell' | 'channel';

interface ModeSpec {
  readonly id: Mode;
  readonly label: string;
  readonly tag: string;
  readonly description: string;
  readonly prompt: string;
}

const MODES: readonly ModeSpec[] = [
  {
    id: 'snapshot',
    label: 'Snapshot',
    tag: 'L1',
    description: 'One run, multiple cards.',
    prompt:
      'Book a flight from LAX to JFK on 2026-06-15, then check my loyalty points, ' +
      'then open a high-priority support ticket about my refund. Do all three in this turn.',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    tag: 'L2',
    description: 'LLM emits the DashboardDef.',
    prompt:
      "Call composeAccountDashboard with this exact dashboard argument: " +
      "name='accountDashboard', title='Account dashboard', " +
      "layout={name:'accountLayout', description:'3-slot grid', slots:['flights','loyalty','support'], component:'emptyLayout'}, " +
      "tiles=[{id:'t-flight', slot:'flights', title:'Upcoming trip', component:'flightCard', " +
        "invocation:{kind:'tool', tool:'bookFlight', args:{from:'LAX', to:'JFK', date:'2026-06-15'}}}, " +
      "{id:'t-loyalty', slot:'loyalty', title:'Loyalty balance', component:'pointsCard', " +
        "invocation:{kind:'tool', tool:'checkPoints', args:{}}}, " +
      "{id:'t-support', slot:'support', title:'Open support', component:'ticketCard', " +
        "invocation:{kind:'tool', tool:'openTicket', args:{subject:'Refund delayed', priority:'high'}}}].",
  },
  {
    id: 'workspace',
    label: 'Workspace',
    tag: 'L3',
    description: 'LLM emits the SlotMap.',
    prompt:
      "Call composeAccountWorkspace with this exact slots map: " +
      "{ main: { component:'flightCard', inputs:{ bookingId:'BK-LLM-001', from:'LAX', to:'JFK', date:'2026-06-15', status:'confirmed' }, size:{default:'60%'} }, " +
      "side: { component:'pointsCard', inputs:{ balance:32500, tier:'gold' }, size:{default:'40%'} } }.",
  },
  {
    id: 'page',
    label: 'Page',
    tag: 'B',
    description: 'LLM composes a route page.',
    prompt:
      "Call composePageLayout with routeId='loyalty' and slots={ main: { component:'loyaltyOverviewCard', " +
      "inputs:{ balance:47320, tier:'gold', nextTierAt:75000, milesToNext:27680, transactions:[" +
        "{id:'TX1', date:'2026-05-22', kind:'earned', description:'Flight LAX-JFK', delta:1840}," +
        "{id:'TX2', date:'2026-05-15', kind:'redeemed', description:'Seat upgrade', delta:-12500}" +
      "]}, size:{default:'100%'} } }.",
  },
  {
    id: 'shell',
    label: 'Shell',
    tag: 'C',
    description: 'LLM emits the entire shell.',
    prompt:
      "Call composeShell with brand='TravelOps AI', tagline='Agent-built shell', " +
      "navItems=[{id:'home',label:'Home',icon:'◇'},{id:'trips',label:'Trips',icon:'✈'},{id:'rewards',label:'Rewards',icon:'★'}], " +
      "mainSlots={ hero: { component:'loyaltyOverviewCard', " +
        "inputs:{ balance:47320, tier:'gold', nextTierAt:75000, milesToNext:27680, transactions:[] }, " +
        "size:{default:'100%'} } }.",
  },
  {
    id: 'channel',
    label: 'Layout channel',
    tag: 'D',
    description: 'LLM emits a layout-render event.',
    prompt:
      "Call composeViaLayoutChannel with layoutEvent={ layoutName:'agent-pushed-workspace', " +
      "reason:'demo of the ADR-043 layout-render channel', " +
      "slots:{ left: { component:'flightCard', inputs:{ bookingId:'BK-CHAN-1', from:'SFO', to:'BOS', date:'2026-08-12', status:'confirmed' }, size:{default:'55%'} }, " +
      "right: { component:'pointsCard', inputs:{ balance:62100, tier:'platinum' }, size:{default:'45%'} } } }.",
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
        <p>Six levels of agent-driven UI. The agent picks the structure — not the host.</p>
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
            <span class="tag">{{ m.tag }}</span>
            <span class="label">{{ m.label }}</span>
            <span class="desc">{{ m.description }}</span>
          </button>
        }
      </div>

      @if (lastLayoutEvent(); as ev) {
        <aside class="channel">
          <div class="channel-head">
            <span class="dot"></span>
            <strong>Active layout (channel D):</strong>
            <code>{{ ev.layoutName }}</code>
            @if (ev.reason; as r) { <span class="reason">— {{ r }}</span> }
          </div>
        </aside>
      }

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
        } @else {
          <p class="hint">Tap a view above to have the agent compose it.</p>
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

    .modes { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    .mode {
      display: grid; gap: 0.2rem; text-align: left; position: relative;
      padding: 0.65rem 0.8rem 0.65rem 0.85rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      transition: transform 0.06s, box-shadow 0.15s, border-color 0.15s;
    }
    .mode:hover:not(:disabled) { box-shadow: var(--shadow); transform: translateY(-1px); }
    .mode.active { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12); }
    .mode .tag { position: absolute; top: 6px; right: 8px; font-size: 0.62em; font-weight: 700; color: var(--muted); letter-spacing: 0.05em; }
    .mode .label { font-weight: 600; font-size: 0.9rem; }
    .mode .desc { color: var(--muted); font-size: 0.76em; }

    .channel {
      background: #ecfeff; border: 1px solid #a5f3fc; border-radius: var(--r-sm);
      padding: 0.5rem 0.75rem;
    }
    .channel-head { display: flex; align-items: center; gap: 0.45rem; font-size: 0.85em; color: #155e75; }
    .channel-head .dot { width: 8px; height: 8px; border-radius: 50%; background: #06b6d4; }
    .channel-head code { background: #cffafe; padding: 1px 5px; border-radius: 3px; }
    .channel-head .reason { color: #0e7490; font-style: italic; }

    .output { min-height: 80px; padding-top: 0.4rem; }
    .render { display: grid; gap: 0.7rem; }
    .render[data-mode='snapshot'] { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .render[data-mode='dashboard'],
    .render[data-mode='workspace'],
    .render[data-mode='page'],
    .render[data-mode='shell'],
    .render[data-mode='channel'] { grid-template-columns: 1fr; }

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

  /** Tool calls' aggregated widgets across the whole turn. */
  protected readonly replyWidgets = computed<readonly AgenticWidgetInstance[]>(() => {
    const out: AgenticWidgetInstance[] = [];
    for (const m of this.chat.value()) {
      if (m.role !== 'assistant') continue;
      for (const w of m.widgets) out.push(w);
    }
    return out;
  });

  /**
   * D — host-side layout channel.
   *
   * Scans every assistant message's tool calls for a `layoutEvent` field on
   * the result (the shape `composeViaLayoutChannel` emits). This mirrors
   * ADR-043's `layout-render` AG-UI event flow as closely as the demo can
   * without modifying the backend: a tool RESULT exposes a layout payload
   * on a dedicated key; the host listens for it on a separate signal
   * (here `lastLayoutEvent`) and surfaces it independently from the
   * generative-UI `components` widget pipeline. In a backend that emits
   * the real wire event, this would be `chat.activeLayout()`.
   */
  protected readonly lastLayoutEvent = computed<{ layoutName: string; reason?: string } | null>(() => {
    for (let i = this.chat.value().length - 1; i >= 0; i--) {
      const m = this.chat.value()[i];
      if (m.role !== 'assistant') continue;
      for (let j = m.toolCalls.length - 1; j >= 0; j--) {
        const result = m.toolCalls[j].result as { layoutEvent?: { layoutName: string; reason?: string } } | undefined;
        if (result?.layoutEvent) return result.layoutEvent;
      }
    }
    return null;
  });

  constructor() {
    effect(() => {
      // Logs every layout-channel push for visibility (acts like an OTEL
      // span attribute would on a real layout-render event).
      const ev = this.lastLayoutEvent();
      if (ev) console.info('[layout-channel] active layout:', ev.layoutName, ev.reason ?? '');
    });
  }

  protected select(spec: ModeSpec): void {
    this.mode.set(spec.id);
    this.chat.reset();
    this.chat.sendMessage(spec.prompt);
  }
}
