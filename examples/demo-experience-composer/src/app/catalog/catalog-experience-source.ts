/**
 * P1 — the runtime "load half" of the author→govern→load→compose loop.
 *
 * Product owners author Experiences in the Studio; the catalog server persists
 * them per-tenant (RLS, approval, audit). This service is the missing runtime
 * half: it GETs the tenant's **approved** experiences from the catalog, maps
 * each catalog row (nested `body.*`) to a flat runtime `ExperienceDef`, and
 * registers them into `ExperienceRegistry` — so the composer plans over
 * governed, catalog-sourced content instead of hardcoded TypeScript.
 *
 * Live updates: subscribes to the catalog SSE stream and re-hydrates on any
 * `experience` mutation. Modeled on the platform's `RestMfeRegistrySource`
 * (lib/mfe/rest-mfe-registry.ts); promote to `lib/catalog/` once stable.
 */
import { Injectable, inject, signal } from '@angular/core';
import { ExperienceRegistry } from '@infra-tools/agentic-ui';

/** Where the catalog server lives + which tenant to load. P3 adds a real token. */
export const CATALOG_URL = 'http://127.0.0.1:8080';
export const CATALOG_TENANT = 'acme';
const SOURCE = 'catalog'; // registry source tag → lets us removeBySource on refresh

interface CatalogExperienceRow {
  readonly name: string;
  readonly title: string;
  readonly goal: string;
  readonly approvalState: string;
  readonly version: string | null;
  readonly owner: string | null;
  readonly tags: readonly string[];
  readonly body: {
    intents?: string[];
    requires?: { kind: string; name?: string; tag?: string; optional?: boolean }[];
    defaultLayout?: string;
    policies?: string[];
    personas?: string[];
  };
}

@Injectable({ providedIn: 'root' })
export class CatalogExperienceSource {
  private readonly registry = inject(ExperienceRegistry);
  private stream?: EventSource;

  /** How many experiences are currently loaded from the catalog. */
  readonly count = signal(0);
  readonly lastSync = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  /** Fetch approved experiences for the tenant and (re)register them. */
  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(CATALOG_TENANT)}/experiences?approvalState=approved&limit=200`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogExperienceRow[] };
      // Clear our previously-loaded set, then register the fresh catalog state.
      this.registry.removeBySource(SOURCE);
      for (const row of items) this.registry.register(this.toDef(row));
      this.count.set(items.length);
      this.lastSync.set(new Date().toLocaleTimeString());
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  /** Open the catalog SSE stream; re-hydrate on any experience mutation. */
  startLiveSync(): void {
    if (this.stream) return;
    try {
      this.stream = new EventSource(`${CATALOG_URL}/v1/catalogs/${encodeURIComponent(CATALOG_TENANT)}/stream`);
      this.stream.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { entityType?: string };
          if (data.entityType === 'experience') void this.hydrate();
        } catch { /* ignore non-JSON keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects; ignore */ };
    } catch { /* SSE unavailable — the manual refresh + poll cover it */ }
  }

  /** Map a catalog experience row (nested body) → flat runtime ExperienceDef. */
  private toDef(row: CatalogExperienceRow): Parameters<ExperienceRegistry['register']>[0] {
    const b = row.body ?? {};
    return {
      name: row.name,
      title: row.title,
      goal: row.goal,
      intents: b.intents,
      requires: b.requires,
      defaultLayout: b.defaultLayout,
      policies: b.policies,
      personas: b.personas,
      version: row.version ?? undefined,
      approvalState: 'approved',
      tags: [...(row.tags ?? [])],
      owner: row.owner ?? undefined,
      source: SOURCE,
    } as unknown as Parameters<ExperienceRegistry['register']>[0];
  }
}
