/**
 * The runtime "load half" for **Prompts** — compiles a Studio-authored
 * `kind:'prompt'` capability into a `PromptDef` registered in `PromptRegistry`,
 * so authored prompt templates are available to the assistant/planner at runtime
 * instead of sitting inert in the catalog. Mirrors `CatalogFormSource`.
 */
import { Injectable, inject, signal } from '@angular/core';
import { PromptRegistry, agenticPrompt, type PromptDef } from '@infra-tools/agentic-ui';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;
const SOURCE = 'catalog-prompt';

interface CatalogPromptRow {
  readonly name: string;
  readonly body?: { template?: string; description?: string; variables?: readonly string[]; model?: string; version?: string };
}

@Injectable({ providedIn: 'root' })
export class CatalogPromptSource {
  private readonly registry = inject(PromptRegistry);
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=prompt`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogPromptRow[] };
      this.registry.removeBySource(SOURCE);
      let n = 0;
      for (const row of items) {
        try { this.registry.register(this.toDef(row)); n++; }
        catch (e) { this.error.set(`prompt "${row.name}": ${(e as Error).message}`); }
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
          if (d.entityType === 'prompt' || d.kind === 'prompt') void this.hydrate();
        } catch { /* ignore keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable */ }
  }

  private toDef(row: CatalogPromptRow): PromptDef {
    const def = agenticPrompt({
      name: row.name,
      template: row.body?.template ?? '',
      description: row.body?.description,
      variables: row.body?.variables,
      model: row.body?.model,
      version: row.body?.version,
    });
    return { ...def, source: SOURCE } as unknown as PromptDef;
  }
}
