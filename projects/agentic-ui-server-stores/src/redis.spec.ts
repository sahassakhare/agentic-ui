import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RedisThreadStateStore } from './redis';

// Minimal `ioredis` shape we exercise. Avoids importing the real
// dependency in unit tests — those are integration territory.
interface FakeRedisClient {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ...args: unknown[]) => Promise<'OK'>;
  del: (key: string) => Promise<number>;
}

describe('RedisThreadStateStore', () => {
  let store: Map<string, string>;
  let setCalls: Array<{ key: string; value: string; rest: unknown[] }>;
  let delCalls: string[];
  let client: FakeRedisClient;

  beforeEach(() => {
    store = new Map();
    setCalls = [];
    delCalls = [];
    client = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string, ...rest: unknown[]) => {
        setCalls.push({ key, value, rest });
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        delCalls.push(key);
        return store.delete(key) ? 1 : 0;
      }),
    };
  });

  it('roundtrips a single threadId', async () => {
    const s = new RedisThreadStateStore<{ specialist: string }>({
      client: client as never,
      prefix: 't:agentic:thread',
    });
    await s.set('thread-1', { specialist: 'bookings' });
    const got = await s.get('thread-1');
    expect(got).toEqual({ specialist: 'bookings' });
  });

  it('prefixes the key', async () => {
    const s = new RedisThreadStateStore({
      client: client as never,
      prefix: 'pfx',
    });
    await s.set('thread-1', 'payload');
    expect(setCalls[0]?.key).toBe('pfx:thread-1');
  });

  it('passes ttl as EX argument by default', async () => {
    const s = new RedisThreadStateStore({
      client: client as never,
      prefix: 'pfx',
    });
    await s.set('thread-1', 'payload');
    expect(setCalls[0]?.rest).toEqual(['EX', 86_400]);
  });

  it('honours custom ttlSeconds', async () => {
    const s = new RedisThreadStateStore({
      client: client as never,
      prefix: 'pfx',
      ttlSeconds: 60,
    });
    await s.set('thread-1', 'payload');
    expect(setCalls[0]?.rest).toEqual(['EX', 60]);
  });

  it('omits EX when ttlSeconds is null', async () => {
    const s = new RedisThreadStateStore({
      client: client as never,
      prefix: 'pfx',
      ttlSeconds: null,
    });
    await s.set('thread-1', 'payload');
    expect(setCalls[0]?.rest).toEqual([]);
  });

  it('returns null when the key is missing', async () => {
    const s = new RedisThreadStateStore({ client: client as never, prefix: 'pfx' });
    const got = await s.get('nope');
    expect(got).toBeNull();
  });

  it('treats corrupt payloads as missing rather than throwing', async () => {
    store.set('pfx:bad', '{not valid json');
    const s = new RedisThreadStateStore({ client: client as never, prefix: 'pfx' });
    const got = await s.get('bad');
    expect(got).toBeNull();
  });

  it('delete forwards to the client', async () => {
    const s = new RedisThreadStateStore({ client: client as never, prefix: 'pfx' });
    await s.set('thread-1', 'payload');
    await s.delete('thread-1');
    expect(delCalls).toEqual(['pfx:thread-1']);
    expect(await s.get('thread-1')).toBeNull();
  });

  it('serialises non-trivial state', async () => {
    const s = new RedisThreadStateStore<{ a: number; b: string[]; c: { nested: boolean } }>({
      client: client as never,
      prefix: 'pfx',
    });
    const payload = { a: 1, b: ['x', 'y'], c: { nested: true } };
    await s.set('t', payload);
    expect(await s.get('t')).toEqual(payload);
  });
});
