import type { PublishedManifest } from './types.js';

export interface EmbedClientConfig {
  /** Base URL of the catalog server, e.g. `https://catalog.example.com`. */
  catalogUrl: string;
  /** Tenant that owns the published experience. */
  tenant: string;
  /** The public embed key (read-only, origin-pinned). Shown once at publish time. */
  key: string;
  /**
   * Origin to send (server-side/non-browser callers only). Browsers set `Origin`
   * automatically and cannot override it; the catalog enforces it against the
   * publication's allow-list either way.
   */
  origin?: string;
  /** Injectable fetch (tests / non-standard runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** A non-2xx response from the embed endpoint. */
export class EmbedError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'EmbedError';
  }
}

export interface EmbedClient {
  /** Fetch the frozen render manifest for a published experience by name. */
  getManifest(experienceName: string): Promise<PublishedManifest>;
}

/**
 * Create a headless embed client. The client fetches a **published** render
 * manifest for an experience and returns it as plain JSON — the portal renders
 * it with its own components. No platform login, no framework coupling.
 *
 * @example
 * ```ts
 * const client = createEmbedClient({
 *   catalogUrl: 'https://catalog.example.com',
 *   tenant: 'acme',
 *   key: 'emb_…',
 * });
 * const manifest = await client.getManifest('support-ticket');
 * // walk manifest.workflow.steps with resolveNext(step.next, state)
 * ```
 */
export function createEmbedClient(config: EmbedClientConfig): EmbedClient {
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  if (!doFetch) throw new Error('No fetch implementation available; pass config.fetchImpl');
  const base = config.catalogUrl.replace(/\/+$/, '');

  return {
    async getManifest(experienceName: string): Promise<PublishedManifest> {
      const url =
        `${base}/v1/embed/${encodeURIComponent(config.tenant)}` +
        `/experiences/${encodeURIComponent(experienceName)}/manifest`;
      const headers: Record<string, string> = { 'x-embed-key': config.key, accept: 'application/json' };
      if (config.origin) headers['origin'] = config.origin;

      let res: Response;
      try {
        res = await doFetch(url, { method: 'GET', headers });
      } catch (err) {
        throw new EmbedError(0, `Network error fetching manifest: ${(err as Error).message}`, 'network');
      }
      if (!res.ok) {
        let code: string | undefined;
        try {
          const body = (await res.json()) as { code?: string; message?: string };
          code = body.code;
        } catch { /* non-JSON error body */ }
        throw new EmbedError(res.status, `Embed request failed (${res.status})`, code);
      }
      return (await res.json()) as PublishedManifest;
    },
  };
}
