import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ThemeService, DEFAULT_TOKENS } from '@infra-tools/agentic-ui';
import { CatalogThemeSource } from './catalog/catalog-theme-source';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { LoginComponent } from './auth/login.component';
import { SurfaceHostComponent } from './render/surface-host.component';
import { CatalogExperienceSource } from './catalog/catalog-experience-source';
import { ApplicationSource, type SurfaceTarget } from './catalog/application-source';
import { PageSource } from './catalog/page-source';
import { shellApi } from './agentic/shell-api';
import { environment } from '../environments/environment';

/** Shell regions arranged around the page content outlet. */
type ShellRegion = 'header' | 'sidenav' | 'aside' | 'footer';

/** Built-in default shell when the application names no shell page. */
const DEFAULT_SHELL: Record<string, readonly SurfaceTarget[]> = {
  header: [{ kind: 'component', name: 'app-header' }],
  sidenav: [{ kind: 'component', name: 'app-sidenav' }],
  aside: [{ kind: 'component', name: 'app-assistant' }],
};

/**
 * Experience Hub — the productized end-user runtime. It renders one governed
 * **Application** inside its **Master Page** (a composable shell of regions —
 * header / sidenav / aside / footer — filled with reusable shell components like
 * a logo, the sidenav control, a header, a footer and the assistant) with the
 * page content (the router-outlet) in the centre. Master, pages, route tree and
 * assistant are all authored in the Studio and rendered here.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoginComponent, SurfaceHostComponent, RouterOutlet],
  template: `
    @if (!auth.isAuthenticated()) {
      <app-login />
    } @else {
      <div class="shell">
        @if (region('header').length) {
          <div class="r-header">
            @for (s of region('header'); track s.kind + ':' + s.name) { <app-surface-host [target]="s" /> }
            <div class="hactions">
              <span class="pill" [class.err]="appSource.error()">@if (appSource.error()) { catalog offline } @else { ● synced {{ appSource.lastSync() }} }</span>
              <button class="mini" (click)="refresh()">↻</button>
            </div>
          </div>
        }

        <div class="mid" [style.gridTemplateColumns]="midCols()">
          @if (region('sidenav').length) {
            <aside class="r-sidenav">@for (s of region('sidenav'); track s.kind + ':' + s.name) { <app-surface-host [target]="s" /> }</aside>
          }
          <main class="content"><router-outlet /></main>
          @if (region('aside').length) {
            <aside class="r-aside">@for (s of region('aside'); track s.kind + ':' + s.name) { <app-surface-host [target]="s" /> }</aside>
          }
        </div>

        @if (region('footer').length) {
          <div class="r-footer">@for (s of region('footer'); track s.kind + ':' + s.name) { <app-surface-host [target]="s" /> }</div>
        }
      </div>

      <!-- App launcher — switch between the governed applications (product-agnostic) -->
      @if (apps().length > 1) {
        <div class="launcher">
          @if (launcherOpen()) {
            <div class="lpop">
              <div class="lhead">Applications</div>
              @for (a of apps(); track a.name) {
                <button class="lapp" [class.on]="a.name === appSource.current()" (click)="switchApp(a.name)">
                  <span class="ln">{{ a.title }}</span><span class="ld">{{ a.description || a.name }}</span>
                </button>
              }
            </div>
          }
          <button class="lbtn" (click)="launcherOpen.set(!launcherOpen())" title="Switch application">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>
          </button>
        </div>
      }
    }
  `,
  styles: [`
    .shell { min-height:100dvh; display:grid; grid-template-rows:auto 1fr auto; }
    .r-header { display:flex; align-items:center; gap:16px; padding:12px 18px; border-bottom:1px solid rgba(120,120,140,.16); }
    .hactions { display:flex; align-items:center; gap:10px; }
    .pill { font-size:12px; padding:5px 10px; border-radius:20px; background:rgba(10,125,50,.1); color:#0a7d32; } .pill.err { background:rgba(192,57,43,.1); color:#c0392b; }
    .mini { font:inherit; font-size:12px; padding:6px 10px; border:1px solid rgba(120,120,140,.28); border-radius:8px; background:transparent; color:inherit; cursor:pointer; }
    .mid { display:grid; min-height:0; }
    .r-sidenav { border-right:1px solid rgba(120,120,140,.16); padding:16px; overflow:auto; }
    .content { padding:22px 26px; overflow:auto; min-width:0; }
    .r-aside { border-left:1px solid rgba(120,120,140,.16); overflow:hidden; display:flex; flex-direction:column; min-height:0; padding:0 12px; }
    .r-footer { display:flex; align-items:center; padding:12px 20px; border-top:1px solid rgba(120,120,140,.16); }
    @media (max-width: 900px) { .mid { grid-template-columns:1fr !important; } }
    .launcher { position:fixed; left:16px; bottom:16px; z-index:60; }
    .lbtn { display:grid; place-items:center; width:44px; height:44px; border-radius:12px; border:1px solid rgba(120,120,140,.25);
      background:var(--surface,#fff); color:#6750a4; cursor:pointer; box-shadow:0 6px 20px rgba(0,0,0,.12); }
    .lbtn:hover { background:rgba(103,80,164,.08); }
    .lpop { position:absolute; left:0; bottom:calc(100% + 10px); min-width:260px; background:var(--surface,#fff);
      border:1px solid rgba(120,120,140,.2); border-radius:14px; box-shadow:0 16px 40px rgba(0,0,0,.16); padding:8px; }
    .lhead { font-size:11px; text-transform:uppercase; letter-spacing:.06em; opacity:.5; padding:6px 10px; }
    .lapp { display:flex; flex-direction:column; gap:1px; width:100%; text-align:left; padding:9px 11px; border:1px solid transparent; border-radius:10px; background:transparent; color:inherit; cursor:pointer; }
    .lapp:hover { background:rgba(120,120,140,.08); } .lapp.on { background:rgba(103,80,164,.12); border-color:rgba(103,80,164,.35); }
    .lapp .ln { font-size:13.5px; font-weight:600; } .lapp .ld { font-size:11.5px; opacity:.55; }
  `],
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly catalog = inject(CatalogExperienceSource);
  protected readonly appSource = inject(ApplicationSource);
  private readonly pages = inject(PageSource);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  private readonly themes = inject(CatalogThemeSource);
  protected readonly tenant = environment.tenant;

  protected readonly launcherOpen = signal(false);
  protected readonly apps = computed(() => this.appSource.applications());

  /** Apply the active application's design tokens (falls back to the platform
   *  default). Re-runs when the app switches or a theme is edited (SSE). */
  private readonly themeEffect = effect(() => {
    const app = this.appSource.application();
    this.theme.apply(this.themes.get(app?.theme) ?? DEFAULT_TOKENS);
  });

  /** Switch the active application and jump to its first page. */
  switchApp(name: string): void {
    this.appSource.setCurrent(name);
    this.launcherOpen.set(false);
    const first = this.appSource.flatNav()[0];
    void this.router.navigateByUrl(first ? '/' + first.fullPath : '/');
  }

  /** The shell = the application's chosen `type:'shell'` page (a composition of
   *  regions), falling back to the built-in default shell. */
  protected readonly shellRegions = computed<Record<string, readonly SurfaceTarget[]>>(() => {
    this.pages.count();
    const name = this.appSource.application()?.master;
    const p = name ? this.pages.get(name) : undefined;
    return (p && p.type === 'shell' && Object.keys(p.regions).length) ? p.regions : DEFAULT_SHELL;
  });

  /** Surfaces in a shell region (empty when the region is unused). */
  protected region(name: ShellRegion): readonly SurfaceTarget[] { return this.shellRegions()[name] ?? []; }

  /** Collapse side columns that have no content. */
  protected readonly midCols = computed(() => {
    const m = this.shellRegions();
    const left = (m['sidenav']?.length ?? 0) ? '280px' : '0';
    const right = (m['aside']?.length ?? 0) ? '380px' : '0';
    return `${left} 1fr ${right}`;
  });

  constructor() {
    // Let the agentic tools drive navigation (they run outside Angular DI).
    shellApi.openExperience = (nameOrPath: string): boolean => this.navigateTo(nameOrPath);
    shellApi.listMenu = () =>
      this.appSource.flatNav().map((n) => ({ name: n.fullPath, title: n.title, kind: 'experience' as const }));
  }

  /** Navigate by full path, page name, or the name of a surface a page contains. */
  private navigateTo(x: string): boolean {
    const flat = this.appSource.flatNav();
    let entry = flat.find((n) => n.fullPath === x || n.page === x);
    if (!entry) {
      entry = flat.find((n) => {
        const p = this.pages.get(n.page);
        return !!p && Object.values(p.regions).some((surfaces) => surfaces.some((s) => s.name === x));
      });
    }
    if (!entry) return false;
    void this.router.navigateByUrl('/' + entry.fullPath);
    return true;
  }

  refresh(): void { void this.appSource.hydrate(); void this.pages.hydrate(); void this.catalog.hydrate(); }
}
