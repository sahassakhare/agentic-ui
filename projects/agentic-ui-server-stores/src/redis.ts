import type Redis from 'ioredis';
import type { ThreadStateStore } from '@maverick/agentic-ui-server';

/**
 * Construction options for {@link RedisThreadStateStore}.
 */
export interface RedisThreadStateStoreOptions {
  /**
   * An `ioredis` client instance. The store does NOT manage the
   * client's lifecycle — callers are responsible for creating and
   * disposing it. This makes the store agnostic to whether the host
   * uses a single shared client, a per-tenant client, or a sentinel /
   * cluster setup.
   */
  readonly client: Redis;

  /**
   * Key prefix prepended to every `threadId`. Use this to namespace
   * the store within a multi-tenant deployment, or to scope to an
   * environment (e.g. `prod:agentic:thread`). Final keys take the
   * shape `${prefix}:${threadId}`.
   *
   * @example "prod:agentic:thread"
   */
  readonly prefix: string;

  /**
   * Time-to-live in seconds for each entry. Redis applies an `EX`
   * argument on every `set` so values expire automatically and the
   * store doesn't grow unbounded. Set to `null` to disable TTL.
   *
   * @default 86_400 (24 hours)
   */
  readonly ttlSeconds?: number | null;
}

/**
 * Redis-backed implementation of {@link ThreadStateStore}. Suitable
 * for multi-pod deployments where thread state must converge across
 * pods + survive process restarts.
 *
 * @remarks
 * Trade-offs vs. the in-memory default:
 *
 * - **Multi-pod-safe.** Pod A's `set` is visible to pod B's next
 *   `get`. Useful for orchestrator sticky-by-thread routing across
 *   horizontally-scaled deployments.
 * - **Survives restarts** for `ttlSeconds`. Beyond that, the entry
 *   expires.
 * - **Network round-trip per call.** Each `get` / `set` / `delete`
 *   crosses the wire. Latency typically <2 ms for a co-located
 *   Redis; budget accordingly for cross-AZ deployments.
 * - **JSON serialisation.** State must be JSON-serialisable — no
 *   functions, no class instances with prototypes, no circular
 *   refs. Same constraint the in-memory store has implicitly,
 *   surfaced explicitly here.
 *
 * The store does NOT pub/sub on changes — for live cross-pod
 * propagation of approval / operation registry state, pair this
 * with `RegistryProviderHook` (ADR-011) and a Redis pub/sub channel
 * the host wires separately. See cookbook entry
 * `multi-pod-deployment.md` (forthcoming).
 *
 * @example
 * ```ts
 * import Redis from 'ioredis';
 * import { RedisThreadStateStore } from '@maverick/agentic-ui-server-stores/redis';
 *
 * const redis = new Redis(process.env.REDIS_URL!);
 * const store = new RedisThreadStateStore<{ specialist: string }>({
 *   client: redis,
 *   prefix: 'prod:agentic:thread',
 *   ttlSeconds: 86_400,
 * });
 *
 * await store.set('thread-1', { specialist: 'bookings' });
 * const state = await store.get('thread-1');
 * ```
 */
export class RedisThreadStateStore<TState = unknown> implements ThreadStateStore<TState> {
  private readonly client: Redis;
  private readonly prefix: string;
  private readonly ttlSeconds: number | null;

  constructor(options: RedisThreadStateStoreOptions) {
    this.client = options.client;
    this.prefix = options.prefix;
    this.ttlSeconds = options.ttlSeconds === undefined ? 86_400 : options.ttlSeconds;
  }

  async get(threadId: string): Promise<TState | null> {
    const raw = await this.client.get(this.key(threadId));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as TState;
    } catch {
      // Treat corrupt entries as missing rather than throwing —
      // the orchestrator will recover by re-classifying on the
      // next turn.
      return null;
    }
  }

  async set(threadId: string, state: TState): Promise<void> {
    const payload = JSON.stringify(state);
    if (this.ttlSeconds === null) {
      await this.client.set(this.key(threadId), payload);
    } else {
      await this.client.set(this.key(threadId), payload, 'EX', this.ttlSeconds);
    }
  }

  async delete(threadId: string): Promise<void> {
    await this.client.del(this.key(threadId));
  }

  private key(threadId: string): string {
    return `${this.prefix}:${threadId}`;
  }
}
