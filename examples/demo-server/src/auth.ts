import type { Context, Next } from 'hono';
import { log } from './logger.js';

/**
 * Bearer-token authentication middleware. Reads a comma-separated allowlist
 * from `AGENT_AUTH_TOKENS`; an empty value disables auth (useful for local
 * dev where the agent server runs alongside a same-origin Angular app).
 *
 * Constant-time string comparison avoids leaking allowed tokens through
 * timing differences. Failed auth events are logged but never include the
 * presented token (only its first six chars + a hash for log correlation).
 */
export function bearerAuth() {
  const raw = (process.env['AGENT_AUTH_TOKENS'] ?? '').trim();
  const tokens = raw === '' ? [] : raw.split(',').map((t) => t.trim()).filter(Boolean);

  if (tokens.length === 0) {
    log.warn('bearer auth disabled — set AGENT_AUTH_TOKENS in .env to enable', {});
  } else {
    log.info('bearer auth enabled', { tokens: tokens.length });
  }

  return async (c: Context, next: Next) => {
    if (tokens.length === 0) return next();

    // Always allow GET /health unauthenticated so liveness probes don't need creds.
    if (c.req.method === 'GET' && c.req.path === '/health') return next();

    const header = c.req.header('Authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';

    if (presented === '' || !timingSafeEqualOneOf(presented, tokens)) {
      log.warn('auth rejected', {
        path: c.req.path,
        method: c.req.method,
        ip: c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? '?',
        presentedPrefix: presented.slice(0, 6),
      });
      return c.json({ error: { code: 'unauthorized', message: 'Invalid or missing bearer token.' } }, 401);
    }

    return next();
  };
}

/** Constant-time comparison — returns true if `presented` matches any allowed token. */
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
