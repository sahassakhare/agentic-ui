import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  BackendRegistry,
  ChatShellComponent,
  McpUiResourceComponent,
  WidgetContainerComponent,
  MCP_UI_COMPONENT_TREE_MIME,
  MCP_UI_HTML_MIME,
  type McpUiResource,
  type AgenticWidgetInstance,
} from '@infra-tools/agentic-ui';
import { UiActionLogService } from './protocols/ui-action-log.service';
import { TravelerContextComponent } from './agentic/traveler-context.component';

/**
 * demo-monolith — now doubles as the protocol gallery. The chat panel
 * works against any of the three registered backends (AG-UI / Hashbrown
 * / A2UI — reference servers in demo-server); the switcher flips the
 * active one. The MCP-UI section renders inbound UIResources (inline
 * html + a native component-tree of registered widgets).
 *
 * Reference implementations R1 (Hashbrown), R2 (A2UI ui-action), R4
 * (MCP-UI) of docs/plans/reference-implementations-plan.md.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatShellComponent, McpUiResourceComponent, WidgetContainerComponent, TravelerContextComponent],
  styleUrl: './app.scss',
  template: `
    <div class="topbar">
      <div class="brand">
        <span class="mark" aria-hidden="true">◆</span>
        <div class="brand-text">
          <h1>Agentic UI · capability dojo</h1>
          <p>One chat shell · three backends · real generative UI</p>
        </div>
      </div>
      <div class="switcher" data-testid="backend-switcher" role="tablist" aria-label="Backend protocol">
        @for (b of backends; track b.id) {
          <button type="button" role="tab"
                  [attr.data-backend]="b.id"
                  [attr.aria-selected]="active() === b.id"
                  [class.active]="active() === b.id"
                  (click)="switchTo(b.id)">
            <span class="pip" [attr.data-pip]="b.id"></span>{{ b.label }}
          </button>
        }
      </div>
    </div>

    <div class="body">
      <main class="chat-pane">
        <div class="pane-head">
          <span class="status-dot"></span>
          Chat · active backend <code data-testid="active-backend">{{ active() }}</code>
        </div>
        <mvk-chat-shell />
      </main>

      <aside class="rail">
        <article class="panel tips">
          <header class="panel-h"><h2>Try these</h2></header>
          <ul class="tip-list">
            <li><span class="cap gen">Generative UI</span> “Book a flight from LAX to JFK on June 15” · “How many points do I have?” · “Open a high-priority ticket”</li>
            <li><span class="cap hitl">Human-in-the-loop</span> “Redeem 25,000 points for a lounge pass” → approval card</li>
            <li><span class="cap state">Shared state</span> set tier to platinum, then ask “what lounge access do I have?”</li>
          </ul>
        </article>

        <article class="panel">
          <header class="panel-h"><h2>Shared state</h2><span class="tag">→ state</span></header>
          <p class="panel-sub">Sent to the agent every turn — never typed into chat.</p>
          <app-traveler-context />
        </article>

        <article class="panel">
          <header class="panel-h"><h2>Generative UI</h2></header>
          <p class="panel-sub">The widgets the agent renders on a tool call — same over all three backends. Previewed here without an LLM.</p>
          <div class="gen-grid">
            @for (w of demoWidgets; track w.widgetCallId) {
              <div class="gen-cell">
                <span class="tool">{{ w.name }}</span>
                <mvk-widget-container [widget]="w" />
              </div>
            }
          </div>
        </article>

        @if (uiActions().length > 0) {
          <article class="panel" data-testid="ui-action-log">
            <header class="panel-h"><h2>A2UI ui-action log</h2></header>
            <ul class="log">
              @for (a of uiActions(); track a.at) {
                <li><code>{{ a.op }}</code> · run <code>{{ a.runId }}</code> · {{ payloadText(a.payload) }}</li>
              }
            </ul>
          </article>
        }

        <article class="panel">
          <header class="panel-h"><h2>MCP-UI inbound</h2></header>
          <p class="panel-sub">Server-described UI: a native component-tree + sandboxed-iframe HTML.</p>
          <h3 class="sub">component-tree (native widgets)</h3>
          <mvk-mcp-ui-resource [resource]="componentTreeResource" />
          <h3 class="sub">inline html (sandboxed iframe)</h3>
          <mvk-mcp-ui-resource [resource]="htmlResource" />
        </article>
      </aside>
    </div>
  `,
})
export class App {
  private readonly backendRegistry = inject(BackendRegistry);
  private readonly uiActionLog = inject(UiActionLogService);

  protected readonly backends = [
    { id: 'ag-ui', label: 'AG-UI (SSE)' },
    { id: 'hashbrown', label: 'Hashbrown (@hashbrownai/core frames)' },
    { id: 'a2ui', label: 'A2UI (NDJSON + ui-action)' },
  ];

  protected readonly active = signal<string>('ag-ui');
  protected readonly uiActions = computed(() => this.uiActionLog.records());

  /** Sample instances of each registered widget — the generative-UI preview
   *  (same widgets the agent renders when it calls bookFlight / checkPoints /
   *  openTicket). Resolved by name through the ComponentRegistry. */
  protected readonly demoWidgets: AgenticWidgetInstance[] = [
    { widgetCallId: 'demo-flight', name: 'flightCard', props: { bookingId: 'BK-DEMO-1', from: 'LAX', to: 'JFK', date: '2026-06-15', status: 'confirmed' } },
    { widgetCallId: 'demo-points', name: 'pointsCard', props: { balance: 32_500, tier: 'gold' } },
    { widgetCallId: 'demo-ticket', name: 'ticketCard', props: { ticketId: 'TICK-DEMO-1', subject: 'Seat change request', status: 'open', priority: 'normal' } },
  ];

  switchTo(id: string): void {
    this.backendRegistry.setActive(id);
    this.active.set(id);
  }

  protected payloadText(payload: unknown): string {
    if (payload && typeof payload === 'object' && 'message' in payload) {
      return String((payload as { message: unknown }).message);
    }
    return JSON.stringify(payload);
  }

  /** A component tree composed of the host's registered `flightCard` widget. */
  protected readonly componentTreeResource: McpUiResource = {
    uri: 'ui://gallery/component-tree',
    mimeType: MCP_UI_COMPONENT_TREE_MIME,
    title: 'Trip summary (native widgets)',
    content: JSON.stringify({
      component: 'flightCard',
      props: { bookingId: 'BK-DEMO-1', from: 'LAX', to: 'JFK', date: '2026-06-15', status: 'confirmed' },
    }),
  };

  /** An inline HTML card rendered in a sandboxed iframe. */
  protected readonly htmlResource: McpUiResource = {
    uri: 'ui://gallery/html',
    mimeType: MCP_UI_HTML_MIME,
    title: 'Server-rendered HTML',
    content: `
      <article style="font-family: system-ui; padding: 1rem; border: 1px solid #d1d5db; border-radius: 0.5rem;">
        <h2 style="margin:0 0 .5rem">Server-rendered HTML card</h2>
        <p style="margin:0; color:#374151">This HTML came from an MCP-UI resource and runs in a sandboxed iframe (allow-scripts only).</p>
      </article>`,
  };
}
