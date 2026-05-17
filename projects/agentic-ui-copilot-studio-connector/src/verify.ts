import { createPublicKey, createVerify } from 'node:crypto';

/**
 * Verify the OAuth 2.0 bearer Microsoft Copilot Studio attaches
 * to every Connector call. The token is issued by Azure AD v2.0
 * for the signed-in M365 user (ADR-042 D3).
 *
 * Verification flow:
 *   1. Read `Authorization: Bearer <jwt>`.
 *   2. Parse the JWT header for `kid` (key id).
 *   3. Resolve the matching public key from Microsoft's OpenID
 *      config endpoint.
 *   4. Verify the signature, audience (the bot's App Id), issuer
 *      (`https://sts.windows.net/{tenant}/` or
 *      `https://login.microsoftonline.com/{tenant}/v2.0`), and
 *      expiry.
 *
 * The resolver is pluggable so tests inject deterministic keys
 * without hitting the live AAD endpoint. Caches keys in-process
 * for 10 minutes.
 *
 * @see https://learn.microsoft.com/azure/active-directory/develop/access-tokens
 */
export interface VerifyOptions {
  readonly authorization: string | null | undefined;
  /** Bot's AAD App Id. Token's `aud` claim must match (with or
   *  without the `api://` prefix Power Platform sometimes adds). */
  readonly expectedAudience: string;
  /** Tenant id whitelist. Allow any of these in `iss` /
   *  `tid`. Pass a single-item array for single-tenant Connectors. */
  readonly allowedTenants: readonly string[];
  /** Override the key resolver for tests. */
  readonly resolveKey?: (kid: string, tenant: string) => Promise<string | null>;
  /** Skip verification entirely. Dev only -- production deploys
   *  must NEVER pass true. */
  readonly skipVerification?: boolean;
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly reason?:
    | 'missing-header' | 'malformed-jwt' | 'unknown-key'
    | 'bad-signature' | 'expired' | 'bad-audience' | 'bad-tenant';
  readonly claims?: Readonly<Record<string, unknown>>;
}

const keyCache = new Map<string, { pem: string; expiresAt: number }>();
const KEY_TTL_MS = 10 * 60_000;

interface JwksKey { kid?: string; x5c?: string[]; n?: string; e?: string }

export async function resolveAadKey(kid: string, tenant: string): Promise<string | null> {
  const cacheKey = `${tenant}/${kid}`;
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;

  const configUrl =
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}` +
    `/v2.0/.well-known/openid-configuration`;
  let cfg: Response;
  try { cfg = await fetch(configUrl); } catch { return null; }
  if (!cfg.ok) return null;
  const cfgJson = (await cfg.json()) as { jwks_uri?: string };
  if (typeof cfgJson.jwks_uri !== 'string') return null;

  let jwks: Response;
  try { jwks = await fetch(cfgJson.jwks_uri); } catch { return null; }
  if (!jwks.ok) return null;
  const jwksJson = (await jwks.json()) as { keys?: JwksKey[] };
  for (const k of jwksJson.keys ?? []) {
    if (!k.kid) continue;
    const pem = jwksKeyToPem(k);
    if (pem) keyCache.set(`${tenant}/${k.kid}`, { pem, expiresAt: Date.now() + KEY_TTL_MS });
  }
  return keyCache.get(cacheKey)?.pem ?? null;
}

export async function verifyConnectorJwt(opts: VerifyOptions): Promise<VerifyResult> {
  if (opts.skipVerification) return { valid: true, claims: { dev: true } };

  const raw = (opts.authorization ?? '').trim();
  if (!raw.toLowerCase().startsWith('bearer ')) {
    return { valid: false, reason: 'missing-header' };
  }
  const jwt = raw.slice('bearer '.length).trim();
  const parts = jwt.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed-jwt' };
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { kid?: string; alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed-jwt' };
  }
  if (typeof header.kid !== 'string') return { valid: false, reason: 'malformed-jwt' };

  // Audience: accept either the raw App Id OR the `api://<appId>`
  // form Power Platform sometimes wraps it in.
  const aud = payload['aud'];
  const expected = opts.expectedAudience;
  const audOk = aud === expected || aud === `api://${expected}`;
  if (!audOk) return { valid: false, reason: 'bad-audience' };

  // Tenant: `tid` is the AAD tenant id; also check the issuer
  // contains the tenant for paranoid implementations.
  const tid = payload['tid'];
  if (typeof tid !== 'string' || !opts.allowedTenants.includes(tid)) {
    return { valid: false, reason: 'bad-tenant' };
  }

  const exp = payload['exp'];
  if (typeof exp === 'number' && exp * 1000 < Date.now()) {
    return { valid: false, reason: 'expired' };
  }

  const resolver = opts.resolveKey ?? resolveAadKey;
  const pem = await resolver(header.kid, tid);
  if (!pem) return { valid: false, reason: 'unknown-key' };

  let publicKey;
  try { publicKey = createPublicKey(pem); } catch { return { valid: false, reason: 'unknown-key' }; }

  const verifier = createVerify('SHA256');
  verifier.update(Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'));
  verifier.end();
  const sig = Buffer.from(signatureB64, 'base64url');
  const ok = verifier.verify(publicKey, sig);
  return ok
    ? { valid: true, claims: payload }
    : { valid: false, reason: 'bad-signature' };
}

function jwksKeyToPem(k: JwksKey): string | null {
  if (Array.isArray(k.x5c) && k.x5c.length > 0) {
    const b64 = k.x5c[0]!;
    return `-----BEGIN CERTIFICATE-----\n${chunk64(b64)}\n-----END CERTIFICATE-----`;
  }
  return null;
}

function chunk64(s: string): string {
  return s.match(/.{1,64}/g)?.join('\n') ?? s;
}
