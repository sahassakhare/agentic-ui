import type { Context, Next } from 'hono';
import { log } from './logger.js';

/**
 * Bearer-token auth middleware. Reads `AGENT_AUTH_TOKENS` (comma-separated
 * allowlist); empty disables auth (dev-only). Constant-time comparison;
 * `/health` always allowed unauthenticated.
 *
 * @remarks
 * Real eDiscovery deployments need SSO / SAML / OAuth — this is a stub
 * for the demo. The ADR-006 production-grade boundary applies: auth
 * shapes are consumer-side; the library just provides the seam.
 */
export function bearerAuth() {
  const raw = (process.env['AGENT_AUTH_TOKENS'] ?? '').trim();
  const tokens = raw === '' ? [] : raw.split(',').map((t) => t.trim()).filter(Boolean);

  if (tokens.length === 0) {
    log.warn('bearer auth disabled — set AGENT_AUTH_TOKENS to enable');
  } else {
    log.info('bearer auth enabled', { tokenCount: tokens.length });
  }

  return async (c: Context, next: Next) => {
    if (tokens.length === 0) return next();
    if (c.req.method === 'GET' && c.req.path === '/health') return next();

    const header = c.req.header('Authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';

    if (presented === '' || !timingSafeEqualOneOf(presented, tokens)) {
      log.warn('auth rejected', {
        path: c.req.path,
        method: c.req.method,
        ip: c.req.header('x-forwarded-for') ?? '?',
      });
      return c.json({ error: { code: 'unauthorized', message: 'Invalid or missing bearer token.' } }, 401);
    }
    return next();
  };
}

function timingSafeEqualOneOf(presented: string, allowed: readonly string[]): boolean {
  let match = false;
  for (const candidate of allowed) {
    if (timingSafeEqual(presented, candidate)) match = true;
  }
  return match;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
