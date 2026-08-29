/**
 * The catalog-driven application shell (shell mode). Renders one governed
 * **Application** inside its **master page** (a composable shell of regions —
 * header / sidenav / aside / footer — filled with shell components) with the
 * page content (the router-outlet) in the centre. Master, pages, route tree and
 * theme are all authored in the Studio and rendered here.
 *
 * Bootstrap this as the app root in shell mode:
 * `bootstrapApplication(CatalogShellComponent, appConfig)`. Login stays the app's
 * concern — gate it with a route guard, or provide CATALOG_AUTH.isAuthenticated().
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ThemeService, DEFAULT_TOKENS } from '@infra-tools/agentic-ui';
import { CatalogSurfaceHostComponent } from '../render/surface-host.component';
import { ApplicationSource, type SurfaceTarget } from '../application-source';
import { PageSource } from '../page-source';
import { CatalogThemeSource } from '../content-sources';
import { CATALOG_AUTH } from '../catalog-config';

type ShellRegion = 'header' | 'sidenav' | 'aside' | 'footer';

/** Built-in default shell when the application names no master (shell) page. */
const DEFAULT_SHELL: Record<string, readonly SurfaceTarget[]> = {
  header: [{ kind: 'component', name: 'app-header' }],
  sidenav: [{ kind: 'component', name: 'app-sidenav' }],
  aside: [{ kind: 'component', name: 'app-assistant' }],
};

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CatalogSurfaceHostComponent, RouterOutlet],
  template: `
    @if (!authenticated()) {
      <div class="signin">Sign in required.</div>
    } @else {
      <div class="shell">
        @if (region('header').length) {
          <div class="r-header">
            @for (s of region('header'); track s.kind + ':' + s.name) { <catalog-surface-host [target]="s" /> }
            <div class="hactions">
              <span class="pill" [class.err]="appSource.error()">@if (appSource.error()) { catalog offline } @else { ● synced {{ appSource.lastSync() }} }</span>
              <button class="mini" (click)="refresh()">↻</button>
            </div>
          </div>
        }

        <div class="mid" [style.gridTemplateColumns]="midCols()">
          @if (region('sidenav').length) {
            <aside class="r-sidenav">@for (s of region('sidenav'); track s.kind + ':' + s.name) { <catalog-surface-host [target]="s" /> }</aside>
          }
          <main class="content"><router-outlet /></main>
          @if (region('aside').length) {
            <aside class="r-aside">@for (s of region('aside'); track s.kind + ':' + s.name) { <catalog-surface-host [target]="s" /> }</aside>
          }
        </div>

        @if (region('footer').length) {
          <div class="r-footer">@for (s of region('footer'); track s.kind + ':' + s.name) { <catalog-surface-host [target]="s" /> }</div>
        }
      </div>

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
    .signin { padding:40px; text-align:center; opacity:.7; }
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
export class CatalogShellComponent {
  protected readonly appSource = inject(ApplicationSource);
  private readonly pages = inject(PageSource);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  private readonly themes = inject(CatalogThemeSource);
  private readonly auth = inject(CATALOG_AUTH);

  protected readonly launcherOpen = signal(false);
  protected readonly apps = computed(() => this.appSource.applications());
  protected authenticated(): boolean { return this.auth.isAuthenticated?.() ?? true; }

  /** Apply the active application's design tokens (falls back to the default). */
  private readonly themeEffect = effect(() => {
    const app = this.appSource.application();
    this.theme.apply(this.themes.get(app?.theme) ?? DEFAULT_TOKENS);
  });

  switchApp(name: string): void {
    this.appSource.setCurrent(name);
    this.launcherOpen.set(false);
    const first = this.appSource.flatNav()[0];
    void this.router.navigateByUrl(first ? '/' + first.fullPath : '/');
  }

  /** The shell = the application's chosen master (shell) page, else the default. */
  protected readonly shellRegions = computed<Record<string, readonly SurfaceTarget[]>>(() => {
    this.pages.count();
    const name = this.appSource.application()?.master;
    const p = name ? this.pages.get(name) : undefined;
    return (p && p.type === 'shell' && Object.keys(p.regions).length) ? p.regions : DEFAULT_SHELL;
  });

  protected region(name: ShellRegion): readonly SurfaceTarget[] { return this.shellRegions()[name] ?? []; }

  protected readonly midCols = computed(() => {
    const m = this.shellRegions();
    const left = (m['sidenav']?.length ?? 0) ? '280px' : '0';
    const right = (m['aside']?.length ?? 0) ? '380px' : '0';
    return `${left} 1fr ${right}`;
  });

  refresh(): void { void this.appSource.hydrate(); void this.pages.hydrate(); }
}
