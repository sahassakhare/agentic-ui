import { describe, expect, it, vi } from 'vitest';
import { interpretOpaResult, makeOpaClient } from './opa-client.js';

describe('interpretOpaResult', () => {
  it('bare boolean → { allow: <bool> }', () => {
    expect(interpretOpaResult(true, 'b', 'maverick/allow').allow).toBe(true);
    expect(interpretOpaResult(false, 'b', 'maverick/allow').allow).toBe(false);
  });

  it('object with `allow` boolean → passes through with reason + obligations', () => {
    const out = interpretOpaResult(
      { allow: true, reason: 'paralegal during business hours', obligations: { redactPII: true } },
      'b',
      'maverick/allow',
    );
    expect(out.allow).toBe(true);
    expect(out.reason).toBe('paralegal during business hours');
    expect(out.obligations).toEqual({ redactPII: true });
  });

  it('falls back to truthy/falsy with raw payload for non-standard shapes', () => {
    const out = interpretOpaResult({ score: 0.92 }, 'b', 'p');
    expect(out.allow).toBe(true);
    expect(out.raw).toEqual({ score: 0.92 });
  });

  it('null/undefined → allow: false', () => {
    expect(interpretOpaResult(null, 'b', 'p').allow).toBe(false);
    expect(interpretOpaResult(undefined, 'b', 'p').allow).toBe(false);
  });
});

describe('makeOpaClient', () => {
  it('returns a noop client when no config is provided (decision throws if called)', async () => {
    const client = makeOpaClient(null);
    expect(client.enabled).toBe(false);
    expect(client.url).toBeNull();
    await expect(client.evaluate('x', {}, null)).rejects.toThrow(/OPA not configured/);
  });

  it('http client POSTs to /v1/data/{rule} with input wrapped + interprets result', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ result: { allow: true, reason: 'ok' } }), { status: 200 }),
    );
    const client = makeOpaClient({
      url: 'http://opa.example.com:8181',
      fetchFn: fetchMock as unknown as typeof fetch,
    });
    const out = await client.evaluate('maverick/capabilities/allow', { user: 'paralegal' }, 'demo');
    expect(out.allow).toBe(true);
    expect(out.reason).toBe('ok');
    expect(out.bundle).toBe('demo');
    expect(out.rulePath).toBe('maverick/capabilities/allow');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://opa.example.com:8181/v1/data/maverick/capabilities/allow');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({ input: { user: 'paralegal' } });
  });

  it('throws when OPA returns non-2xx', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    const client = makeOpaClient({
      url: 'http://opa.example.com',
      fetchFn: fetchMock as unknown as typeof fetch,
    });
    await expect(client.evaluate('x', {}, null)).rejects.toThrow(/HTTP 500/);
  });

  it('strips leading slashes + handles dotted-rule paths', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: true }), { status: 200 }));
    const client = makeOpaClient({
      url: 'http://opa.example.com',
      fetchFn: fetchMock as unknown as typeof fetch,
    });
    await client.evaluate('//foo.bar.allow', {}, null);
    const [url] = fetchMock.mock.calls[0]!;
    // Leading slashes stripped, dots converted to slashes
    expect(url).toBe('http://opa.example.com/v1/data/foo/bar/allow');
  });
});
