/**
 * The runtime "load half" for **design tokens**: hydrates `kind:'theme'`
 * capabilities from the catalog into a name→TokenSet map and keeps it live over
 * SSE, so the shell can apply an application's theme (and hot-swap it when a
 * token is edited in the Studio). Mirrors `CatalogFormSource`.
 */
import { Injectable, inject, signal } from '@angular/core';
import type { TokenSet } from '@infra-tools/agentic-ui';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;

interface CatalogThemeRow {
  readonly name: string;
  readonly body?: Partial<TokenSet>;
}

@Injectable({ providedIn: 'root' })
export class CatalogThemeSource {
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  /** name → token set. A signal so the shell re-applies when it changes. */
  readonly themes = signal<ReadonlyMap<string, TokenSet>>(new Map());
  readonly error = signal<string | null>(null);

  get(name: string | undefined | null): TokenSet | undefined {
    return name ? this.themes().get(name) : undefined;
  }

  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=theme`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogThemeRow[] };
      const map = new Map<string, TokenSet>();
      for (const row of items) {
        const set = toTokenSet(row.body);
        if (set) map.set(row.name, set);
      }
      this.themes.set(map);
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
          const data = JSON.parse(ev.data) as { entityType?: string; kind?: string };
          if (data.entityType === 'theme' || data.kind === 'theme') void this.hydrate();
        } catch { /* keepalive */ }
      };
      this.stream.onerror = () => { /* auto-reconnect */ };
    } catch { /* SSE unavailable — manual refresh covers it */ }
  }
}

/** A theme body must at least have `base` tokens. */
function toTokenSet(body: Partial<TokenSet> | undefined): TokenSet | null {
  if (!body || typeof body !== 'object' || !body.base || typeof body.base !== 'object') return null;
  return { title: body.title, base: body.base, dark: body.dark };
}
