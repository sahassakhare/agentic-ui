import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from './services/auth.service';
import { FeatureFlagsService } from './services/feature-flags.service';
import { AppFilterService } from './services/app-filter.service';
import { FormsModule } from '@angular/forms';
import { ToastHostComponent } from './components/toast-host.component';
import { CommandPaletteComponent } from './components/command-palette.component';
import { CopilotRailComponent } from './copilot/copilot-rail.component';
import { environment } from '../environments/environment';

const NAV = [
  { path: '/experiences', label: 'Experiences' },
  { path: '/templates', label: 'Templates' },
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
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, ToastHostComponent, CommandPaletteComponent,
    CopilotRailComponent, MatToolbarModule, MatTabsModule, MatButtonModule,
    MatSlideToggleModule, MatTooltipModule, FormsModule,
  ],
  template: `
    <mat-toolbar class="topbar">
      <a class="brand" routerLink="/experiences" aria-label="Experience Studio home">
        <span class="mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M12 12 3 7m9 5 9-5m-9 5v10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity=".55"/>
          </svg>
        </span>
        <span class="wordmark">Experience&nbsp;Studio</span>
      </a>

      <span class="spacer"></span>

      @if (auth.isAuthenticated()) {
        @if (appFilter.apps().length) {
          <label class="appfilter" [class.active]="!!appFilter.selected()" title="Filter every category by the application that uses it">
            <span class="afl">App</span>
            <select [ngModel]="appFilter.selected() ?? ''" (ngModelChange)="appFilter.selected.set($event || null)" aria-label="Filter by application">
              <option value="">All applications</option>
              @for (a of appFilter.apps(); track a.id) { <option [value]="a.name">{{ a.name }}</option> }
            </select>
          </label>
        }
        <mat-slide-toggle class="ai-toggle" [checked]="flags.aiAssistedAuthoring()" [disabled]="!platformAllowsAssistant"
          (change)="onAssistantToggle($event.checked)"
          matTooltip="AI authoring assistant — drafts capabilities from a description. Authoring works normally without it.">
          AI assistant
        </mat-slide-toggle>
        <button matIconButton [attr.aria-label]="'Switch to ' + (dark() ? 'light' : 'dark') + ' theme'" (click)="toggleTheme()">
          @if (dark()) {
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          } @else {
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 14.3A8 8 0 1 1 9.7 4a6.4 6.4 0 0 0 10.3 10.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          }
        </button>
        <span class="tenant" title="Active tenant"><span class="dot" aria-hidden="true"></span>{{ auth.tenant() }}</span>
        <button matButton (click)="logout()">Sign out</button>
      } @else {
        <span class="faint" style="font-size:var(--fs-sm)">Author governed experiences</span>
      }
    </mat-toolbar>

    @if (auth.isAuthenticated()) {
      <nav mat-tab-nav-bar [tabPanel]="tabPanel" class="navbar" aria-label="Primary" mat-stretch-tabs="false">
        @for (item of nav; track item.path) {
          <a mat-tab-link [routerLink]="item.path" routerLinkActive #rla="routerLinkActive" [active]="rla.isActive">{{ item.label }}</a>
        }
      </nav>
    }

    <mat-tab-nav-panel #tabPanel>
      <div class="workspace">
        <main><router-outlet /></main>
        @if (auth.isAuthenticated()) { <aes-copilot-rail /> }
      </div>
    </mat-tab-nav-panel>
    <aes-toast-host />
    <aes-command-palette />
  `,
  styles: [`
    :host { display: block; min-height: 100%; }
    .topbar { position: sticky; top: 0; z-index: 41; gap: var(--s3); border-bottom: 1px solid var(--border); }
    .appfilter { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: var(--r-sm); padding: 3px 8px; font-size: var(--fs-sm); }
    .appfilter.active { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, transparent); }
    .appfilter .afl { opacity: .6; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .appfilter select { border: none; background: transparent; color: inherit; font: inherit; font-size: var(--fs-sm); cursor: pointer; max-width: 180px; }
    @media (max-width: 860px) { .appfilter { display: none; } }
    .brand { display: inline-flex; align-items: center; gap: var(--s2); color: var(--text); font-weight: 650; letter-spacing: -.01em; text-decoration: none; }
    .brand:hover { text-decoration: none; }
    .mark { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
      background: var(--brand); color: var(--on-brand); }
    .wordmark { font-size: var(--fs-md); }
    .spacer { flex: 1 1 auto; }
    .tenant { display: inline-flex; align-items: center; gap: var(--s2); font-size: var(--fs-sm); font-weight: 550;
      padding: .3rem .6rem; border: 1px solid var(--border); border-radius: var(--r-full); color: var(--text); }
    .tenant .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
    .navbar { position: sticky; top: 64px; z-index: 40; background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 var(--s3); }
    .faint { color: var(--text-muted); }
    .ai-toggle { margin-right: var(--s2); font-size: var(--fs-sm); }
    .workspace { display: flex; align-items: flex-start; }
    main { display: block; flex: 1 1 auto; min-width: 0; }
    aes-copilot-rail { position: sticky; top: 112px; align-self: stretch; }
    @media (max-width: 860px) { .wordmark { display: none; } .tenant { display: none; } .navbar { top: 56px; } }
  `],
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly flags = inject(FeatureFlagsService);
  protected readonly appFilter = inject(AppFilterService);
  private readonly router = inject(Router);
  protected readonly nav = NAV;
  protected readonly dark = signal(this.initialDark());

  /** The platform/tenant layer must permit the copilot; an author can only opt OUT,
   *  so the toggle is disabled when nothing is there to enable. */
  protected readonly platformAllowsAssistant =
    (environment as { featureFlags?: Record<string, boolean> }).featureFlags?.['aiAssistedAuthoring'] === true;

  /** Top-bar toggle: author opt-out of the AI copilot (persisted per browser). */
  onAssistantToggle(checked: boolean): void {
    this.flags.setAuthorOptOut('aiAssistedAuthoring', !checked);
  }

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
