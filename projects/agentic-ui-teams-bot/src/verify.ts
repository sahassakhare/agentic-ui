import { createPublicKey, createVerify } from 'node:crypto';

/**
 * Verify the JWT bearer the Bot Framework attaches to every
 * inbound activity. Without this any caller on the public
 * Internet could spoof a Teams message and run the agent against
 * the catalog with an attacker-controlled identity.
 *
 * Verification flow:
 *   1. Read the Authorization header; require `Bearer <jwt>`.
 *   2. Parse the JWT header to extract `kid` (key id).
 *   3. Resolve the matching public key from the OpenID config
 *      Microsoft publishes for the Bot Connector
 *      (https://login.botframework.com/v1/.well-known/openidconfiguration).
 *   4. Verify the JWT signature, issuer, audience (the bot's
 *      App Id), and expiry.
 *
 * The resolver is pluggable so tests inject a deterministic key
 * without hitting the live OpenID endpoint. Caches keys in-process
 * for 10 minutes -- Microsoft rotates them occasionally.
 *
 * @see https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
 */
export interface VerifyOptions {
  /** Raw `Authorization` header value (`Bearer <jwt>` or null). */
  readonly authorization: string | null | undefined;
  /** Bot's AAD App Id -- the JWT's `aud` claim must equal this. */
  readonly expectedAudience: string;
  /** Resolver overrideable for tests. Default fetches from
   *  Microsoft's OpenID config. */
  readonly resolveKey?: (kid: string) => Promise<string | null>;
  /** Allow signature verification to be disabled (local dev only).
   *  Production servers must NEVER pass true here. */
  readonly skipVerification?: boolean;
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly reason?:
    | 'missing-header' | 'malformed-jwt' | 'unknown-key'
    | 'bad-signature' | 'expired' | 'bad-audience' | 'bad-issuer';
  readonly claims?: Readonly<Record<string, unknown>>;
}

const BOT_OPENID_CONFIG_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';
const VALID_ISSUERS = new Set([
  'https://api.botframework.com',
  'https://sts.windows.net/d6d49420-f39b-4df7-a1dc-d59a935871db/',
]);

const keyCache = new Map<string, { pem: string; expiresAt: number }>();
const KEY_TTL_MS = 10 * 60_000;

interface JwksKey { kid?: string; x5c?: string[]; n?: string; e?: string }

export async function resolveBotConnectorKey(kid: string): Promise<string | null> {
  const cached = keyCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;

  let cfg: Response;
  try {
    cfg = await fetch(BOT_OPENID_CONFIG_URL);
  } catch {
    return null;
  }
  if (!cfg.ok) return null;
  const cfgJson = (await cfg.json()) as { jwks_uri?: string };
  if (typeof cfgJson.jwks_uri !== 'string') return null;

  let jwks: Response;
  try {
    jwks = await fetch(cfgJson.jwks_uri);
  } catch {
    return null;
  }
  if (!jwks.ok) return null;
  const jwksJson = (await jwks.json()) as { keys?: JwksKey[] };
  for (const k of jwksJson.keys ?? []) {
    if (!k.kid) continue;
    const pem = jwksKeyToPem(k);
    if (pem) keyCache.set(k.kid, { pem, expiresAt: Date.now() + KEY_TTL_MS });
  }
  return keyCache.get(kid)?.pem ?? null;
}

export async function verifyBotJwt(opts: VerifyOptions): Promise<VerifyResult> {
  if (opts.skipVerification) {
    return { valid: true, claims: { dev: true } };
  }
  const raw = (opts.authorization ?? '').trim();
  if (!raw.toLowerCase().startsWith('bearer ')) {
    return { valid: false, reason: 'missing-header' };
  }
  const jwt = raw.slice('bearer '.length).trim();
  const parts = jwt.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed-jwt' };
  const headerB64 = parts[0]!;
  const payloadB64 = parts[1]!;
  const signatureB64 = parts[2]!;
  let header: { kid?: string; alg?: string };
  let payload: { aud?: unknown; iss?: unknown; exp?: unknown; [k: string]: unknown };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed-jwt' };
  }
  if (typeof header.kid !== 'string') return { valid: false, reason: 'malformed-jwt' };
  if (payload.aud !== opts.expectedAudience) return { valid: false, reason: 'bad-audience' };
  if (typeof payload.iss !== 'string' || !VALID_ISSUERS.has(payload.iss)) {
    return { valid: false, reason: 'bad-issuer' };
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return { valid: false, reason: 'expired' };
  }

  const resolver = opts.resolveKey ?? resolveBotConnectorKey;
  const pem = await resolver(header.kid);
  if (!pem) return { valid: false, reason: 'unknown-key' };

  const signedInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = Buffer.from(signatureB64, 'base64url');
  let publicKey;
  try {
    publicKey = createPublicKey(pem);
  } catch {
    return { valid: false, reason: 'unknown-key' };
  }
  const algo = (header.alg ?? 'RS256').toUpperCase();
  const verifier = createVerify(algo === 'RS256' ? 'SHA256' : 'SHA256');
  verifier.update(signedInput);
  verifier.end();
  const ok = verifier.verify(publicKey, signature);
  return ok
    ? { valid: true, claims: payload as Record<string, unknown> }
    : { valid: false, reason: 'bad-signature' };
}

function jwksKeyToPem(k: JwksKey): string | null {
  // Prefer the x5c chain when available -- it's a base64-encoded
  // DER certificate that we can wrap in PEM markers directly. The
  // n/e modulus+exponent fallback is left unimplemented; Microsoft
  // currently always ships x5c for the Bot Connector.
  if (Array.isArray(k.x5c) && k.x5c.length > 0) {
    const b64 = k.x5c[0]!;
    return `-----BEGIN CERTIFICATE-----\n${chunk64(b64)}\n-----END CERTIFICATE-----`;
  }
  return null;
}

function chunk64(s: string): string {
  return s.match(/.{1,64}/g)?.join('\n') ?? s;
}
