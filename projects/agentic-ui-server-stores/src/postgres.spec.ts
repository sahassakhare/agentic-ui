import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PostgresThreadStateStore, createSchemaSql } from './postgres';

// Minimal `pg` shape we exercise. Real `pg.Pool` / `pg.PoolClient`
// are not pulled in for unit tests.
interface FakeClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  release: () => void;
}
interface FakePool {
  connect: () => Promise<FakeClient>;
}

describe('PostgresThreadStateStore', () => {
  let queries: Array<{ sql: string; params?: unknown[] }>;
  let nextRows: unknown[];
  let pool: FakePool;

  beforeEach(() => {
    queries = [];
    nextRows = [];
    pool = {
      connect: vi.fn(async () => ({
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          queries.push({ sql, params });
          const rows = nextRows;
          nextRows = [];
          return { rows };
        }),
        release: vi.fn(),
      })),
    };
  });

  it('get returns parsed state when row present', async () => {
    nextRows = [{ state: { specialist: 'bookings' } }];
    const s = new PostgresThreadStateStore<{ specialist: string }>({
      pool: pool as never,
      table: 'agentic.thread_state',
    });
    const got = await s.get('thread-1');
    expect(got).toEqual({ specialist: 'bookings' });
  });

  it('get returns null when no row', async () => {
    const s = new PostgresThreadStateStore({
      pool: pool as never,
      table: 'agentic.thread_state',
    });
    const got = await s.get('missing');
    expect(got).toBeNull();
  });

  it('get filters expired rows via SQL clause', async () => {
    const s = new PostgresThreadStateStore({
      pool: pool as never,
      table: 'agentic.thread_state',
    });
    await s.get('thread-1');
    expect(queries[0]?.sql).toContain('expires_at IS NULL OR expires_at > now()');
  });

  it('set serialises to JSONB + sets expires_at', async () => {
    const s = new PostgresThreadStateStore({
      pool: pool as never,
      table: 'agentic.thread_state',
      ttlSeconds: 60,
    });
    await s.set('thread-1', { specialist: 'bookings' });
    expect(queries[0]?.sql).toMatch(/INSERT INTO agentic\.thread_state/);
    expect(queries[0]?.sql).toMatch(/ON CONFLICT.*DO UPDATE/s);
    expect(queries[0]?.params?.[0]).toBe('thread-1');
    expect(queries[0]?.params?.[1]).toBe(JSON.stringify({ specialist: 'bookings' }));
    expect(queries[0]?.params?.[2]).toBeInstanceOf(Date);
  });

  it('set passes null expires_at when ttlSeconds is null', async () => {
    const s = new PostgresThreadStateStore({
      pool: pool as never,
      table: 'agentic.thread_state',
      ttlSeconds: null,
    });
    await s.set('thread-1', 'payload');
    expect(queries[0]?.params?.[2]).toBeNull();
  });

  it('delete issues DELETE WHERE thread_id', async () => {
    const s = new PostgresThreadStateStore({
      pool: pool as never,
      table: 'agentic.thread_state',
    });
    await s.delete('thread-1');
    expect(queries[0]?.sql).toMatch(/DELETE FROM agentic\.thread_state WHERE thread_id = \$1/);
    expect(queries[0]?.params).toEqual(['thread-1']);
  });

  it('releases the pool client even on query error', async () => {
    const released = vi.fn();
    pool = {
      connect: vi.fn(async () => ({
        query: vi.fn(async () => { throw new Error('boom'); }),
        release: released,
      })),
    };
    const s = new PostgresThreadStateStore({
      pool: pool as never,
      table: 'agentic.thread_state',
    });
    await expect(s.get('thread-1')).rejects.toThrow('boom');
    expect(released).toHaveBeenCalledOnce();
  });

  it('createSchemaSql emits idempotent CREATE TABLE + index', () => {
    const sql = createSchemaSql({ table: 'agentic.thread_state' });
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS agentic\.thread_state/);
    expect(sql).toMatch(/state\s+JSONB NOT NULL/);
    expect(sql).toMatch(/expires_at\s+TIMESTAMPTZ NULL/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS thread_state_expires_at_idx/);
  });
});
