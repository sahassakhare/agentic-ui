import { logger } from '../logger.js';

/**
 * Pluggable embedding provider abstraction. The catalog server doesn't
 * bundle any embedding model — adopters configure a provider via
 * environment variables (`EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY`,
 * `EMBEDDING_MODEL`, `EMBEDDING_API_URL`). Default `noop` returns
 * `null` so the install + first-run path is friction-free; semantic
 * search returns 422 "embeddings not configured" until adopters opt
 * in.
 *
 * Slice SEM-A — ADR-038.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** Embedding dimension; the migration's vector(N) must match. */
  readonly dim: number;

  /**
   * Embed a single string. Returns `null` when the provider is in
   * `noop` mode OR when the call fails (the catalog catches errors,
   * logs them, and continues without an embedding — semantic
   * features quietly degrade rather than blocking writes).
   */
  embed(text: string): Promise<readonly number[] | null>;
}

export interface EmbeddingProviderConfig {
  readonly provider: 'noop' | 'openai' | 'cohere' | 'ollama';
  readonly apiKey?: string;
  readonly apiUrl?: string;
  readonly model?: string;
  readonly dim?: number;
  /** Override `globalThis.fetch`. Test seam. */
  readonly fetchFn?: typeof fetch;
}

class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'noop';
  readonly enabled = false;
  readonly dim: number;
  constructor(dim: number) { this.dim = dim; }
  async embed(): Promise<null> { return null; }
}

/**
 * OpenAI embeddings via `POST /v1/embeddings`. Default model
 * `text-embedding-3-small` (1536-dim).
 */
class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly enabled = true;
  readonly dim: number;
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(cfg: EmbeddingProviderConfig) {
    if (!cfg.apiKey) throw new Error('EMBEDDING_API_KEY required for provider=openai');
    this.apiKey = cfg.apiKey;
    this.apiUrl = cfg.apiUrl ?? 'https://api.openai.com';
    this.model = cfg.model ?? 'text-embedding-3-small';
    this.dim = cfg.dim ?? 1536;
    this.fetcher = cfg.fetchFn ?? fetch;
  }

  async embed(text: string): Promise<readonly number[] | null> {
    try {
      const res = await this.fetcher(`${stripTrail(this.apiUrl)}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: text }),
      });
      if (!res.ok) {
        const detail = await safeText(res);
        logger.warn({ status: res.status, detail }, 'openai embedding failed');
        return null;
      }
      const body = await res.json() as { data: Array<{ embedding: number[] }> };
      return body.data[0]?.embedding ?? null;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'openai embedding errored');
      return null;
    }
  }
}

/**
 * Cohere embeddings via `POST /v1/embed`. Default model
 * `embed-english-v3.0` (1024-dim — adopters MUST set
 * EMBEDDING_DIM=1024 + run an `ALTER TABLE` to match).
 */
class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'cohere';
  readonly enabled = true;
  readonly dim: number;
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(cfg: EmbeddingProviderConfig) {
    if (!cfg.apiKey) throw new Error('EMBEDDING_API_KEY required for provider=cohere');
    this.apiKey = cfg.apiKey;
    this.apiUrl = cfg.apiUrl ?? 'https://api.cohere.ai';
    this.model = cfg.model ?? 'embed-english-v3.0';
    this.dim = cfg.dim ?? 1024;
    this.fetcher = cfg.fetchFn ?? fetch;
  }

  async embed(text: string): Promise<readonly number[] | null> {
    try {
      const res = await this.fetcher(`${stripTrail(this.apiUrl)}/v1/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          texts: [text],
          input_type: 'search_document',
        }),
      });
      if (!res.ok) {
        const detail = await safeText(res);
        logger.warn({ status: res.status, detail }, 'cohere embedding failed');
        return null;
      }
      const body = await res.json() as { embeddings: number[][] };
      return body.embeddings[0] ?? null;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'cohere embedding errored');
      return null;
    }
  }
}

/**
 * Ollama embeddings via `POST /api/embeddings`. Default model
 * `nomic-embed-text` (768-dim — adopters MUST set EMBEDDING_DIM=768).
 * Self-hosted; no API key required by default.
 */
class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly enabled = true;
  readonly dim: number;
  private readonly apiUrl: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(cfg: EmbeddingProviderConfig) {
    this.apiUrl = cfg.apiUrl ?? 'http://localhost:11434';
    this.model = cfg.model ?? 'nomic-embed-text';
    this.dim = cfg.dim ?? 768;
    this.fetcher = cfg.fetchFn ?? fetch;
  }

  async embed(text: string): Promise<readonly number[] | null> {
    try {
      const res = await this.fetcher(`${stripTrail(this.apiUrl)}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!res.ok) {
        const detail = await safeText(res);
        logger.warn({ status: res.status, detail }, 'ollama embedding failed');
        return null;
      }
      const body = await res.json() as { embedding: number[] };
      return body.embedding ?? null;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'ollama embedding errored');
      return null;
    }
  }
}

export function makeEmbeddingProvider(cfg: EmbeddingProviderConfig): EmbeddingProvider {
  switch (cfg.provider) {
    case 'noop':   return new NoopEmbeddingProvider(cfg.dim ?? 1536);
    case 'openai': return new OpenAiEmbeddingProvider(cfg);
    case 'cohere': return new CohereEmbeddingProvider(cfg);
    case 'ollama': return new OllamaEmbeddingProvider(cfg);
  }
}

/**
 * Build the text we embed for a capability — name + body.description
 * (when present) + tags + kind. Kept deterministic so back-fills
 * produce the same embeddings as fresh inserts.
 */
export function buildEmbeddingText(input: {
  readonly kind: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly body: Record<string, unknown>;
}): string {
  const parts: string[] = [`kind: ${input.kind}`, `name: ${input.name}`];
  const description = typeof input.body['description'] === 'string'
    ? input.body['description']
    : null;
  if (description) parts.push(`description: ${description}`);
  if (input.tags.length > 0) parts.push(`tags: ${input.tags.join(', ')}`);
  return parts.join('\n');
}

function stripTrail(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function safeText(r: Response): Promise<string> {
  try { return (await r.text()).slice(0, 500); }
  catch { return ''; }
}
