import { Component, computed, inject } from '@angular/core';
import { CapabilityRegistry, ToolRegistry } from '@infra-tools/agentic-ui';
import { ChatShellComponent } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-root',
  imports: [ChatShellComponent],
  styleUrl: './app.scss',
  template: `
    <header>
      <h1>demo-shell — Native Federation host</h1>
      <p>Capabilities: <strong>{{ capabilitySummary() }}</strong></p>
    </header>
    <main>
      <mvk-chat-shell />
    </main>
  `,
})
export class App {
  private readonly capabilities = inject(CapabilityRegistry);
  private readonly tools = inject(ToolRegistry);

  protected readonly capabilitySummary = computed(() => {
    const remotes = this.capabilities.list();
    const totalTools = this.tools.list().length;
    if (remotes.length === 0) return `${totalTools} host tool(s); no remotes loaded.`;
    return `${totalTools} tool(s) across ${remotes.length} remote(s): ${remotes.map((r) => r.remoteName).join(', ')}`;
  });
}
