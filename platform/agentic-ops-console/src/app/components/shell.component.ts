import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AutoRefreshService } from '../services/auto-refresh.service';
import { CatalogStreamService } from '../services/catalog-stream.service';

@Component({
  selector: 'ops-shell',
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="layout">
      <aside>
        <div class="brand">
          <span class="mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M12 12 3 7m9 5 9-5m-9 5v10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity=".55"/>
            </svg>
          </span>
          <span class="wordmark"><strong>Agentic</strong><span class="dim">ops console</span></span>
          <button class="theme" type="button" [attr.aria-label]="'Switch to ' + (dark() ? 'light' : 'dark') + ' theme'" (click)="toggleTheme()">
            @if (dark()) {
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            } @else {
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M20 14.3A8 8 0 1 1 9.7 4a6.4 6.4 0 0 0 10.3 10.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
            }
          </button>
        </div>
        @if (authMode === 'disabled') {
          <div class="warn-banner">
            ⚠️ AUTH_MODE=disabled
          </div>
        }
        <nav>
          <a routerLink="/capabilities" routerLinkActive="active">Capabilities</a>
          <a routerLink="/mfes" routerLinkActive="active">MFE remotes</a>
          <a routerLink="/agents" routerLinkActive="active">Agents</a>
          <a routerLink="/role-mappings" routerLinkActive="active">Role mappings</a>
          <a routerLink="/audit" routerLinkActive="active">Audit chain</a>
          <a routerLink="/usage" routerLinkActive="active">Usage</a>
          <a routerLink="/activity" routerLinkActive="active">Activity</a>
          <a routerLink="/topology" routerLinkActive="active">Topology</a>
          @if (isAdmin()) {
            <div class="nav-section dim">PLATFORM</div>
            <a routerLink="/tenants" routerLinkActive="active">Tenants</a>
          }
        </nav>
        <footer>
          @if (principal(); as p) {
            <div class="user">
              <strong>{{ p.displayName ?? p.sub }}</strong>
              <div class="dim mono">{{ p.tenantId }}</div>
              <div class="roles">
                @for (role of p.roles; track role) {
                  <span class="badge" [class.primary]="role === 'platform-admin'">{{ role }}</span>
                }
              </div>
            </div>
          }
          @if (authMode === 'disabled') {
            <div class="switch-tenant">
              <label class="dim small">Switch tenant</label>
              <div class="switch-row">
                <input
                  [(ngModel)]="tenantInput"
                  class="mono"
                  placeholder="tenant id"
                  (keyup.enter)="switchTenant()"
                />
                <button class="btn" type="button" (click)="switchTenant()">Go</button>
              </div>
            </div>
          }
          <div class="auto-refresh">
            <span
              class="dot"
              [class.live]="stream.isLive() || autoRefresh.running()"
              [title]="liveTooltip()"
            ></span>
            <span class="dim small">{{ liveLabel() }}</span>
          </div>
          <button class="btn" type="button" (click)="logout()">Sign out</button>
        </footer>
      </aside>
      <main>
        <router-outlet />
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .layout {
      display: grid;
      grid-template-columns: 240px 1fr;
      height: 100vh;
    }
    aside {
      background: var(--bg-elev);
      border-right: 1px solid var(--border);
      padding: 16px;
      display: flex;
      flex-direction: column;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .brand .mark { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
      background: var(--accent); color: var(--accent-fg); flex: none; box-shadow: var(--shadow-1); }
    .brand .wordmark { display: flex; flex-direction: column; line-height: 1.15; }
    .brand strong { font-weight: 650; }
    .brand .wordmark .dim { font-size: 11px; }
    .dim { color: var(--fg-muted); }
    .brand .theme { margin-left: auto; background: transparent; border: 1px solid var(--border); color: var(--fg-muted);
      width: 28px; height: 28px; border-radius: 6px; display: grid; place-items: center; cursor: pointer; }
    .brand .theme:hover { color: var(--fg); border-color: var(--border-strong); }
    .warn-banner {
      background: rgba(210, 153, 34, 0.12);
      border: 1px solid var(--warn);
      color: var(--warn);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      text-align: center;
    }
    nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
    nav a {
      display: block;
      padding: 8px 12px;
      border-radius: 6px;
      color: var(--fg);
    }
    nav a:hover { background: var(--bg-elev-2); text-decoration: none; }
    nav a.active {
      background: var(--bg-elev-2);
      color: var(--accent);
      font-weight: 600;
    }
    .nav-section {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1px;
      padding: 12px 12px 4px;
    }
    footer {
      border-top: 1px solid var(--border);
      padding-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .user strong { display: block; }
    .roles { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
    .badge.primary { color: var(--accent); border-color: var(--accent); }
    .small { font-size: 11px; }
    .switch-tenant label { display: block; margin-bottom: 4px; }
    .switch-row { display: flex; gap: 6px; }
    .switch-row input {
      flex: 1;
      min-width: 0;
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
    }
    .switch-row input:focus { outline: none; border-color: var(--accent); }
    .switch-row .btn { padding: 4px 10px; font-size: 12px; }
    .auto-refresh {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 0;
    }
    .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--fg-muted);
      transition: background 0.2s;
    }
    .dot.live {
      background: var(--good);
      box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.6);
      animation: pulse 2.5s infinite;
    }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5); }
      70%  { box-shadow: 0 0 0 6px rgba(63, 185, 80, 0); }
      100% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }
    }
    main {
      overflow: auto;
      padding: 24px 32px;
    }
  `],
})
export class ShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly autoRefresh = inject(AutoRefreshService);
  readonly stream = inject(CatalogStreamService);

  readonly authMode = this.auth.authMode;
  readonly principal = this.auth.principal;
  readonly isAdmin = this.auth.isPlatformAdmin;
  readonly tenantInput = signal('');
  readonly dark = signal(this.initialDark());

  private initialDark(): boolean {
    const saved = localStorage.getItem('ops-theme');
    if (saved === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); return true; }
    if (saved === 'light') { document.documentElement.setAttribute('data-theme', 'light'); return false; }
    // Ops console defaults to dark (its heritage look) when nothing is saved.
    document.documentElement.setAttribute('data-theme', 'dark');
    return true;
  }

  toggleTheme(): void {
    const next = !this.dark();
    this.dark.set(next);
    const mode = next ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('ops-theme', mode);
  }

  liveLabel(): string {
    if (this.stream.isLive()) return 'live (SSE)';
    if (this.autoRefresh.running()) return `live (polling ${this.autoRefresh.intervalMs() / 1000}s)`;
    return 'paused';
  }

  liveTooltip(): string {
    if (this.stream.isLive()) return 'Server-Sent Events stream open — sub-second updates.';
    if (this.autoRefresh.running()) return `SSE unavailable; polling every ${this.autoRefresh.intervalMs() / 1000}s.`;
    return 'Updates paused (tab hidden).';
  }

  switchTenant(): void {
    const t = this.tenantInput().trim();
    if (!t) return;
    if (!/^[a-zA-Z0-9_.-]+$/.test(t)) return;
    this.auth.setTenantId(t);
    this.tenantInput.set('');
    // Reload the active route so the page re-fetches against the
    // new tenant. Lightweight — avoids each page wiring a tenant
    // signal of its own.
    void this.router.navigateByUrl(this.router.url, { skipLocationChange: true })
      .then(() => this.router.navigate([this.router.url]));
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
