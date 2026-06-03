import { Injectable, computed, effect, signal } from '@angular/core';
import {
  injectAgenticChat,
  type AgenticChatRef,
  type AgenticWidgetInstance,
} from '@infra-tools/agentic-ui';

/**
 * One of the six agent-composed UI levels the host exposes app-wide.
 * Promoted from the previous in-page sandbox: this service is the real
 * capability — every page can trigger a composition through
 * `compose(mode)`, and the result either replaces the active route's main
 * column (L1–L4, L6) or takes over the entire shell (L5).
 */
export type ComposerMode = 'snapshot' | 'dashboard' | 'workspace' | 'page' | 'shell' | 'channel';

export interface ComposerModeSpec {
  readonly id: ComposerMode;
  readonly label: string;
  readonly tag: string;
  readonly description: string;
  readonly prompt: string;
  /**
   *  - `page` → the host replaces the active route's main column with the
   *    composer output.
   *  - `shell` → the host swaps the entire shell (sidebar + main).
   */
  readonly target: 'page' | 'shell';
}

export const COMPOSER_MODES: readonly ComposerModeSpec[] = [
  {
    id: 'snapshot', label: 'Snapshot', tag: 'L1', target: 'page',
    description: 'One run, multiple cards — flight, points, ticket.',
    prompt:
      'Book a flight from LAX to JFK on 2026-06-15, then check my loyalty points, ' +
      'then open a high-priority support ticket about my refund. Do all three in this turn.',
  },
  {
    id: 'dashboard', label: 'Dashboard', tag: 'L2', target: 'page',
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
    id: 'workspace', label: 'Workspace', tag: 'L3', target: 'page',
    description: 'LLM emits the SlotMap.',
    prompt:
      "Call composeAccountWorkspace with slots={ main: { component:'flightCard', " +
      "inputs:{ bookingId:'BK-AG-001', from:'LAX', to:'JFK', date:'2026-06-15', status:'confirmed' }, size:{default:'60%'} }, " +
      "side: { component:'pointsCard', inputs:{ balance:32500, tier:'gold' }, size:{default:'40%'} } }.",
  },
  {
    id: 'page', label: 'Page', tag: 'L4', target: 'page',
    description: 'LLM composes a route page.',
    prompt:
      "Call composePageLayout with routeId='loyalty' and slots={ main: { component:'loyaltyOverviewCard', " +
      "inputs:{ balance:47320, tier:'gold', nextTierAt:75000, milesToNext:27680, transactions:[" +
        "{id:'TX1', date:'2026-05-22', kind:'earned', description:'Flight LAX-JFK', delta:1840}," +
        "{id:'TX2', date:'2026-05-15', kind:'redeemed', description:'Seat upgrade', delta:-12500}" +
      "]}, size:{default:'100%'} } }.",
  },
  {
    id: 'shell', label: 'Shell', tag: 'L5', target: 'shell',
    description: 'LLM emits the entire shell. Takes over the app.',
    prompt:
      "Call composeShell with brand='TravelOps AI', tagline='Agent-built shell', " +
      "navItems=[{id:'home',label:'Home',icon:'◇'},{id:'trips',label:'Trips',icon:'✈'},{id:'rewards',label:'Rewards',icon:'★'}], " +
      "mainSlots={ hero: { component:'loyaltyOverviewCard', " +
        "inputs:{ balance:47320, tier:'gold', nextTierAt:75000, milesToNext:27680, transactions:[] }, " +
        "size:{default:'100%'} } }.",
  },
  {
    id: 'channel', label: 'Layout channel', tag: 'L6', target: 'page',
    description: 'LLM emits a layout-render event.',
    prompt:
      "Call composeViaLayoutChannel with layoutEvent={ layoutName:'agent-pushed-workspace', " +
      "reason:'demo of the ADR-043 layout-render channel', " +
      "slots:{ left: { component:'flightCard', inputs:{ bookingId:'BK-CHAN-1', from:'SFO', to:'BOS', date:'2026-08-12', status:'confirmed' }, size:{default:'55%'} }, " +
      "right: { component:'pointsCard', inputs:{ balance:62100, tier:'platinum' }, size:{default:'45%'} } } }.",
  },
];

@Injectable({ providedIn: 'root' })
export class ComposerService {
  private readonly _chat: AgenticChatRef = injectAgenticChat();
  private readonly _activeId = signal<ComposerMode | null>(null);

  readonly modes = COMPOSER_MODES;

  readonly activeMode = computed<ComposerModeSpec | null>(() => {
    const id = this._activeId();
    return id ? this.modes.find((m) => m.id === id) ?? null : null;
  });

  /** Where the composer output should mount — `null` when no composition active. */
  readonly target = computed<'page' | 'shell' | null>(() => this.activeMode()?.target ?? null);

  /** Widgets emitted across every assistant message of the active composition. */
  readonly widgets = computed<readonly AgenticWidgetInstance[]>(() => {
    const out: AgenticWidgetInstance[] = [];
    for (const m of this._chat.value()) {
      if (m.role !== 'assistant') continue;
      for (const w of m.widgets) out.push(w);
    }
    return out;
  });

  readonly isLoading = computed(() => this._chat.isLoading());
  readonly error = computed(() => this._chat.error());

  /**
   * D — layout channel.
   * Mirrors `chat.activeLayout()` from ADR-043 by scanning the active turn's
   * tool-call results for the `layoutEvent` payload emitted by
   * `composeViaLayoutChannel`. The demo backend can't emit the real wire
   * event, so we recover it host-side from the tool result.
   */
  readonly lastLayoutEvent = computed<{ layoutName: string; reason?: string } | null>(() => {
    const msgs = this._chat.value();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== 'assistant') continue;
      for (let j = m.toolCalls.length - 1; j >= 0; j--) {
        const result = m.toolCalls[j].result as { layoutEvent?: { layoutName: string; reason?: string } } | undefined;
        if (result?.layoutEvent) return result.layoutEvent;
      }
    }
    return null;
  });

  compose(spec: ComposerModeSpec): void {
    this._activeId.set(spec.id);
    this._chat.reset();
    this._chat.sendMessage(spec.prompt);
  }

  /** Tear down the current composition; restore the default app. */
  clear(): void {
    this._activeId.set(null);
    this._chat.reset();
  }

  constructor() {
    effect(() => {
      const ev = this.lastLayoutEvent();
      if (ev) console.info('[layout-channel] active layout:', ev.layoutName, ev.reason ?? '');
    });
  }
}
