import { Component } from '@angular/core';
import { ChatShellComponent } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-root',
  imports: [ChatShellComponent],
  template: `
    <header>
      <h1>@infra-tools/agentic-ui — multi-agent example</h1>
      <p>One orchestrator routes to three specialists (bookings, loyalty, support). Try:</p>
      <ul>
        <li><em>"Book a flight from LAX to JFK on March 5"</em></li>
        <li><em>"How many loyalty points do I have?"</em></li>
        <li><em>"Open a support ticket — my refund hasn't arrived"</em></li>
      </ul>
    </header>
    <main>
      <mvk-chat-shell />
    </main>
  `,
  styles: `
    :host { display: block; max-width: 880px; margin: 0 auto; padding: 1.5rem 1rem 2.5rem; }
    header h1 { margin: 0 0 0.5rem; font-size: 1.4rem; color: #0f172a; }
    header p  { margin: 0 0 0.4rem; color: #475569; font-size: 0.9rem; }
    header ul { margin: 0 0 1.2rem 1.2rem; padding: 0; color: #475569; font-size: 0.85rem; }
    header em { font-family: ui-monospace, "SF Mono", Menlo, monospace; background: #e2e8f0; padding: 1px 6px; border-radius: 4px; font-style: normal; }
    main { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(15,23,42,0.04); }
  `,
})
export class App {}
