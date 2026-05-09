import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { CatalogPool } from './db/pool.js';
import { JwtVerifier, type JwtVerifierConfig } from './auth/jwt.js';
import { bearerAuth, requireTenantScope } from './auth/middleware.js';
import { globalErrorHandler, requestIdMiddleware } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { capabilitiesRoutes } from './routes/capabilities.js';
import { mfesRoutes } from './routes/mfes.js';
import { roleMappingsRoutes } from './routes/role-mappings.js';
import { auditRoutes } from './routes/audit.js';
import { usageRoutes } from './routes/usage.js';
import { tenantsRoutes } from './routes/tenants.js';
import { streamRoutes } from './routes/stream.js';
import { openapiRoutes } from './routes/openapi.js';
import { logger } from './logger.js';

export interface AppDeps {
  readonly pool: CatalogPool;
  /**
   * OIDC verifier config. Required when `authMode` is `'oidc'` (or
   * omitted, which defaults to `'oidc'`); ignored when
   * `authMode = 'disabled'`.
   */
  readonly auth?: JwtVerifierConfig;
  /**
   * Trust mode for incoming requests.
   * - `'oidc'` (default): every request must carry a JWT validated
   *   against `auth.issuer`'s JWKS.
   * - `'disabled'`: every request is treated as platform-admin with
   *   tenant scope from the URL path. Demo / trusted-network only —
   *   see ADR-022.
   */
  readonly authMode?: 'oidc' | 'disabled';
  /**
   * CORS origin allow-list. Defaults to `*` in development; production
   * should pin to the ops-console hostname.
   */
  readonly corsOrigins?: readonly string[];
}

/**
 * Build the Hono app graph. Pure function — easy to unit-test by
 * passing a mock pool + verifier.
 */
export function buildApp(deps: AppDeps): Hono {
  const app = new Hono();
  const authMode = deps.authMode ?? 'oidc';
  const verifier = authMode === 'oidc'
    ? new JwtVerifier(
        deps.auth ?? (() => { throw new Error('auth config required when authMode=oidc'); })(),
      )
    : null;
  if (authMode === 'disabled') {
    logger.warn(
      'AUTH_MODE=disabled — JWT verification is OFF. Every request is treated as platform-admin. Demo / trusted-network only. See ADR-022.',
    );
  }

  // ── Cross-cutting middleware ─────────────────────────────────────
  app.use('*', requestIdMiddleware());
  app.use('*', cors({
    origin: deps.corsOrigins?.length ? [...deps.corsOrigins] : '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: 600,
  }));
  app.use('*', async (c, next) => {
    const start = Date.now();
    try {
      await next();
    } finally {
      const status = c.res.status;
      const requestId = c.get('requestId');
      logger.info({
        requestId,
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs: Date.now() - start,
      }, 'request');
    }
  });

  app.onError(globalErrorHandler);

  // ── Health (no auth) ─────────────────────────────────────────────
  app.route('/', healthRoutes(deps.pool, { authMode }));
  // OpenAPI spec — public + unauthenticated. The schema describes
  // only public surface; no secrets leak.
  app.route('/v1', openapiRoutes());

  // ── Authenticated, tenant-scoped routes ──────────────────────────
  // Sub-router scoped under `/v1/catalogs/:tenant`. bearerAuth runs
  // first to populate the principal; requireTenantScope then asserts
  // the path tenant matches the JWT claim (or principal is platform-
  // admin).
  const v1 = new Hono();
  v1.use('*', bearerAuth(verifier, { disabled: authMode === 'disabled' }));
  // Platform-level routes (NOT tenant-scoped). Mount BEFORE the
  // /catalogs/:tenant/* tenant-scope middleware so the tenant guard
  // doesn't fire for /v1/tenants/*.
  v1.route('/tenants', tenantsRoutes(deps.pool));
  v1.use('/catalogs/:tenant/*', requireTenantScope());
  v1.route('/catalogs/:tenant/capabilities', capabilitiesRoutes(deps.pool));
  v1.route('/catalogs/:tenant/mfes', mfesRoutes(deps.pool));
  v1.route('/catalogs/:tenant/role-mappings', roleMappingsRoutes(deps.pool));
  v1.route('/catalogs/:tenant/audit', auditRoutes(deps.pool));
  v1.route('/catalogs/:tenant/usage', usageRoutes(deps.pool));
  v1.route('/catalogs/:tenant/stream', streamRoutes());
  app.route('/v1', v1);

  return app;
}
