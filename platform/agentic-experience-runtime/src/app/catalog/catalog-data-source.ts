/**
 * The runtime "load half" for **Data Sources** — compiles a Studio-authored
 * `kind:'datasource'` capability that declares an API `endpoint` into a live,
 * `fetch`-backed `DataSourceDef` registered in `DataSourceRegistry`.
 *
 * Header values may reference `${SECRET}`; those are resolved from the host's
 * secrets map (`environment.dataSourceSecrets`) so real tokens stay out of the
 * catalog body. Rows without an `endpoint` (e.g. a SQL table) are skipped — the
 * browser can't call those directly.
 *
 * Mirrors `CatalogFormSource`: GET the tenant's rows, (re)register tagged with a
 * source, and re-hydrate over the catalog SSE stream.
 */
import { Injectable, inject, signal } from '@angular/core';
import { DataSourceRegistry, agenticDataSource, type DataSourceDef } from '@infra-tools/agentic-ui';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { buildHttpAdapter, resolveHeaders, type HttpQuery } from './catalog-http';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;
const SOURCE = 'catalog-datasource';

interface CatalogDataSourceRow {
  readonly name: string;
  readonly body?: {
    kind?: string;
    description?: string;
    endpoint?: string;
    method?: string;
    headers?: Record<string, string> | string;
  };
}

@Injectable({ providedIn: 'root' })
export class CatalogDataSource {
  private readonly registry = inject(DataSourceRegistry);
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  /** Fetch `kind:'datasource'` capabilities and (re)register the HTTP-backed ones. */
  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=datasource`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogDataSourceRow[] };
      this.registry.removeBySource(SOURCE);
      let n = 0;
      for (const row of items) {
        const def = this.toDef(row);
        if (!def) continue; // no endpoint → not browser-callable
        try { this.registry.register(def); n++; }
        catch (e) { this.error.set(`data source "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  /** Open the catalog SSE stream; re-hydrate on any data-source mutation. */
  startLiveSync(): void {
    if (this.stream) return;
    try {
      this.stream = new EventSource(`${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/stream`);
      this.stream.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { entityType?: string; kind?: string };
          if (data.entityType === 'datasource' || data.kind === 'datasource') void this.hydrate();
        } catch { /* ignore keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable — manual refresh covers it */ }
  }

  /** Compile one row → a `fetch`-backed `DataSourceDef` (or null if it has no endpoint). */
  private toDef(row: CatalogDataSourceRow): DataSourceDef | null {
    const endpoint = row.body?.endpoint?.trim();
    if (!endpoint) return null;
    const cfg = {
      endpoint,
      method: row.body?.method,
      headers: resolveHeaders(row.body?.headers, environment.dataSourceSecrets ?? {}),
    };
    const adapter = buildHttpAdapter(cfg);
    const def = agenticDataSource({ name: row.name, kind: 'rest', adapter: (q) => adapter(q as HttpQuery) });
    // `source` is tagged for removeBySource() on re-hydrate (mirrors CatalogFormSource).
    return { ...def, source: SOURCE } as unknown as DataSourceDef;
  }
}
