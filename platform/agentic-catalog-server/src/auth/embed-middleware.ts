import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { hashEmbedKey } from './embed-key.js';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import { findActivePublicationByName } from '../repository/publication-repo.js';
import type { Principal } from '../domain/principal.js';

/**
 * Anonymous embed access to published manifests. Three concerns, kept separate:
 *  - `embedCors`      — per-publication origin allow-list (deny-by-default),
 *                       answers the browser preflight (which carries no key).
 *  - `requireEmbedKey`— extracts + hashes the key for the handler (no DB hit).
 *  - `embedRateLimit` — minimal in-memory throttle. FLAGGED: single-replica only;
 *                       a shared store (Redis) is the production follow-up.
 */

const KEY_HEADER = 'x-embed-key';

/** A synthetic principal carrying only the path tenant — RLS reads `tenantId`. */
export function embedPrincipal(tenantId: string): Principal {
  return { subject: 'embed', tenantId, displayName: 'embed', roles: [], issuer: 'embed' };
}

/** Raw key from `x-embed-key` or `Authorization: Bearer`. */
function readRawKey(c: Context): string | null {
  const x = c.req.header(KEY_HEADER);
  if (x) return x.trim();
  const auth = c.req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

/** Parse `(tenant, name)` from an embed path — robust to the `/manifest` suffix
 *  and independent of Hono param timing inside `use('*')` middleware. */
function targetOf(c: Context): { tenant: string; name: string } | null {
  const path = new URL(c.req.url).pathname;
  const m = path.match(/\/v1\/embed\/([^/]+)\/experiences\/([^/]+?)(?:\/manifest)?\/?$/);
  if (!m) return null;
  return { tenant: decodeURIComponent(m[1]!), name: decodeURIComponent(m[2]!) };
}

/**
 * Per-publication CORS. The preflight (OPTIONS) has no key header, so origin is
 * authorized by looking up the active publication for `(tenant, name)` and
 * checking its `allowed_origins`. Deny-by-default: an origin not on the list
 * gets no `Access-Control-Allow-Origin` (browser blocks) and a 403 preflight.
 */
export function embedCors(pool: CatalogPool): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    let allowed = false;
    const target = targetOf(c);
    if (origin && target) {
      const rec = await withTenantScope(pool, embedPrincipal(target.tenant), (client) =>
        findActivePublicationByName(client, target.name),
      ).catch(() => null);
      allowed = !!rec && rec.allowedOrigins.includes(origin);
    }
    if (allowed && origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Headers', 'Authorization, X-Embed-Key, Content-Type');
      c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      c.header('Access-Control-Max-Age', '600');
    }
    if (c.req.method === 'OPTIONS') {
      return c.body(null, allowed ? 204 : 403);
    }
    await next();
    return;
  };
}

/** Require an embed key; stash its SHA-256 hash. No DB hit — the handler does the
 *  tenant-scoped lookup so RLS applies. Missing key → 401. */
export function requireEmbedKey(): MiddlewareHandler {
  return async (c, next) => {
    const raw = readRawKey(c);
    if (!raw) throw new HTTPException(401, { message: 'Missing embed key' });
    c.set('embedKeyHash', hashEmbedKey(raw));
    await next();
  };
}

/** Minimal fixed-window rate limit keyed by embed-key hash (in-memory). */
export function embedRateLimit(opts: { perMinute?: number } = {}): MiddlewareHandler {
  const limit = opts.perMinute ?? 120;
  const windowMs = 60_000;
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const key = (c.get('embedKeyHash') as string | undefined) ?? c.req.header('origin') ?? 'anon';
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k); // opportunistic prune
    }
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) throw new HTTPException(429, { message: 'Rate limit exceeded' });
    await next();
  };
}
