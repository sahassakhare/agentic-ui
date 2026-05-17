import type pg from 'pg';
import type { CatalogEventBus, CatalogMutationEvent } from './catalog-bus.js';
import { logger } from '../logger.js';

const CHANNEL = 'catalog_events';
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Wire-format for `pg_notify('catalog_events', ...)` payloads.
 * `originReplicaId` lets the LISTEN handler on the originating
 * replica skip the echo of its own emit — the local in-process
 * bus already delivered the event with <1ms latency, no need to
 * round-trip through pg.
 */
interface NotifyEnvelope {
  readonly originReplicaId: string;
  readonly event: CatalogMutationEvent;
}

export interface PgNotifyDeps {
  readonly pool: pg.Pool;
  readonly bus: CatalogEventBus;
  readonly replicaId: string;
}

/**
 * Closes the multi-replica gap from ADR-027 §D5. Each replica:
 *
 * 1. Holds a **dedicated** pg.Client (NOT pulled from the pool —
 *    `LISTEN` claims the connection for its lifetime).
 * 2. Issues `LISTEN catalog_events` on connect.
 * 3. Forwards every incoming `notification` to the in-process
 *    {@link CatalogEventBus}.
 * 4. Filters out self-echo by checking `originReplicaId` —
 *    mutation routes emit to the local bus directly AND call
 *    `pg_notify` (so cross-replica clients see the event); the
 *    originating replica's LISTEN handler ignores the round-trip
 *    to avoid double-emit.
 *
 * Reconnects on disconnect with linear backoff (2s → 30s cap). If
 * pg is unreachable at boot, the listener retries forever; the
 * server itself stays healthy and SSE continues working
 * single-replica via the in-process bus.
 */
export class PgNotifyListener {
  private readonly pool: pg.Pool;
  private readonly bus: CatalogEventBus;
  private readonly replicaId: string;

  private client: pg.Client | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDelay = RECONNECT_DELAY_MS;

  constructor(deps: PgNotifyDeps) {
    this.pool = deps.pool;
    this.bus = deps.bus;
    this.replicaId = deps.replicaId;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try { await this.client.end(); }
      catch { /* swallow */ }
      this.client = null;
    }
  }

  /**
   * Publish an event to all replicas via `pg_notify`. The local
   * replica's LISTEN handler ignores the echo, so the caller is
   * expected to ALSO call `bus.emit(event)` for immediate
   * single-replica delivery. See `publishLocalAndRemote` for the
   * combined helper.
   */
  async publishRemote(event: CatalogMutationEvent): Promise<void> {
    const payload: NotifyEnvelope = { originReplicaId: this.replicaId, event };
    const json = JSON.stringify(payload);
    // Use a connection from the main pool — pg_notify is fire-and-
    // forget at the SQL layer. The dedicated LISTEN connection
    // can't be reused for queries.
    try {
      await this.pool.query('SELECT pg_notify($1, $2)', [CHANNEL, json]);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'pg_notify failed; cross-replica delivery dropped',
      );
    }
  }

  /**
   * Combined: emit to the local bus immediately + fan out to all
   * replicas via pg_notify. Mutation routes call this in place of
   * `catalogBus.emit(...)`.
   */
  async publishLocalAndRemote(event: CatalogMutationEvent): Promise<void> {
    this.bus.emit(event);
    await this.publishRemote(event);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    try {
      const client = new (await import('pg')).default.Client(
        // Use the same connection options as the pool — Client
        // accepts a connectionString or full ConnectionConfig. We
        // read the pool's options indirectly by acquiring a
        // connection just to grab the connectionString.
        // Simpler: re-use the env var that built the pool.
        process.env['DATABASE_URL'],
      );
      await client.connect();
      this.client = client;

      client.on('notification', (msg) => this.handleNotification(msg));
      client.on('error', (err) => {
        logger.warn(
          { err: err.message },
          'pg LISTEN connection errored; will reconnect',
        );
        void this.scheduleReconnect();
      });
      client.on('end', () => {
        if (!this.stopped) {
          logger.warn('pg LISTEN connection ended; will reconnect');
          void this.scheduleReconnect();
        }
      });

      await client.query(`LISTEN ${CHANNEL}`);
      this.currentDelay = RECONNECT_DELAY_MS;
      logger.info({ replicaId: this.replicaId }, 'pg LISTEN connected');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'pg LISTEN connect failed; will retry',
      );
      void this.scheduleReconnect();
    }
  }

  private handleNotification(msg: pg.Notification): void {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    let envelope: NotifyEnvelope;
    try { envelope = JSON.parse(msg.payload) as NotifyEnvelope; }
    catch {
      logger.warn({ payload: msg.payload }, 'pg notification payload not JSON; dropped');
      return;
    }
    // Self-echo filter — local bus.emit already delivered.
    if (envelope.originReplicaId === this.replicaId) return;
    if (!envelope.event) return;
    this.bus.emit(envelope.event);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    if (this.client) {
      try { void this.client.end(); }
      catch { /* swallow */ }
      this.client = null;
    }
    const delay = this.currentDelay;
    this.currentDelay = Math.min(this.currentDelay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
