import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Feature tour</h2>
    <p>This demo highlights four library features the other demos don't:</p>
    <ul>
      <li><strong>ActionRegistry</strong> — agent-triggered route navigation and toast notifications.</li>
      <li><strong>FormRegistry</strong> — schema-driven form rendered by <code>&lt;mvk-form-renderer&gt;</code>.</li>
      <li><strong>DataSourceRegistry</strong> — a tool calls a typed REST adapter instead of hard-coding fetch.</li>
      <li><strong>IntentRegistry</strong> — a phrase-to-route mapping registered for pre-LLM short-circuit (consumer-side wiring required).</li>
    </ul>
    <h3>Try these prompts in the chat panel →</h3>
    <ol>
      <li><em>"Take me to the dashboard"</em> → <code>navigateTo</code> tool dispatches the <code>navigate</code> action.</li>
      <li><em>"Show a success toast saying my booking is confirmed"</em> → <code>showToast</code> tool dispatches the <code>showToast</code> action.</li>
      <li><em>"Look up user U-1042"</em> → <code>lookupUser</code> tool queries the <code>users</code> data source.</li>
      <li><em>"Edit my profile, set newsletter to true"</em> → <code>editProfile</code> tool renders the <code>profileForm</code>.</li>
    </ol>
  `,
  styles: `
    :host { display: block; }
    h2 { margin: 0 0 0.5rem; font-size: 1.3rem; }
    h3 { margin: 1.4rem 0 0.4rem; font-size: 1rem; color: #475569; }
    p { color: #475569; margin: 0 0 0.6rem; }
    ul, ol { padding-left: 1.4rem; color: #1e293b; line-height: 1.8; margin: 0 0 0.8rem; }
    code { background: #e2e8f0; padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }
    em { background: #fef3c7; padding: 0 4px; font-style: normal; border-radius: 3px; }
  `,
})
export class HomeComponent {}
