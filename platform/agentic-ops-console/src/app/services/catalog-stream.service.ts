import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { AutoRefreshService } from './auto-refresh.service';

/** Mirror of the catalog's `CatalogMutationEvent` (ADR-027). */
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

/**
 * Subscribes to the catalog's per-tenant SSE stream and pushes
 * mutation events to in-memory listeners.
 *
 * **SSE-first, polling fallback** — when the EventSource is open, the
 * `AutoRefreshService` (ADR-024) is paused; when it errors / closes /
 * the catalog is unreachable, we fall back to the 8s polling tick so
 * the console still shows fresh data.
 *
 * Reconnect: native EventSource auto-reconnects with exponential
 * backoff; we let it do its thing. We watch `readyState` and pause
 * polling only when it's `OPEN`.
 *
 * Auth: when the catalog runs OIDC, EventSource can't carry an
 * Authorization header (no API for it). Workaround: pass the token
 * as a query param `?token=<jwt>`. **Demo deploys (AUTH_MODE=disabled)
 * skip the token entirely**, which is the only configuration we
 * exercise live today; the OIDC SSE path is documented but
 * deferred to a future slice. See ADR-027 §D6.
 */
@Injectable({ providedIn: 'root' })
export class CatalogStreamService {
  private readonly auth = inject(AuthService);
  private readonly autoRefresh = inject(AutoRefreshService);
  private readonly destroyRef = inject(DestroyRef, { optional: true });

  private eventSource: EventSource | null = null;
  private readonly listeners = new Set<(e: CatalogMutationEvent) => void>();

  // Reactive state — components can render "live" / "polling" pills.
  private readonly _state = signal<'connecting' | 'live' | 'polling' | 'closed'>('closed');
  readonly state = this._state.asReadonly();
  readonly isLive = computed(() => this._state() === 'live');

  constructor() {
    // Whenever the principal's tenantId changes (login / tenant
    // switcher), close the old stream and open a new one.
    effect(() => {
      const p = this.auth.principal();
      this.disconnect();
      if (p?.tenantId) this.connect(p.tenantId);
    });

    this.destroyRef?.onDestroy(() => this.disconnect());
  }

  /**
   * Register a listener for catalog mutation events. Filtered to the
   * principal's tenant by the catalog server.
   */
  onMutation(handler: (event: CatalogMutationEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private connect(tenantId: string): void {
    if (typeof EventSource === 'undefined') {
      // SSR / tests without browser globals — stay paused, polling
      // takes over.
      this._state.set('polling');
      this.autoRefresh.setEnabled(true);
      return;
    }
    this._state.set('connecting');
    const url = this.buildStreamUrl(tenantId);
    const es = new EventSource(url);

    es.addEventListener('open', () => {
      this._state.set('live');
      // SSE is alive — pause polling to avoid the double round-trip.
      this.autoRefresh.setEnabled(false);
    });
    // Hono's `event: open` first frame is also fired through the
    // generic `open` event — we don't double-handle.

    es.addEventListener('mutation', (msg) => {
      try {
        const data = JSON.parse((msg as MessageEvent).data) as CatalogMutationEvent;
        for (const handler of this.listeners) handler(data);
      } catch { /* malformed payload — drop silently */ }
    });

    es.addEventListener('error', () => {
      // EventSource auto-reconnects; while it's not OPEN, fall back
      // to polling so the console doesn't go stale.
      if (es.readyState !== EventSource.OPEN) {
        this._state.set('polling');
        this.autoRefresh.setEnabled(true);
      }
    });

    this.eventSource = es;
  }

  private disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this._state.set('closed');
    this.autoRefresh.setEnabled(true);
  }

  private buildStreamUrl(tenantId: string): string {
    const base = `${environment.catalogBaseUrl}/v1/catalogs/${encodeURIComponent(tenantId)}/stream`;
    if (this.auth.authMode === 'oidc' && this.auth.token()) {
      // Token-as-query-param path. Documented in ADR-027 §D6 as a
      // workaround for EventSource not supporting Authorization
      // headers. The catalog accepts this when wired; today the
      // Render demo runs disabled-mode so this branch is unused
      // live.
      return `${base}?token=${encodeURIComponent(this.auth.token()!)}`;
    }
    return base;
  }
}

/**
 * Convenience helper for components: subscribe to the stream and
 * fire `refresh` on every mutation, with cleanup on destroy.
 */
export function autoStream(refresh: () => void): void {
  const stream = inject(CatalogStreamService);
  const destroyRef = inject(DestroyRef);
  const off = stream.onMutation(() => refresh());
  destroyRef.onDestroy(off);
}
