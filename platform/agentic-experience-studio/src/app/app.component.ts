import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'aes-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <strong>Agentic Experience Studio</strong>
      <nav>
        <a routerLink="/experiences" routerLinkActive="active">Experiences</a>
      </nav>
      <span class="hint">Independent of the ops console</span>
    </header>
    <main><router-outlet /></main>
  `,
  styles: [`
    .topbar { display: flex; align-items: center; gap: 1.5rem; padding: .75rem 1.25rem;
      border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
    nav a { text-decoration: none; padding: .25rem .5rem; border-radius: 6px; color: inherit; }
    nav a.active { background: color-mix(in srgb, currentColor 12%, transparent); }
    .hint { margin-left: auto; opacity: .6; font-size: .8rem; }
    main { padding: 1.25rem; max-width: 1100px; }
  `],
})
export class App {}
