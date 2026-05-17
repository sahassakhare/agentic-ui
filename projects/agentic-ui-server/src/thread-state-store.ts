/**
 * Pluggable per-thread state store. Used by stateful agents (notably the
 * orchestrator's sticky-by-thread routing) so state survives a process
 * restart and can be shared across pods.
 *
 * @remarks
 * The library ships an in-memory implementation suitable for single-pod
 * deployments and tests. For production multi-pod deployments, implement
 * this interface against Redis / Postgres / DynamoDB / your store of
 * choice — every method is async-shaped so a real network roundtrip
 * fits naturally.
 *
 * @typeParam TState  Per-thread state shape. Must be JSON-serialisable.
 *
 * @example
 * ```ts
 * import type { ThreadStateStore } from '@infra-tools/agentic-ui-server';
 * import { createClient } from 'redis';
 *
 * class RedisThreadStateStore<TState> implements ThreadStateStore<TState> {
 *   private redis = createClient({ url: process.env.REDIS_URL });
 *   constructor(private readonly prefix: string, private readonly ttlSeconds = 86_400) {}
 *
 *   async get(threadId: string) {
 *     const raw = await this.redis.get(`${this.prefix}:${threadId}`);
 *     return raw ? (JSON.parse(raw) as TState) : null;
 *   }
 *   async set(threadId: string, state: TState) {
 *     await this.redis.set(`${this.prefix}:${threadId}`, JSON.stringify(state),
 *                          { EX: this.ttlSeconds });
 *   }
 *   async delete(threadId: string) {
 *     await this.redis.del(`${this.prefix}:${threadId}`);
 *   }
 * }
 * ```
 */
export interface ThreadStateStore<TState = unknown> {
  /**
   * Resolve the stored state for `threadId`, or `null` if there is none.
   * Implementations should treat "not found" and "expired" as the same
   * outcome (return `null`).
   */
  get(threadId: string): Promise<TState | null>;

  /**
   * Replace the stored state for `threadId`. Atomic per thread; concurrent
   * calls for the same thread should resolve in arrival order.
   */
  set(threadId: string, state: TState): Promise<void>;

  /**
   * Drop any stored state for `threadId`. No-op if nothing is stored.
   * Call from the agent's optional `reset()` method when the user clears
   * the conversation.
   */
  delete?(threadId: string): Promise<void>;
}

/**
 * Default in-memory implementation of {@link ThreadStateStore}. Adequate
 * for single-pod deployments, tests, and local development. Uses a
 * `Map<string, TState>` under the hood — state is lost on process
 * restart, which is the cliff that motivated extracting this interface.
 *
 * @example
 * ```ts
 * const store = new InMemoryThreadStateStore<{ specialist: string }>();
 * await store.set('thread-1', { specialist: 'bookings' });
 * const state = await store.get('thread-1');  // → { specialist: 'bookings' }
 * ```
 */
export class InMemoryThreadStateStore<TState = unknown> implements ThreadStateStore<TState> {
  private readonly map = new Map<string, TState>();

  async get(threadId: string): Promise<TState | null> {
    return this.map.get(threadId) ?? null;
  }

  async set(threadId: string, state: TState): Promise<void> {
    this.map.set(threadId, state);
  }

  async delete(threadId: string): Promise<void> {
    this.map.delete(threadId);
  }

  /** Test helper — drops all stored state. Not part of the interface. */
  clear(): void {
    this.map.clear();
  }

  /** Test helper — returns the current entry count. Not part of the interface. */
  get size(): number {
    return this.map.size;
  }
}
