import { Hono } from 'hono';
import type { CatalogPool } from '../db/pool.js';
import { pingDb } from '../db/pool.js';

/**
 * Health routes — bypass auth (these are infrastructure probes).
 *
 * - `/healthz` — liveness; the process is up. Always returns 200
 *   if it can serve a response at all.
 * - `/readyz` — readiness; the process can serve traffic. Confirms
 *   DB connectivity. Used by Kubernetes readiness probes / load
 *   balancers to gate traffic during startup or transient outages.
 */
export function healthRoutes(pool: CatalogPool): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', async (c) => {
    const dbOk = await pingDb(pool);
    if (!dbOk) {
      return c.json({ status: 'unready', db: 'unreachable' }, 503);
    }
    return c.json({ status: 'ready', db: 'ok' });
  });

  return app;
}
