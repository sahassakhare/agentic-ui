import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Dashboard</h2>
    <p class="muted">If you got here by typing "show me the dashboard" in the chat,
      the <code>navigate</code> action just changed the URL. The agent did not
      fetch this page — it asked the host's Router to.</p>
    <div class="grid">
      <article><h3>Active sessions</h3><p>3</p></article>
      <article><h3>Open tickets</h3><p>1</p></article>
      <article><h3>Loyalty tier</h3><p>Gold</p></article>
    </div>
  `,
  styles: `
    :host { display: block; }
    h2 { margin: 0 0 0.6rem; font-size: 1.3rem; }
    h3 { margin: 0 0 0.4rem; font-size: 0.85rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    p { margin: 0; color: #1e293b; }
    .muted { color: #475569; margin-bottom: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; }
    article { padding: 0.9rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 0.5rem; font-size: 1.5rem; font-weight: 600; }
    article p { font-size: 1.5rem; font-weight: 600; }
    code { background: #e2e8f0; padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }
  `,
})
export class DashboardComponent {}
