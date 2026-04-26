import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <main>
      <h1>{{ title() }}</h1>
      <p>This is the loyalty MFE remote. It is normally consumed by the host shell via Native Federation, not visited directly. Exposes <code>./Capability</code> with <code>checkPointsTool</code>, <code>redeemPointsTool</code>, and the <code>pointsCard</code> widget.</p>
      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; padding: 2rem; max-width: 720px; margin: 0 auto; color: #0f172a; }
    h1 { font-size: 1.4rem; margin: 0 0 0.6rem; }
    p { color: #475569; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
  `,
})
export class App {
  protected readonly title = signal('demo-remote-loyalty');
}
