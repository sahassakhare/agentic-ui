/**
 * Loads governed **Pages** (`kind:'page'` capabilities) authored in the Studio.
 * A Page is a routed, designed layout: a layout template + named **regions**,
 * where each region stacks one or more surfaces (experiences/dashboards/forms/
 * components). The application's route tree points at these by name; the Hub's
 * router renders one per URL. Re-hydrates live over the catalog SSE stream.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import type { SurfaceTarget } from './application-source';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;

/** How a page arranges its regions. The PageHost maps each to a CSS grid. */
export type PageLayout = 'single' | 'two-column' | 'sidebar-right' | 'sidebar-left' | 'stacked' | 'grid';

/** A page is either leaf `content` or a `shell` (a master page — regions around a content outlet). */
export type PageType = 'content' | 'shell';

export interface PageDef {
  readonly name: string;
  readonly title: string;
  readonly type: PageType;
  readonly layout: PageLayout;
  /** region name → the surfaces stacked in that region, in order. */
  readonly regions: Readonly<Record<string, readonly SurfaceTarget[]>>;
  readonly access?: { readonly personas?: readonly string[]; readonly scopes?: readonly string[] };
}

interface CapabilityRow {
  readonly name: string;
  readonly body: {
    title?: string; type?: PageType; layout?: PageLayout;
    regions?: Record<string, SurfaceTarget[]>;
    access?: { personas?: string[]; scopes?: string[] };
  };
}

@Injectable({ providedIn: 'root' })
export class PageSource {
  private readonly auth = inject(AuthService);

  private readonly byName = signal<ReadonlyMap<string, PageDef>>(new Map());
  readonly count = computed(() => this.byName().size);
  readonly error = signal<string | null>(null);

  get(name: string): PageDef | undefined { return this.byName().get(name); }

  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=page`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CapabilityRow[] };
      const map = new Map<string, PageDef>();
      for (const row of items) {
        map.set(row.name, {
          name: row.name,
          title: row.body.title ?? row.name,
          type: row.body.type ?? 'content',
          layout: row.body.layout ?? 'single',
          regions: row.body.regions ?? {},
          access: row.body.access,
        });
      }
      this.byName.set(map);
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
