import { describe, expect, it, vi } from 'vitest';
import { buildEmbeddingText, makeEmbeddingProvider } from './provider.js';

describe('makeEmbeddingProvider', () => {
  describe('noop', () => {
    it('returns enabled:false and embed() resolves to null', async () => {
      const p = makeEmbeddingProvider({ provider: 'noop' });
      expect(p.enabled).toBe(false);
      expect(p.name).toBe('noop');
      expect(await p.embed('anything')).toBeNull();
    });
  });

  describe('openai', () => {
    it('throws if api key is missing', () => {
      expect(() => makeEmbeddingProvider({ provider: 'openai' })).toThrow(/EMBEDDING_API_KEY required/);
    });

    it('POSTs to /v1/embeddings with bearer auth + model + input', async () => {
      const fetchMock = vi.fn(async () => new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200 },
      ));
      const p = makeEmbeddingProvider({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'text-embedding-3-small',
        fetchFn: fetchMock as unknown as typeof fetch,
      });
      const vec = await p.embed('how do I book a flight');
      expect(vec).toEqual([0.1, 0.2, 0.3]);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/embeddings');
      expect((init as RequestInit).method).toBe('POST');
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-test');
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toEqual({ model: 'text-embedding-3-small', input: 'how do I book a flight' });
    });

    it('returns null on non-2xx (caller stores NULL embedding gracefully)', async () => {
      const p = makeEmbeddingProvider({
        provider: 'openai',
        apiKey: 'sk-test',
        fetchFn: (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch,
      });
      expect(await p.embed('x')).toBeNull();
    });

    it('returns null on network error (caller stores NULL embedding gracefully)', async () => {
      const p = makeEmbeddingProvider({
        provider: 'openai',
        apiKey: 'sk-test',
        fetchFn: (async () => { throw new Error('econnrefused'); }) as unknown as typeof fetch,
      });
      expect(await p.embed('x')).toBeNull();
    });
  });

  describe('cohere', () => {
    it('POSTs to /v1/embed with model + texts array + input_type', async () => {
      const fetchMock = vi.fn(async () => new Response(
        JSON.stringify({ embeddings: [[0.4, 0.5]] }),
        { status: 200 },
      ));
      const p = makeEmbeddingProvider({
        provider: 'cohere',
        apiKey: 'co-test',
        dim: 2,
        fetchFn: fetchMock as unknown as typeof fetch,
      });
      const vec = await p.embed('legal hold');
      expect(vec).toEqual([0.4, 0.5]);
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
      expect(body.texts).toEqual(['legal hold']);
      expect(body.input_type).toBe('search_document');
    });
  });

  describe('ollama', () => {
    it('POSTs to localhost:11434 (default) with no auth', async () => {
      const fetchMock = vi.fn(async () => new Response(
        JSON.stringify({ embedding: [0.7, 0.8] }),
        { status: 200 },
      ));
      const p = makeEmbeddingProvider({
        provider: 'ollama',
        dim: 2,
        fetchFn: fetchMock as unknown as typeof fetch,
      });
      await p.embed('test');
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://localhost:11434/api/embeddings');
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });
});

describe('buildEmbeddingText', () => {
  it('combines kind + name + description + tags into a deterministic string', () => {
    const text = buildEmbeddingText({
      kind: 'tool',
      name: 'addCustodian',
      tags: ['eDiscovery', 'shell'],
      body: { description: 'Add a custodian to the legal hold matter' },
    });
    expect(text).toBe(
      'kind: tool\nname: addCustodian\ndescription: Add a custodian to the legal hold matter\ntags: eDiscovery, shell',
    );
  });

  it('omits the description line when body has no description field', () => {
    const text = buildEmbeddingText({
      kind: 'component',
      name: 'flightCard',
      tags: [],
      body: {},
    });
    expect(text).toBe('kind: component\nname: flightCard');
  });

  it('omits the tags line when tags array is empty', () => {
    const text = buildEmbeddingText({
      kind: 'tool',
      name: 'foo',
      tags: [],
      body: { description: 'd' },
    });
    expect(text).toBe('kind: tool\nname: foo\ndescription: d');
  });
});
