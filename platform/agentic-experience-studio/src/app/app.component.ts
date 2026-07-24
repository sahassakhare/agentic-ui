import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'aes-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <strong>Agentic Experience Studio</strong>
      <nav>
        <a routerLink="/experiences" routerLinkActive="active">Experiences</a>
        <a routerLink="/prompts" routerLinkActive="active">Prompts</a>
        <a routerLink="/skills" routerLinkActive="active">Skills</a>
        <a routerLink="/knowledge" routerLinkActive="active">Knowledge</a>
        <a routerLink="/memory" routerLinkActive="active">Memory</a>
        <a routerLink="/workflows" routerLinkActive="active">Workflows</a>
        <a routerLink="/navigation" routerLinkActive="active">Navigation</a>
        <a routerLink="/policy" routerLinkActive="active">Policy</a>
      </nav>
      <span class="hint">Independent of the ops console</span>
      @if (auth.isAuthenticated()) {
        <span class="tenant">{{ auth.tenant() }}</span>
        <button class="logout" (click)="logout()">Sign out</button>
      }
    </header>
    <main><router-outlet /></main>
  `,
  styles: [`
    .topbar { display: flex; align-items: center; gap: 1.5rem; padding: .75rem 1.25rem;
      border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
    nav a { text-decoration: none; padding: .25rem .5rem; border-radius: 6px; color: inherit; }
    nav a.active { background: color-mix(in srgb, currentColor 12%, transparent); }
    .hint { margin-left: auto; opacity: .6; font-size: .8rem; }
    .tenant { font-size: .8rem; opacity: .8; }
    .logout { padding: .2rem .6rem; font-size: .8rem; }
    main { padding: 1.25rem; max-width: 1100px; }
  `],
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
