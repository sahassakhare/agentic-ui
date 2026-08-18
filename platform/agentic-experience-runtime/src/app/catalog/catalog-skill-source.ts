/**
 * The runtime "load half" for **Skills** — compiles a Studio-authored
 * `kind:'skill'` capability into a `SkillDef` registered in `SkillRegistry`.
 * A skill bundles a set of tools (+ an optional prompt) the planner can use.
 * Mirrors `CatalogFormSource`.
 */
import { Injectable, inject, signal } from '@angular/core';
import { SkillRegistry, agenticSkill, type SkillDef } from '@infra-tools/agentic-ui';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;
const SOURCE = 'catalog-skill';

interface CatalogSkillRow {
  readonly name: string;
  readonly body?: { description?: string; tools?: readonly string[]; prompt?: string; version?: string };
}

@Injectable({ providedIn: 'root' })
export class CatalogSkillSource {
  private readonly registry = inject(SkillRegistry);
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=skill`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogSkillRow[] };
      this.registry.removeBySource(SOURCE);
      let n = 0;
      for (const row of items) {
        // agenticSkill requires a non-empty tools[]; a skill with none is skipped.
        if (!row.body?.tools?.length) continue;
        try { this.registry.register(this.toDef(row)); n++; }
        catch (e) { this.error.set(`skill "${row.name}": ${(e as Error).message}`); }
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
          if (d.entityType === 'skill' || d.kind === 'skill') void this.hydrate();
        } catch { /* ignore keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable */ }
  }

  private toDef(row: CatalogSkillRow): SkillDef {
    const def = agenticSkill({
      name: row.name,
      description: row.body?.description ?? '',
      tools: row.body?.tools ?? [],
      prompt: row.body?.prompt,
      version: row.body?.version,
    });
    return { ...def, source: SOURCE } as unknown as SkillDef;
  }
}
