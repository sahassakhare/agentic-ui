import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';

/**
 * Mirror of the catalog server's `CatalogMutationEvent`
 * ([ADR-027](../../../../../docs/adr/0027-catalog-sse-stream.md)).
 * The catalog publishes one of these per write to the per-tenant
 * `GET /v1/catalogs/{tenant}/stream` endpoint as `event: mutation`.
 */
export interface CatalogMutationEvent {
  readonly tenantId: string;
  readonly entityType:
    | 'capability' | 'mfe' | 'role_mapping' | 'tenant'
    | 'usage' | 'audit';
  readonly operation: 'create' | 'update' | 'delete' | 'restore';
  readonly entityId: string;
  readonly occurredAt: string;
  readonly summary?: Readonly<Record<string, unknown>>;
}

export type CatalogSseState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'fallback'   // SSE failed; consumers should fall back to polling
  | 'closed';

/** Test seam — a function that constructs an EventSource. */
export type EventSourceFactory = (url: string) => EventSource;

/**
 * Configuration captured by {@link CatalogSseService.configure}.
 * Hosts don't construct this directly; `provideAgenticPlatform` plumbs
 * it through when at least one feature switch needs SSE
 * (capabilityAuthorizer, future capability graph, etc.).
 */
export interface CatalogSseConfig {
  readonly catalogUrl: string;
  readonly tenantId: string;
  readonly getToken: () => Promise<string | null | undefined> | string | null | undefined;
  /**
   * Optional `EventSource` factory override — production hosts never
   * set this; tests stub the entire connection lifecycle here.
   */
  readonly eventSourceFactory?: EventSourceFactory;
}

/**
 * Generic, runtime-tier SSE consumer for the catalog's per-tenant
 * stream. Mirrors the ops-console's `CatalogStreamService` pattern
 * (now battle-tested in production) but generic — no `AuthService` /
 * `AutoRefreshService` coupling.
 *
 * Consumers:
 * - {@link CatalogCapabilityAuthorizerService} subscribes to capability
 *   mutations to drive its disabled-keys signal. Lets operator toggles
 *   propagate in <1 s instead of the 30 s poll tick.
 * - Future capability-graph view in the ops console; usage-stream
 *   panels.
 *
 * **Auth caveat**: `EventSource` can't carry an `Authorization`
 * header. When `getToken()` returns a string, we pass it as a query
 * param `?token=<jwt>`. The catalog accepts this (per ADR-027 §D6).
 * For demo deploys with `AUTH_MODE=disabled`, the token is null and
 * the param is omitted.
 *
 * **Reconnect**: native `EventSource` auto-reconnects with browser-
 * default backoff. We watch `readyState` and surface a `state` signal
 * (`'connecting' | 'live' | 'fallback' | 'closed'`) so consumers can
 * show a "live" pill / fall back to polling when SSE is dead.
 */
@Injectable({ providedIn: 'root' })
export class CatalogSseService {
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);
  private readonly destroyRef = inject(DestroyRef, { optional: true });

  private es: EventSource | null = null;
  private cfg: CatalogSseConfig | null = null;
  private readonly listeners = new Set<(e: CatalogMutationEvent) => void>();

  private readonly _state = signal<CatalogSseState>('idle');
  readonly state: Signal<CatalogSseState> = this._state.asReadonly();
  readonly isLive: Signal<boolean> = computed(() => this._state() === 'live');

  configure(cfg: CatalogSseConfig): void {
    this.cfg = cfg;
    this.destroyRef?.onDestroy(() => this.disconnect());
  }

  /**
   * Open the SSE connection. Idempotent — calling twice is a no-op
   * if already connecting / live. Returns a promise that resolves
   * when the open frame lands or `state === 'fallback'`. Tests
   * `await` this to deterministically synchronize.
   */
  async connect(): Promise<void> {
    if (!this.cfg) return;
    if (this.es && this._state() !== 'closed') return;

    if (typeof EventSource === 'undefined' && !this.cfg.eventSourceFactory) {
      // SSR / non-browser environments — surface fallback so the
      // authorizer / other consumers know to keep polling.
      this._state.set('fallback');
      this.telemetry.emit('agentic.platform.sse.fallback', {
        'platform.sse.reason': 'EventSource undefined',
      });
      return;
    }

    this._state.set('connecting');
    const token = await this.cfg.getToken();
    const url = this.buildUrl(this.cfg.catalogUrl, this.cfg.tenantId, token);

    const factory = this.cfg.eventSourceFactory ?? ((u: string) => new EventSource(u));
    const es = factory(url);

    es.addEventListener('open', () => {
      this._state.set('live');
      this.telemetry.emit('agentic.platform.sse.opened', {
        'platform.sse.tenant': this.cfg!.tenantId,
      });
    });

    es.addEventListener('mutation', (msg) => {
      try {
        const data = JSON.parse((msg as MessageEvent).data) as CatalogMutationEvent;
        for (const handler of this.listeners) handler(data);
        this.telemetry.emit('agentic.platform.sse.event_received', {
          'platform.sse.entity_type': data.entityType,
          'platform.sse.operation': data.operation,
        });
      } catch (err) {
        // Malformed payload — drop and tag telemetry so operators
        // can find the offender. Don't crash other listeners.
        this.telemetry.emit('agentic.platform.sse.parse_error', {
          'error.message': err instanceof Error ? err.message : String(err),
        });
      }
    });

    es.addEventListener('error', () => {
      // The browser auto-reconnects while readyState is CONNECTING
      // (1). Only flip to fallback when it's CLOSED (2). Tests with
      // a stub EventSource may not advance readyState; we still
      // mark fallback so consumers know polling is the only path.
      if (es.readyState === 2 /* CLOSED */ || this.cfg!.eventSourceFactory) {
        this._state.set('fallback');
        this.telemetry.emit('agentic.platform.sse.fallback', {
          'platform.sse.reason': 'EventSource error',
        });
      }
    });

    this.es = es;
  }

  disconnect(): void {
    if (this.es) {
      try { this.es.close(); } catch { /* noop */ }
      this.es = null;
    }
    this._state.set('closed');
  }

  /**
   * Register a mutation handler. Returns a disposer that removes
   * the listener. Listeners are invoked synchronously in
   * registration order.
   */
  onMutation(handler: (event: CatalogMutationEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private buildUrl(catalogUrl: string, tenantId: string, token: string | null | undefined): string {
    const base = `${stripTrailingSlash(catalogUrl)}/v1/catalogs/${encodeURIComponent(tenantId)}/stream`;
    if (token) return `${base}?token=${encodeURIComponent(token)}`;
    return base;
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
