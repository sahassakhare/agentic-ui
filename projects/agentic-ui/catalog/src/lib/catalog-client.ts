import { Injectable, inject } from '@angular/core';
import { CATALOG_AUTH, CATALOG_CONFIG } from './catalog-config';

/** The catalog change-stream event shape (mirrors the service's SSE payload). */
export interface CatalogMutation {
  /** `'capability'` for any `kind:*` capability edit, `'experience'` for experiences. */
  readonly entityType: 'capability' | 'experience';
  readonly operation?: string;
  readonly entityId?: string;
}

/**
 * Thin HTTP + SSE client for the Experience Studio catalog service.
 *
 * ONE shared `EventSource` fans catalog mutations out to every registered source
 * (`onMutation`), so a Studio edit re-hydrates the affected registry with no
 * reload — and one connection instead of one-per-source (browsers cap HTTP/1.1
 * at 6 per host, which silently broke per-source streams). In `oidc` mode
 * requests forward the bearer token from `CATALOG_AUTH`.
 *
 * NOTE the event shape: the service emits `{entityType:'capability'|'experience'}`
 * with NO kind, so a listener cannot target a single kind from the event — it
 * re-hydrates its own source on any `capability` (or `experience`) mutation.
 */
@Injectable({ providedIn: 'root' })
export class CatalogClient {
  private readonly cfg = inject(CATALOG_CONFIG);
  private readonly auth = inject(CATALOG_AUTH);
  private stream?: EventSource;
  private readonly listeners = new Set<(m: CatalogMutation) => void>();

  /** GET the tenant's capabilities of one `kind`. */
  listByKind<T>(kind: string): Promise<readonly T[]> {
    return this.getItems<T>(`${this.base()}/capabilities?kind=${encodeURIComponent(kind)}`);
  }

  /** GET the tenant's **approved** experiences. */
  listExperiences<T>(): Promise<readonly T[]> {
    return this.getItems<T>(`${this.base()}/experiences?approvalState=approved&limit=200`);
  }

  /**
   * Register interest in catalog mutations; opens the shared SSE stream lazily.
   * The callback receives the mutation event (`entityType` only — no kind).
   */
  onMutation(cb: (m: CatalogMutation) => void): void {
    this.listeners.add(cb);
    this.openStream();
  }

  private async getItems<T>(url: string): Promise<readonly T[]> {
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`catalog returned ${res.status}`);
    return ((await res.json()) as { items?: T[] }).items ?? [];
  }

  private base(): string {
    return `${this.cfg.baseUrl}/v1/catalogs/${encodeURIComponent(this.cfg.tenant)}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json' };
    const token = this.auth.token();
    if (this.cfg.authMode === 'oidc' && token) h['authorization'] = `Bearer ${token}`;
    return h;
  }

  private openStream(): void {
    if (this.stream) return;
    try {
      this.stream = new EventSource(`${this.base()}/stream`);
      this.stream.onmessage = (ev) => {
        let m: CatalogMutation;
        try { m = JSON.parse(ev.data) as CatalogMutation; } catch { return; /* keepalive */ }
        if (m.entityType) for (const l of this.listeners) l(m);
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable — hydrate() still works on demand */ }
  }
}
