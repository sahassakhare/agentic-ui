import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import { findActivePublicationByKeyHash } from '../repository/publication-repo.js';
import { embedCors, embedPrincipal, embedRateLimit, requireEmbedKey } from '../auth/embed-middleware.js';

/**
 * Anonymous, key-scoped embed read (headless consumption). Mounted OUTSIDE the
 * tenant-JWT chain — an origin-pinned embed key is the only credential.
 *
 *   GET /v1/embed/:tenant/experiences/:name           → frozen render manifest
 *   GET /v1/embed/:tenant/experiences/:name/manifest  → alias
 *
 * Security is by CONSTRUCTION: the handler only ever echoes an `active`
 * publication's frozen `bundle` (looked up by key hash, tenant-scoped via RLS).
 * It never queries `experiences`/`capabilities`, so draft / unapproved /
 * other-tenant content is unreachable. A wrong/unknown key returns 404 (no
 * oracle distinguishing "bad key" from "no such publication").
 */
export function embedRoutes(pool: CatalogPool): Hono {
  const app = new Hono();
  app.use('*', embedCors(pool));
  app.use('*', requireEmbedKey());
  app.use('*', embedRateLimit());

  const serveManifest = async (c: Context) => {
    const tenant = c.req.param('tenant');
    const name = c.req.param('name');
    if (!tenant || !name) throw new HTTPException(404, { message: 'Not found' });
    const keyHash = c.get('embedKeyHash') as string;
    const origin = c.req.header('origin');

    const rec = await withTenantScope(pool, embedPrincipal(tenant), (client) =>
      findActivePublicationByKeyHash(client, keyHash, tenant),
    );
    // Unknown key, wrong tenant, or key bound to a different experience → 404.
    if (!rec || rec.experienceName !== name) throw new HTTPException(404, { message: 'Not found' });
    // Browser callers send Origin; it must be on the publication's allow-list.
    if (origin && !rec.allowedOrigins.includes(origin)) {
      throw new HTTPException(403, { message: 'Origin not allowed' });
    }
    return c.json(rec.bundle);
  };

  app.get('/:tenant/experiences/:name', serveManifest);
  app.get('/:tenant/experiences/:name/manifest', serveManifest);
  return app;
}
