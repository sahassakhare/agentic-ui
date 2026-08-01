import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { CatalogPool } from './db/pool.js';
import { JwtVerifier, type JwtVerifierConfig } from './auth/jwt.js';
import { bearerAuth, requireTenantScope, requireWriteAccess, writerRolesFromEnv, requirePolicyDecision } from './auth/middleware.js';
import { globalErrorHandler, requestIdMiddleware } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { capabilitiesRoutes } from './routes/capabilities.js';
import { mfesRoutes } from './routes/mfes.js';
import { agentsRoutes } from './routes/agents.js';
import { experiencesRoutes } from './routes/experiences.js';
import { policyRoutes } from './routes/policy.js';
import { roleMappingsRoutes } from './routes/role-mappings.js';
import { auditRoutes } from './routes/audit.js';
import { usageRoutes } from './routes/usage.js';
import { tenantsRoutes } from './routes/tenants.js';
import { streamRoutes } from './routes/stream.js';
import { openapiRoutes } from './routes/openapi.js';
import { logger } from './logger.js';
import type { EmbeddingProvider } from './embeddings/provider.js';
import { makeOpaClient, type OpaClient } from './policy/opa-client.js';

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
   * Optional embedding provider for semantic capability search
   * (slice SEM-A / ADR-038). When unset, the server runs without
   * embedding generation; the search endpoint returns 422
   * "embeddings not configured" but every other route works
   * unchanged. Capabilities created while the provider is `noop`
   * have NULL embeddings; the backfill CLI fills them in once
   * the provider is configured.
   */
  readonly embeddings?: EmbeddingProvider;
  /**
   * Optional OPA client for the policy decision endpoint
   * (slice OPA-A / ADR-040). When unset, /policy/decide returns
   * 422 "not configured." Bundle CRUD endpoints work regardless —
   * adopters can stage rego while waiting on the OPA sidecar.
   */
  readonly opa?: OpaClient;
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
  // Per-verb RBAC: writes under a tenant require a writer role (reads stay
  // open to any authenticated member). Closes the "any member can mutate
  // governance entries" gap. In AUTH_MODE=disabled the synthetic principal is
  // platform-admin, so demo/trusted-network deployments are unaffected.
  v1.use('/catalogs/:tenant/*', requireWriteAccess(writerRolesFromEnv()));
  // Policy enforcement: when OPA is configured, governance writes are gated by
  // an OPA decision (fine-grained rules on top of RBAC). No-ops when unset.
  v1.use('/catalogs/:tenant/*', requirePolicyDecision(deps.opa ?? makeOpaClient(null), 'catalog/allow'));
  v1.route('/catalogs/:tenant/capabilities', capabilitiesRoutes(deps.pool, deps.embeddings));
  v1.route('/catalogs/:tenant/mfes', mfesRoutes(deps.pool));
  v1.route('/catalogs/:tenant/agents', agentsRoutes(deps.pool));
  v1.route('/catalogs/:tenant/experiences', experiencesRoutes(deps.pool));
  v1.route('/catalogs/:tenant/policy', policyRoutes(deps.pool, deps.opa ?? makeOpaClient(null)));
  v1.route('/catalogs/:tenant/role-mappings', roleMappingsRoutes(deps.pool));
  v1.route('/catalogs/:tenant/audit', auditRoutes(deps.pool));
  v1.route('/catalogs/:tenant/usage', usageRoutes(deps.pool));
  v1.route('/catalogs/:tenant/stream', streamRoutes());
  app.route('/v1', v1);

  return app;
}
