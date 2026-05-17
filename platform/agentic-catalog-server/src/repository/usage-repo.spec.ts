import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createPgMemPool, type PgMemHandle } from '../test-helpers/pg-mem-pool.js';
import {
  aggregateUsage,
  appendUsage,
  listRecentUsage,
} from './usage-repo.js';

const TENANT = 'test-tenant';

async function withClient<T>(handle: PgMemHandle, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await handle.pool.connect();
  try { return await fn(client); } finally { client.release(); }
}

describe('usage-repo (M3 C5)', () => {
  let handle: PgMemHandle;

  beforeEach(() => { handle = createPgMemPool({ seedTenantId: TENANT }); });
  afterEach(async () => { await handle.destroy(); });

  it('appends a usage event and returns the canonical shape', async () => {
    const event = await withClient(handle, (c) => appendUsage(c, TENANT, {
      kind: 'llm.tokens.input',
      quantity: 1234,
      tags: { model: 'gpt-4o', user: 'u-001' },
    }));
    expect(event.kind).toBe('llm.tokens.input');
    expect(event.quantity).toBe(1234);
    expect(event.tags).toEqual({ model: 'gpt-4o', user: 'u-001' });
    expect(event.idempotencyKey).toBeNull();
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.occurredAt).toMatch(/T/);
  });

  it('idempotent POST returns the original event on retry', async () => {
    const first = await withClient(handle, (c) => appendUsage(c, TENANT, {
      kind: 'tool.invoke',
      quantity: 1,
      tags: {},
      idempotencyKey: 'k-001',
    }));
    const second = await withClient(handle, (c) => appendUsage(c, TENANT, {
      kind: 'tool.invoke',
      // Different quantity — must be IGNORED on conflict.
      quantity: 999,
      tags: { spurious: true },
      idempotencyKey: 'k-001',
    }));
    expect(second.id).toBe(first.id);
    expect(second.quantity).toBe(1);
  });

  it('non-idempotent POSTs accept duplicates', async () => {
    await withClient(handle, (c) => appendUsage(c, TENANT, { kind: 'a', quantity: 1, tags: {} }));
    await withClient(handle, (c) => appendUsage(c, TENANT, { kind: 'a', quantity: 1, tags: {} }));
    const recent = await withClient(handle, (c) => listRecentUsage(c, TENANT));
    expect(recent.length).toBe(2);
  });

  it('aggregateUsage groups by kind and sums quantity', async () => {
    await withClient(handle, async (c) => {
      await appendUsage(c, TENANT, { kind: 'llm.tokens.input', quantity: 100, tags: {} });
      await appendUsage(c, TENANT, { kind: 'llm.tokens.input', quantity: 200, tags: {} });
      await appendUsage(c, TENANT, { kind: 'llm.tokens.output', quantity: 50, tags: {} });
      await appendUsage(c, TENANT, { kind: 'tool.invoke', quantity: 5, tags: {} });
    });
    const result = await withClient(handle, (c) => aggregateUsage(c, TENANT, {}));
    expect(result.byKind).toEqual({
      'llm.tokens.input': 300,
      'llm.tokens.output': 50,
      'tool.invoke': 5,
    });
    expect(result.totalEvents).toBe(4);
    expect(result.totalQuantity).toBe(355);
  });

  it('aggregateUsage filters by kind', async () => {
    await withClient(handle, async (c) => {
      await appendUsage(c, TENANT, { kind: 'llm.tokens.input', quantity: 100, tags: {} });
      await appendUsage(c, TENANT, { kind: 'tool.invoke', quantity: 5, tags: {} });
    });
    const result = await withClient(handle, (c) => aggregateUsage(c, TENANT, {
      kind: 'llm.tokens.input',
    }));
    expect(result.byKind).toEqual({ 'llm.tokens.input': 100 });
    expect(result.totalQuantity).toBe(100);
  });

  it('listRecentUsage caps the limit between 1 and 1000', async () => {
    for (let i = 0; i < 5; i++) {
      await withClient(handle, (c) => appendUsage(c, TENANT, {
        kind: 'k', quantity: i, tags: {},
      }));
    }
    const top1 = await withClient(handle, (c) => listRecentUsage(c, TENANT, 1));
    expect(top1.length).toBe(1);
    const all = await withClient(handle, (c) => listRecentUsage(c, TENANT, 999_999));
    expect(all.length).toBe(5);
    const minClamped = await withClient(handle, (c) => listRecentUsage(c, TENANT, -42));
    expect(minClamped.length).toBe(1);
  });

  it('appendUsage stores client-supplied occurredAt', async () => {
    const ts = '2026-01-15T12:34:56.000Z';
    const event = await withClient(handle, (c) => appendUsage(c, TENANT, {
      kind: 'llm.tokens.input', quantity: 10, tags: {},
      occurredAt: ts,
    }));
    expect(event.occurredAt).toBe(ts);
  });
});
