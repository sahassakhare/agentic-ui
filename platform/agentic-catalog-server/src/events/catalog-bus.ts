import { EventEmitter } from 'node:events';

/**
 * Per-process pub/sub for catalog mutations. Routes emit a single
 * `mutation` event after every successful write; the SSE endpoint
 * subscribes and forwards filtered-by-tenant events to connected
 * clients.
 *
 * **Scope is in-process** — when the catalog runs multiple replicas
 * (Helm chart `replicaCount: 2+`), a mutation on replica A is NOT
 * observed by SSE clients connected to replica B. The proper fix
 * is `pg LISTEN/NOTIFY` so every replica receives every event. That
 * lands in a follow-up slice; this implementation is correct for the
 * Render demo (single replica) and for development. See ADR-027 §D5.
 */

export type CatalogEntityType =
  | 'capability'
  | 'mfe'
  | 'role_mapping'
  | 'tenant'
  | 'usage'
  | 'audit'
  | 'agent'
  | 'policy_bundle';

export type CatalogOperation = 'create' | 'update' | 'delete' | 'restore';

export interface CatalogMutationEvent {
  /** Tenant the mutation affected; SSE filtering keys on this. */
  readonly tenantId: string;
  readonly entityType: CatalogEntityType;
  readonly operation: CatalogOperation;
  /** Stable id of the affected row (UUID, tenant id, etc.). */
  readonly entityId: string;
  /** Server-stamped ISO 8601 timestamp. */
  readonly occurredAt: string;
  /**
   * Optional minimal payload — clients use this as a hint to
   * decide whether to re-fetch. We deliberately do NOT ship the
   * full row to keep events small + RLS-safe (a full payload
   * could leak tenant data through misconfigured downstreams).
   */
  readonly summary?: Readonly<Record<string, unknown>>;
}

/**
 * Singleton bus. Hosts get the same instance across the request
 * lifecycle. Tests can construct their own via `new CatalogEventBus()`
 * if isolation matters.
 */
export class CatalogEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Bound high to avoid Node's default "MaxListenersExceededWarning"
    // when many SSE clients connect concurrently. SSE keeps one
    // listener per open connection.
    this.emitter.setMaxListeners(0);
  }

  emit(event: CatalogMutationEvent): void {
    this.emitter.emit('mutation', event);
  }

  /**
   * Subscribe to events. Returns an unsubscribe function. Caller is
   * responsible for filtering by tenant — we don't gate at the bus
   * because tests want to see cross-tenant streams.
   */
  subscribe(handler: (event: CatalogMutationEvent) => void): () => void {
    this.emitter.on('mutation', handler);
    return () => this.emitter.off('mutation', handler);
  }

  /** Listener count — used by tests to verify cleanup. */
  listenerCount(): number {
    return this.emitter.listenerCount('mutation');
  }
}

/** Default in-process bus shared by routes + the SSE endpoint. */
export const catalogBus = new CatalogEventBus();
