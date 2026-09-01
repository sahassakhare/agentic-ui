import { Injectable, inject } from '@angular/core';
import { CATALOG_AUTH, CATALOG_CONFIG } from './catalog-config';

/** The catalog change-stream event shape (mirrors the service's SSE payload). */
export interface CatalogMutation {
  /** `'capability'` for any `kind:*` capability edit, `'experience'` for experiences. */
  readonly entityType: 'capability' | 'experience';
  readonly operation?: string;
  readonly entityId?: string;
  /**
   * The changed capability's `kind`, resolved CLIENT-SIDE from `entityId` before
   * fan-out (the service omits it from the raw event). `undefined` when it can't
   * be resolved — a delete (the row is gone), no `entityId`, or a lookup failure —
   * in which case listeners MUST fall back to a broad re-hydrate. See
   * {@link CatalogClient.onCapabilityKind}.
   */
  readonly kind?: string;
}

/**
 * Predicate for a kind-scoped capability listener: fire when the mutation is a
 * capability of `kind`, OR when the kind is unknown (delete / no id / lookup
 * failed) — the safe broad-refresh fallback. Pure + exported for unit testing.
 */
export function capabilityMutationMatches(m: CatalogMutation, kind: string): boolean {
  return m.entityType === 'capability' && (m.kind === undefined || m.kind === kind);
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
  /** In-flight kind lookups, deduped per entityId (one fetch per event, not per listener). */
  private readonly kindInFlight = new Map<string, Promise<string | undefined>>();

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

  /**
   * Register interest in mutations of ONE capability `kind`. `cb` runs only when
   * a capability of that kind changed — or when the kind can't be resolved
   * (delete / no id / lookup failure), the safe broad-refresh fallback. This is
   * what turns "any capability edit re-hydrates all ~13 sources" into "only the
   * affected source re-hydrates" for the common create/update path.
   */
  onCapabilityKind(kind: string, cb: () => void): void {
    this.onMutation((m) => { if (capabilityMutationMatches(m, kind)) cb(); });
  }

  private async getItems<T>(url: string): Promise<readonly T[]> {
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`catalog returned ${res.status}`);
    return ((await res.json()) as { items?: T[] }).items ?? [];
  }

  /** Resolve a changed capability's `kind` from its id — deduped per entityId. */
  private resolveKind(entityId: string): Promise<string | undefined> {
    const existing = this.kindInFlight.get(entityId);
    if (existing) return existing;
    const p = fetch(`${this.base()}/capabilities/${encodeURIComponent(entityId)}`, { headers: this.headers() })
      .then((res) => (res.ok ? res.json() : undefined))
      .then((row) => (row as { kind?: string } | undefined)?.kind)
      .catch(() => undefined)
      .finally(() => this.kindInFlight.delete(entityId));
    this.kindInFlight.set(entityId, p);
    return p;
  }

  private fanOut(m: CatalogMutation): void {
    for (const l of this.listeners) l(m);
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
        if (!m.entityType) return;
        // Enrich a capability create/update with its `kind` (one deduped lookup)
        // so kind-scoped listeners can skip. Deletes / missing id fan out with an
        // undefined kind → listeners broad-refresh (the row is already gone).
        if (m.entityType === 'capability' && m.entityId && m.operation !== 'delete' && m.kind === undefined) {
          void this.resolveKind(m.entityId).then((kind) => this.fanOut({ ...m, kind }));
        } else {
          this.fanOut(m);
        }
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable — hydrate() still works on demand */ }
  }
}
