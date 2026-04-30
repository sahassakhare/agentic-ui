import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatShellComponent } from '@maverick/agentic-ui';
import { environment } from '../environments/environment';

/**
 * Root shell. Three-pane layout:
 *  - Top header: matter context + persona switcher
 *  - Left main: routed dashboard / review pages
 *  - Right side: agentic chat shell — the "matter coordinator"
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ChatShellComponent],
  template: `
    <header>
      <div class="brand">
        <strong>Maverick</strong>
        <span class="tag">eDiscovery</span>
      </div>
      <div class="matter">
        <span class="muted">Matter:</span>
        <strong>{{ matterId }}</strong>
        <span class="muted">·</span>
        <span>In re Acme Corp Securities Litigation</span>
      </div>
      <div class="persona">
        <span class="muted">Persona:</span>
        <span class="badge">{{ persona }}</span>
      </div>
    </header>

    <main>
      <section class="content"><router-outlet /></section>
      <aside class="chat">
        <h3>Matter coordinator</h3>
        <p class="muted">Ask about custodians, holds, search, redactions, productions.</p>
        <mvk-chat-shell />
      </aside>
    </main>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    header {
      display: flex; gap: 1.4rem; align-items: center;
      padding: 0.6rem 1.2rem;
      background: #fff; border-bottom: 1px solid #e2e8f0;
      font-size: 0.9rem;
    }
    .brand strong { font-size: 1.05rem; }
    .brand .tag {
      margin-left: 0.5rem;
      padding: 1px 8px; font-size: 0.7em;
      background: #e0e7ff; color: #3730a3;
      border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .matter { display: flex; gap: 0.4rem; align-items: baseline; }
    .persona { margin-left: auto; display: flex; gap: 0.4rem; align-items: center; }
    .muted { color: #64748b; }
    .badge {
      padding: 2px 8px; font-size: 0.75em;
      background: #fef3c7; color: #92400e; border-radius: 999px;
      text-transform: capitalize;
    }

    main { display: grid; grid-template-columns: minmax(0, 1fr) 420px; flex: 1; min-height: 0; }
    .content { padding: 1.2rem 1.6rem; overflow: auto; }
    .chat {
      padding: 0.8rem 0.9rem;
      border-left: 1px solid #e2e8f0; background: #fff;
      display: flex; flex-direction: column; min-height: 0; gap: 0.4rem;
    }
    .chat h3 { margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    .chat p { margin: 0 0 0.4rem; font-size: 0.8rem; }
    .chat mvk-chat-shell { flex: 1; min-height: 0; }
  `,
})
export class App {
  protected readonly matterId = environment.matterId;
  protected readonly persona = environment.persona;
}
