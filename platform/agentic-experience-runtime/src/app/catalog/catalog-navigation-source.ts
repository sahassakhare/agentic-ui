/**
 * The runtime "load half" for **Navigation** — compiles Studio-authored
 * `kind:'navigation'` capabilities into `NavigationDef`s in `NavigationRegistry`.
 *
 * Today only an application's `menu`/`nav` feeds the registry (tagged
 * `external:application` in `application-source.ts`); standalone navigation rows
 * were dead. This registers them under a distinct source tag so the two coexist
 * — the application menu and any authored nav entries both appear in the Hub.
 * Mirrors `CatalogFormSource`.
 */
import { Injectable, inject, signal } from '@angular/core';
import { NavigationRegistry, agenticNavigation, type NavigationDef } from '@infra-tools/agentic-ui';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;
const SOURCE = 'catalog-navigation'; // distinct from application-source's 'external:application'

interface CatalogNavigationRow {
  readonly name: string;
  readonly body?: { title?: string; route?: string; icon?: string; order?: number; parent?: string; external?: boolean };
}

@Injectable({ providedIn: 'root' })
export class CatalogNavigationSource {
  private readonly registry = inject(NavigationRegistry);
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=navigation`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogNavigationRow[] };
      this.registry.removeBySource(SOURCE);
      let n = 0;
      for (const row of items) {
        try { this.registry.register(this.toDef(row)); n++; }
        catch (e) { this.error.set(`navigation "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  startLiveSync(): void {
    if (this.stream) return;
    try {
      this.stream = new EventSource(`${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/stream`);
      this.stream.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data) as { entityType?: string; kind?: string };
          if (d.entityType === 'navigation' || d.kind === 'navigation') void this.hydrate();
        } catch { /* ignore keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable */ }
  }

  private toDef(row: CatalogNavigationRow): NavigationDef {
    const def = agenticNavigation({
      name: row.name,
      title: row.body?.title ?? row.name,
      route: row.body?.route ?? '/',
      icon: row.body?.icon,
      order: row.body?.order,
      parent: row.body?.parent,
      external: row.body?.external,
    });
    return { ...def, source: SOURCE } as unknown as NavigationDef;
  }
}
