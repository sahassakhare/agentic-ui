import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  BackendRegistry,
  ChatShellComponent,
  McpUiResourceComponent,
  MCP_UI_COMPONENT_TREE_MIME,
  MCP_UI_HTML_MIME,
  type McpUiResource,
} from '@infra-tools/agentic-ui';
import { UiActionLogService } from './protocols/ui-action-log.service';

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
  imports: [ChatShellComponent, McpUiResourceComponent],
  styleUrl: './app.scss',
  template: `
    <header>
      <h1>@infra-tools/agentic-ui — demo-monolith + protocol gallery</h1>
      <p>One chat shell, three backends. Flip the protocol; the same prompt round-trips over a different wire.</p>
    </header>

    <section class="switcher" data-testid="backend-switcher">
      <span class="label">Backend:</span>
      @for (b of backends; track b.id) {
        <button type="button"
                [attr.data-backend]="b.id"
                [class.active]="active() === b.id"
                (click)="switchTo(b.id)">{{ b.label }}</button>
      }
      <span class="active-note">active: <code data-testid="active-backend">{{ active() }}</code></span>
    </section>

    <main>
      <mvk-chat-shell />
    </main>

    @if (uiActions().length > 0) {
      <section class="ui-actions" data-testid="ui-action-log">
        <h2>A2UI ui-action log</h2>
        <p>Events the A2UI reference server fired, dispatched with their live thread/run ids:</p>
        <ul>
          @for (a of uiActions(); track a.at) {
            <li><code>{{ a.op }}</code> · run <code>{{ a.runId }}</code> · {{ payloadText(a.payload) }}</li>
          }
        </ul>
      </section>
    }

    <section class="mcp-ui">
      <h2>MCP-UI inbound rendering</h2>
      <p>Server-described UI rendered in the host. Inline HTML runs in a sandboxed iframe; the component tree renders as the host's OWN registered widgets.</p>

      <h3>component-tree (native widgets)</h3>
      <mvk-mcp-ui-resource [resource]="componentTreeResource" />

      <h3>inline html (sandboxed iframe)</h3>
      <mvk-mcp-ui-resource [resource]="htmlResource" />
    </section>
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
