import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { JwtVerifier } from './jwt.js';
import { isPlatformAdmin, type Principal } from '../domain/principal.js';

declare module 'hono' {
  interface ContextVariableMap {
    principal: Principal;
  }
}

/**
 * Synthetic principal used when AUTH_MODE=disabled. Always platform-
 * admin so the privilege guards in the route handlers admit every
 * request. Tenant id is filled in per-request from the URL path
 * (`:tenant` param) or falls back to a sentinel for platform routes
 * that don't have one. `subject` carries the literal `'anonymous'`
 * so the audit trail records the trust boundary that produced the
 * write — anyone reviewing the audit later can spot that the row
 * came from a trusted-network deployment.
 */
const ANONYMOUS_PLATFORM_TENANT = '_anonymous';

const PATH_TENANT_RE = /^\/v1\/catalogs\/([^/]+)(?:\/|$)/;
function extractPathTenant(path: string): string | undefined {
  const m = PATH_TENANT_RE.exec(path);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

function anonymousPrincipal(tenantId: string | undefined): Principal {
  return {
    subject: 'anonymous',
    tenantId: tenantId || ANONYMOUS_PLATFORM_TENANT,
    roles: ['platform-admin'],
    displayName: 'anonymous (auth disabled)',
    issuer: 'auth-disabled',
  };
}

export interface BearerAuthOptions {
  /** When true, the middleware skips JWT verification entirely. */
  readonly disabled?: boolean;
}

/**
 * Extract the Bearer token, validate via {@link JwtVerifier}, and
 * attach the resolved {@link Principal} to the Hono context. Threads
 * downstream handlers via `c.get('principal')`.
 *
 * When `disabled: true` is set, the middleware skips token verification
 * entirely and synthesises a platform-admin principal scoped to the
 * URL path's `:tenant` parameter (or `_anonymous` for platform routes).
 * **Demo / trusted-network only** — see ADR-022.
 *
 * Failures convert to RFC 7807 problem+json (the global error handler
 * in `errors.ts` formats them).
 */
export function bearerAuth(
  verifier: JwtVerifier | null,
  options: BearerAuthOptions = {},
): MiddlewareHandler {
  return async (c, next) => {
    if (options.disabled) {
      // Tenant comes from the URL path. We parse the path string
      // directly because route params (`c.req.param('tenant')`) are
      // only bound AFTER the route handler matches — bearerAuth runs
      // before that.
      c.set('principal', anonymousPrincipal(extractPathTenant(c.req.path)));
      await next();
      return;
    }

    if (!verifier) {
      throw new HTTPException(500, {
        message: 'bearerAuth misconfigured — verifier required when not disabled',
      });
    }

    const header = c.req.header('Authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new HTTPException(401, {
        message: 'Missing or malformed Authorization header (expected `Bearer <jwt>`)',
      });
    }
    const token = header.slice('bearer '.length).trim();
    if (!token) {
      throw new HTTPException(401, { message: 'Empty Bearer token' });
    }
    let principal: Principal;
    try {
      principal = await verifier.verify(token);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'token verification failed';
      throw new HTTPException(401, { message: `Token rejected: ${detail}` });
    }
    c.set('principal', principal);
    await next();
  };
}

/**
 * Tenant-scope guard: ensures the path's `:tenant` parameter matches
 * the principal's `tenantId` claim. Platform admins (`platform-admin`
 * role) bypass this check — they may operate cross-tenant.
 *
 * Use AFTER `bearerAuth` in the middleware chain.
 */
export function requireTenantScope(): MiddlewareHandler {
  return async (c: Context, next) => {
    const principal = c.get('principal');
    if (!principal) {
      throw new HTTPException(500, {
        message: 'requireTenantScope used without bearerAuth ahead of it',
      });
    }
    const pathTenant = c.req.param('tenant');
    if (!pathTenant) {
      throw new HTTPException(500, {
        message: 'requireTenantScope used on a route without :tenant param',
      });
    }
    if (pathTenant !== principal.tenantId && !isPlatformAdmin(principal)) {
      throw new HTTPException(403, {
        message: `Tenant scope mismatch: token issued for tenant "${principal.tenantId}", path requested "${pathTenant}"`,
      });
    }
    await next();
  };
}
