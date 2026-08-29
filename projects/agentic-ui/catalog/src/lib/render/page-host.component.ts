/**
 * Renders one governed **Page** — a routed, designed layout. Resolves the page
 * for the current URL (via the application's route tree), enforces the page's
 * access gate, arranges its regions per the layout template, and renders each
 * surface through {@link CatalogSurfaceHostComponent}. This is the unit the
 * router mounts per route.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs';
import { CatalogSurfaceHostComponent } from './surface-host.component';
import { ApplicationSource } from '../application-source';
import { PageSource, type PageDef } from '../page-source';
import { CATALOG_AUTH } from '../catalog-config';

@Component({
  selector: 'catalog-page-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CatalogSurfaceHostComponent],
  template: `
    @if (page(); as p) {
      @if (denied()) {
        <div class="denied">You don't have access to this page ({{ deniedReason() }}).</div>
      } @else {
        <div class="page" [attr.data-layout]="p.layout">
          @for (region of regionNames(); track region) {
            <section class="region" [attr.data-region]="region">
              @for (t of p.regions[region]; track t.kind + ':' + t.name) {
                <catalog-surface-host [target]="t" />
              }
            </section>
          }
        </div>
      }
    } @else {
      <div class="empty">No page mapped to this route.</div>
    }
  `,
  styles: [`
    .page { display:grid; gap:18px; align-items:start; }
    .page[data-layout='single'] { grid-template-columns:1fr; }
    .page[data-layout='two-column'] { grid-template-columns:1fr 1fr; }
    .page[data-layout='sidebar-right'] { grid-template-columns:1fr 340px; }
    .page[data-layout='sidebar-left'] { grid-template-columns:340px 1fr; }
    .page[data-layout='stacked'] { grid-template-columns:1fr; }
    .page[data-layout='grid'] { grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); }
    .region { display:flex; flex-direction:column; gap:18px; min-width:0; }
    @media (max-width: 900px) { .page { grid-template-columns:1fr !important; } }
    .denied, .empty { padding:16px 18px; border-radius:12px; font-size:14px;
      background:rgba(120,120,140,.08); border:1px solid rgba(120,120,140,.16); }
    .denied { background:rgba(192,57,43,.08); border-color:rgba(192,57,43,.3); color:#c0392b; }
  `],
})
export class CatalogPageHostComponent {
  private readonly router = inject(Router);
  private readonly appSource = inject(ApplicationSource);
  private readonly pages = inject(PageSource);
  private readonly auth = inject(CATALOG_AUTH);

  private readonly currentPath = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => this.normalize(e.urlAfterRedirects)),
    ),
    { initialValue: this.normalize(this.router.url) },
  );
  private normalize(url: string): string { return url.split('?')[0].replace(/^\/+|\/+$/g, ''); }

  protected readonly page = computed<PageDef | undefined>(() => {
    this.pages.count();
    const flat = this.appSource.flatNav();
    if (!flat.length) return undefined;
    const path = this.currentPath();
    const entry = (path ? flat.find((n) => n.fullPath === path) : flat[0]) ?? flat[0];
    return this.pages.get(entry.page);
  });

  protected readonly regionNames = computed(() => Object.keys(this.page()?.regions ?? {}));

  protected readonly denied = computed(() => {
    const a = this.page()?.access;
    if (!a) return false;
    const persona = this.auth.persona?.() ?? 'end-user';
    const held = new Set(this.auth.permissions?.() ?? []);
    if (a.personas?.length && !a.personas.includes(persona)) return true;
    if (a.scopes?.length && !a.scopes.every((s) => held.has(s))) return true;
    return false;
  });
  protected readonly deniedReason = computed(() => {
    const a = this.page()?.access;
    if (!a) return '';
    const persona = this.auth.persona?.() ?? 'end-user';
    if (a.personas?.length && !a.personas.includes(persona)) return `persona "${persona}" not allowed`;
    return `missing permission(s): ${(a.scopes ?? []).join(', ')}`;
  });
}
