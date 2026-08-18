/**
 * The runtime "load half" for **Tools** — compiles a Studio-authored
 * `kind:'tool'` capability that binds to a data source into an executable
 * `ToolDef` registered in `ToolRegistry`, so the assistant can actually call it.
 *
 * A declarative HTTP tool body is `{ description, inputs, dataSource, method,
 * path, query, body }`: the agent's call args fill `{arg}` placeholders in the
 * path / query / body, and the request goes to the bound data source's endpoint
 * (§data-source compiler). Tools with no `dataSource` are inert metadata and are
 * skipped — handing the LLM a tool that does nothing is worse than omitting it.
 *
 * The chat send path reads `ToolRegistry.list()` on every message, so a tool
 * registered here (or re-registered over SSE) is available to the agent live —
 * no host rebuild, no boot-order coupling.
 */
import { Injectable, inject, signal } from '@angular/core';
import { DataSourceRegistry, ToolRegistry, agenticTool, type ToolDef } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { fillDeep, fillTemplate, type HttpQuery } from './catalog-http';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;
const SOURCE = 'catalog-tool';

interface CatalogToolRow {
  readonly name: string;
  readonly body?: {
    description?: string;
    inputs?: readonly string[];
    dataSource?: string;
    method?: string;
    path?: string;
    query?: Record<string, unknown>;
    body?: unknown;
  };
}

@Injectable({ providedIn: 'root' })
export class CatalogToolSource {
  private readonly tools = inject(ToolRegistry);
  private readonly dataSources = inject(DataSourceRegistry);
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  /** Fetch `kind:'tool'` capabilities and (re)register the data-source-bound ones. */
  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=tool`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogToolRow[] };
      this.tools.removeBySource(SOURCE);
      let n = 0;
      for (const row of items) {
        const def = this.toDef(row);
        if (!def) continue; // no bound data source → not executable
        try { this.tools.register(def); n++; }
        catch (e) { this.error.set(`tool "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  /** Open the catalog SSE stream; re-hydrate on any tool (or data-source) mutation. */
  startLiveSync(): void {
    if (this.stream) return;
    try {
      this.stream = new EventSource(`${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/stream`);
      this.stream.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { entityType?: string; kind?: string };
          const k = data.entityType ?? data.kind;
          if (k === 'tool' || k === 'datasource') void this.hydrate();
        } catch { /* ignore keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable — manual refresh covers it */ }
  }

  /** Compile one row → an executable `ToolDef`, or null if it binds no data source. */
  private toDef(row: CatalogToolRow): ToolDef | null {
    const dataSource = row.body?.dataSource?.trim();
    if (!dataSource) return null;
    const { method, path, query, body } = row.body ?? {};
    const inputs = row.body?.inputs ?? [];
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const input of inputs) shape[input] = z.any().optional();
    const dataSources = this.dataSources;

    const def = agenticTool({
      name: row.name,
      description: row.body?.description ?? `Call the ${dataSource} data source`,
      schema: z.object(shape).passthrough(),
      handler: async (args: Record<string, unknown>) => {
        const ds = dataSources.get(dataSource);
        if (!ds) throw new Error(`data source "${dataSource}" is not registered`);
        const a = args ?? {};
        const q: HttpQuery = {
          path: path ? fillTemplate(path, a, true) : undefined,
          method,
          query: query ? (fillDeep(query, a) as Record<string, unknown>) : undefined,
          body: body !== undefined ? fillDeep(body, a) : undefined,
        };
        return ds.adapter(q);
      },
    });
    // `source` is tagged for removeBySource() on re-hydrate (mirrors CatalogFormSource).
    return { ...def, source: SOURCE } as unknown as ToolDef;
  }
}
