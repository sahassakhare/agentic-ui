import { z } from 'zod';

/**
 * Wire-format response from
 * `POST /v1/catalogs/{tenant}/role-mappings/resolve`. Strict — a
 * malformed response from a misconfigured catalog must NOT silently
 * promote a user to a persona; it must fall back.
 */
export const CatalogResolveResponseSchema = z.object({
  runtimePersona: z.string().nullable(),
  matchedClaimValues: z.array(z.string()),
  mappingId: z.string().nullable(),
  priority: z.number().int().nullable(),
});
export type CatalogResolveResponse = z.infer<typeof CatalogResolveResponseSchema>;

export interface CatalogResolveRequest {
  readonly catalogUrl: string;
  readonly tenantId: string;
  readonly token: string | null | undefined;
  readonly claimPath: string;
  readonly claimValues: readonly string[];
  /**
   * Per-call abort signal so adapter callers can cancel an in-flight
   * resolve when a new login event arrives.
   */
  readonly signal?: AbortSignal;
  /**
   * Override of the global `fetch`; used by tests.
   */
  readonly fetchFn?: typeof fetch;
}

/**
 * Call the catalog server's resolve endpoint. Returns the parsed
 * response on 2xx, throws on any other outcome (network error, non-
 * 2xx status, malformed body). The adapter wraps this in a
 * fall-back-to-default block — callers should NOT special-case the
 * thrown errors except to log them.
 *
 * No retries are baked in; the runtime adapter retries on the next
 * token-refresh tick. Building retry/backoff into this primitive
 * would couple it to a clock the host should own.
 */
export async function resolveActivePersona(
  request: CatalogResolveRequest,
): Promise<CatalogResolveResponse> {
  const url = `${stripTrailingSlash(request.catalogUrl)}/v1/catalogs/${encodeURIComponent(request.tenantId)}/role-mappings/resolve`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (request.token) {
    headers['Authorization'] = `Bearer ${request.token}`;
  }

  const fetcher = request.fetchFn ?? fetch;
  const res = await fetcher(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      claimPath: request.claimPath,
      claimValues: request.claimValues,
    }),
    signal: request.signal,
  });

  if (!res.ok) {
    const detail = await safeReadText(res);
    throw new Error(
      `catalog resolve failed: HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }

  const body = (await res.json()) as unknown;
  return CatalogResolveResponseSchema.parse(body);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function safeReadText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 500); }
  catch { return ''; }
}
