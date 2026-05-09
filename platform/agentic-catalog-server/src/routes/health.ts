import { Hono } from 'hono';
import type { CatalogPool } from '../db/pool.js';
import { pingDb } from '../db/pool.js';

export interface HealthRouteOptions {
  /** Reported on `/healthz` so monitoring can spot trusted-network deployments. */
  readonly authMode?: 'oidc' | 'disabled';
}

/**
 * Health routes — bypass auth (these are infrastructure probes).
 *
 * - `/healthz` — liveness; the process is up. Always returns 200
 *   if it can serve a response at all. Reports `authMode` so
 *   monitoring + uptime checkers can flag accidental
 *   AUTH_MODE=disabled deployments before someone notices in
 *   production.
 * - `/readyz` — readiness; the process can serve traffic. Confirms
 *   DB connectivity. Used by Kubernetes readiness probes / load
 *   balancers to gate traffic during startup or transient outages.
 */
export function healthRoutes(pool: CatalogPool, options: HealthRouteOptions = {}): Hono {
  const app = new Hono();
  const authMode = options.authMode ?? 'oidc';

  app.get('/healthz', (c) => c.json({ status: 'ok', authMode }));

  app.get('/readyz', async (c) => {
    const dbOk = await pingDb(pool);
    if (!dbOk) {
      return c.json({ status: 'unready', db: 'unreachable', authMode }, 503);
    }
    return c.json({ status: 'ready', db: 'ok', authMode });
  });

  return app;
}
