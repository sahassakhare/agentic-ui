import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { ToastHostComponent } from './components/toast-host.component';

const NAV = [
  { path: '/experiences', label: 'Experiences' },
  { path: '/applications', label: 'Applications' },
  { path: '/pages', label: 'Pages' },
  { path: '/components', label: 'Components' },
  { path: '/mfes', label: 'MFEs' },
  { path: '/forms', label: 'Forms' },
  { path: '/workflows', label: 'Workflows' },
  { path: '/decisions', label: 'Decisions' },
  { path: '/themes', label: 'Themes' },
  { path: '/prompts', label: 'Prompts' },
  { path: '/skills', label: 'Skills' },
  { path: '/knowledge', label: 'Knowledge' },
  { path: '/memory', label: 'Memory' },
  { path: '/navigation', label: 'Navigation' },
  { path: '/tools', label: 'Tools' },
  { path: '/datasources', label: 'Data Sources' },
  { path: '/validations', label: 'Validation' },
  { path: '/policy', label: 'Policy' },
] as const;

/**
 * App shell (AEP Seam E). Sticky control-plane topbar: brand mark, primary
 * navigation with active state, tenant context, theme toggle, sign-out — plus
 * the app-wide toast host. All visuals come from the design-system tokens.
 */
@Component({
  selector: 'aes-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastHostComponent],
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/experiences" aria-label="Experience Studio home">
        <span class="mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M12 12 3 7m9 5 9-5m-9 5v10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity=".55"/>
          </svg>
        </span>
        <span class="wordmark">Experience&nbsp;Studio</span>
      </a>

      @if (auth.isAuthenticated()) {
        <nav class="nav" aria-label="Primary">
          @for (item of nav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active">{{ item.label }}</a>
          }
        </nav>

        <div class="controls">
          <button class="btn btn-ghost btn-icon" type="button" [attr.aria-label]="'Switch to ' + (dark() ? 'light' : 'dark') + ' theme'" (click)="toggleTheme()">
            @if (dark()) {
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            } @else {
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M20 14.3A8 8 0 1 1 9.7 4a6.4 6.4 0 0 0 10.3 10.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
            }
          </button>
          <span class="tenant" title="Active tenant">
            <span class="dot" aria-hidden="true"></span>{{ auth.tenant() }}
          </span>
          <button class="btn btn-ghost btn-sm" type="button" (click)="logout()">Sign out</button>
        </div>
      } @else {
        <span class="spacer"></span>
        <span class="faint" style="font-size:var(--fs-sm)">Author governed experiences</span>
      }
    </header>

    <main><router-outlet /></main>
    <aes-toast-host />
  `,
  styles: [`
    :host { display: block; min-height: 100%; }
    .topbar {
      position: sticky; top: 0; z-index: 40;
      display: flex; align-items: center; gap: var(--s5);
      padding: 0 var(--s5); height: 58px;
      background: color-mix(in srgb, var(--surface) 82%, transparent);
      backdrop-filter: saturate(1.4) blur(10px);
      border-bottom: 1px solid var(--border);
    }
    .brand { display: inline-flex; align-items: center; gap: var(--s2); color: var(--text); font-weight: 650; letter-spacing: -.01em; text-decoration: none; }
    .brand:hover { text-decoration: none; }
    .mark { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
      background: var(--brand); color: var(--on-brand); box-shadow: var(--shadow-1); }
    .wordmark { font-size: var(--fs-md); }
    .nav { display: flex; align-items: center; gap: var(--s1); overflow-x: auto; scrollbar-width: none; }
    .nav::-webkit-scrollbar { display: none; }
    .nav a { color: var(--text-muted); font-size: var(--fs-sm); font-weight: 500;
      padding: .4rem .6rem; border-radius: var(--r-sm); white-space: nowrap; text-decoration: none;
      transition: background .12s ease, color .12s ease; }
    .nav a:hover { background: var(--surface-2); color: var(--text); text-decoration: none; }
    .nav a.active { background: var(--brand-soft); color: var(--brand); font-weight: 600; }
    .controls { margin-left: auto; display: flex; align-items: center; gap: var(--s2); }
    .tenant { display: inline-flex; align-items: center; gap: var(--s2); font-size: var(--fs-sm); font-weight: 550;
      padding: .3rem .6rem; border: 1px solid var(--border); border-radius: var(--r-full); color: var(--text); }
    .tenant .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
    main { display: block; }
    @media (max-width: 860px) {
      .topbar { gap: var(--s3); }
      .wordmark { display: none; }
      .tenant { display: none; }
    }
  `],
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly nav = NAV;
  protected readonly dark = signal(this.initialDark());

  private initialDark(): boolean {
    const saved = localStorage.getItem('aes-theme');
    if (saved === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); return true; }
    if (saved === 'light') { document.documentElement.setAttribute('data-theme', 'light'); return false; }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }

  toggleTheme(): void {
    const next = !this.dark();
    this.dark.set(next);
    const mode = next ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('aes-theme', mode);
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
