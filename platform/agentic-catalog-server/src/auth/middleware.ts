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
 * Extract the Bearer token, validate via {@link JwtVerifier}, and
 * attach the resolved {@link Principal} to the Hono context. Threads
 * downstream handlers via `c.get('principal')`.
 *
 * Failures convert to RFC 7807 problem+json (the global error handler
 * in `errors.ts` formats them).
 */
export function bearerAuth(verifier: JwtVerifier): MiddlewareHandler {
  return async (c, next) => {
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
