import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'ops-shell',
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="layout">
      <aside>
        <div class="brand">
          <strong>Agentic</strong>
          <span class="dim">ops console</span>
        </div>
        @if (authMode === 'disabled') {
          <div class="warn-banner">
            ⚠️ AUTH_MODE=disabled
          </div>
        }
        <nav>
          <a routerLink="/capabilities" routerLinkActive="active">Capabilities</a>
          <a routerLink="/mfes" routerLinkActive="active">MFE remotes</a>
          <a routerLink="/role-mappings" routerLinkActive="active">Role mappings</a>
          <a routerLink="/audit" routerLinkActive="active">Audit chain</a>
          <a routerLink="/usage" routerLinkActive="active">Usage</a>
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
      font-size: 16px;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .brand strong { font-weight: 600; }
    .dim { color: var(--fg-muted); }
    .brand span { margin-left: 6px; font-size: 12px; }
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
    main {
      overflow: auto;
      padding: 24px 32px;
    }
  `],
})
export class ShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly authMode = this.auth.authMode;
  readonly principal = this.auth.principal;
  readonly isAdmin = this.auth.isPlatformAdmin;
  readonly tenantInput = signal('');

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
