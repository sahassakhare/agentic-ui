import type { CliConfig } from './config.js';

/**
 * Tiny typed catalog client for the CLI. Mirrors the relevant chunks
 * of the catalog's OpenAPI surface; we hand-roll instead of pulling
 * a code-gen dependency to keep the CLI bundle small.
 *
 * Auth: when `config.authMode === 'oidc'` we attach the bearer token
 * (or fail if missing). When `disabled`, we skip the header entirely
 * — matches the catalog's bearerAuth bypass per ADR-022.
 */

export interface CatalogRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  readonly accept?: string;
}

export interface CatalogClient {
  request(req: CatalogRequest): Promise<CatalogResponse>;
}

export interface CatalogResponse {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
  readonly headers: Headers;
}

export class CatalogError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) { super(message); }
}

export function createCatalogClient(
  config: CliConfig,
  fetchFn: typeof fetch = fetch,
): CatalogClient {
  return {
    async request(req: CatalogRequest): Promise<CatalogResponse> {
      const url = new URL(req.path, stripTrailingSlash(config.catalogUrl) + '/');
      if (req.query) {
        for (const [k, v] of Object.entries(req.query)) {
          if (v !== undefined) url.searchParams.set(k, String(v));
        }
      }
      const headers: Record<string, string> = {
        Accept: req.accept ?? 'application/json',
      };
      if (req.body !== undefined) headers['Content-Type'] = 'application/json';
      if (config.authMode === 'oidc') {
        if (!config.token) {
          throw new CatalogError(
            'No token configured. Run `mvk login` or set MVK_TOKEN.',
            -1,
            null,
          );
        }
        headers['Authorization'] = `Bearer ${config.token}`;
      }

      const init: RequestInit = { method: req.method, headers };
      if (req.body !== undefined) init.body = JSON.stringify(req.body);
      const res = await fetchFn(url.toString(), init);
      const text = await res.text();
      let body: unknown = null;
      if (text) {
        try { body = JSON.parse(text); }
        catch { body = text; }
      }
      if (!res.ok) {
        const detail = (body as { detail?: string } | null)?.detail
          ?? (body as { title?: string } | null)?.title
          ?? `HTTP ${res.status} ${res.statusText}`;
        throw new CatalogError(detail, res.status, body);
      }
      return { status: res.status, body, text, headers: res.headers };
    },
  };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
