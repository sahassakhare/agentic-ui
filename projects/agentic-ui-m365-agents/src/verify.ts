import { createPublicKey, createVerify } from 'node:crypto';

/**
 * Verify the JWT bearer the M365 Agents service attaches to every
 * inbound activity. Without this any caller on the public Internet
 * could spoof a Teams / M365 Copilot message and run the agent
 * against the catalog with an attacker-controlled identity.
 *
 * The Agents service issues tokens from multiple channels:
 *   - Bot Connector (legacy Teams pre-SDK) — `iss: https://api.botframework.com`
 *   - AAD multi-tenant (Teams + M365 Copilot via SDK) — `iss: https://sts.windows.net/<tenant>/`
 *   - AAD v2.0 (newer Copilot tokens) — `iss: https://login.microsoftonline.com/<tenant>/v2.0`
 *
 * The audience is always the agent's AAD App Id. The key resolver
 * looks up the signing key via OpenID configuration for each
 * accepted issuer family; cached in-process for 10 minutes.
 *
 * @see https://learn.microsoft.com/microsoft-365/agents-sdk/api-reference/
 * @see https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
 */
export interface VerifyOptions {
  /** Raw `Authorization` header value (`Bearer <jwt>` or null). */
  readonly authorization: string | null | undefined;
  /** Agent's AAD App Id — the JWT's `aud` claim must equal this. */
  readonly expectedAudience: string;
  /**
   * Optional list of additional accepted issuer prefixes. Useful
   * for sovereign clouds (`https://sts.chinacloudapi.cn/`,
   * `https://sts.microsoftonline.de/`, `https://login.microsoftonline.us/`).
   */
  readonly additionalIssuerPrefixes?: readonly string[];
  /** Resolver overrideable for tests. */
  readonly resolveKey?: (kid: string, issuer: string) => Promise<string | null>;
  /** Allow signature verification to be disabled (local dev only). */
  readonly skipVerification?: boolean;
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly reason?:
    | 'missing-header' | 'malformed-jwt' | 'unknown-key'
    | 'bad-signature' | 'expired' | 'bad-audience' | 'bad-issuer';
  readonly claims?: Readonly<Record<string, unknown>>;
}

/**
 * Exact-match issuers (legacy Bot Connector + the AAD common-tenant
 * issuer). For tenanted AAD v2.0 issuers we match by *prefix* since
 * the tenant id is embedded in the path.
 */
const EXACT_ISSUERS = new Set([
  'https://api.botframework.com',
  // Microsoft's AAD common tenant for the Bot Connector
  // (predates the per-tenant v1.0/v2.0 endpoints).
  'https://sts.windows.net/d6d49420-f39b-4df7-a1dc-d59a935871db/',
]);

const ISSUER_PREFIXES: readonly string[] = [
  // AAD v1.0 — `https://sts.windows.net/<tenant>/`
  'https://sts.windows.net/',
  // AAD v2.0 — `https://login.microsoftonline.com/<tenant>/v2.0`
  'https://login.microsoftonline.com/',
];

const BOT_CONNECTOR_OPENID_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';
const AAD_V2_OPENID_URL =
  'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration';

const keyCache = new Map<string, { pem: string; expiresAt: number }>();
const KEY_TTL_MS = 10 * 60_000;

interface JwksKey { kid?: string; x5c?: string[]; n?: string; e?: string }

/**
 * Resolve a JWKS key by `kid`. Tries the issuer-matched discovery
 * endpoint first (Bot Connector for `iss=https://api.botframework.com`,
 * AAD v2.0 for `https://login.microsoftonline.com/...`), falls
 * through to the other if the first miss returns null. Both
 * endpoints' keys are cached together so a `kid` from either
 * channel is resolved on the first call after cache-miss.
 */
export async function resolveAgentSigningKey(kid: string, issuer: string): Promise<string | null> {
  const cached = keyCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;

  const order = isAadIssuer(issuer)
    ? [AAD_V2_OPENID_URL, BOT_CONNECTOR_OPENID_URL]
    : [BOT_CONNECTOR_OPENID_URL, AAD_V2_OPENID_URL];

  for (const cfgUrl of order) {
    await loadJwksFrom(cfgUrl);
    const hit = keyCache.get(kid);
    if (hit && hit.expiresAt > Date.now()) return hit.pem;
  }
  return null;
}

async function loadJwksFrom(cfgUrl: string): Promise<void> {
  let cfg: Response;
  try {
    cfg = await fetch(cfgUrl);
  } catch {
    return;
  }
  if (!cfg.ok) return;
  const cfgJson = (await cfg.json()) as { jwks_uri?: string };
  if (typeof cfgJson.jwks_uri !== 'string') return;

  let jwks: Response;
  try {
    jwks = await fetch(cfgJson.jwks_uri);
  } catch {
    return;
  }
  if (!jwks.ok) return;
  const jwksJson = (await jwks.json()) as { keys?: JwksKey[] };
  for (const k of jwksJson.keys ?? []) {
    if (!k.kid) continue;
    const pem = jwksKeyToPem(k);
    if (pem) keyCache.set(k.kid, { pem, expiresAt: Date.now() + KEY_TTL_MS });
  }
}

export async function verifyM365AgentJwt(opts: VerifyOptions): Promise<VerifyResult> {
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
  if (typeof payload.iss !== 'string' || !isAcceptableIssuer(payload.iss, opts.additionalIssuerPrefixes)) {
    return { valid: false, reason: 'bad-issuer' };
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return { valid: false, reason: 'expired' };
  }

  const resolver = opts.resolveKey ?? resolveAgentSigningKey;
  const pem = await resolver(header.kid, payload.iss);
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

function isAadIssuer(issuer: string): boolean {
  return ISSUER_PREFIXES.some((p) => issuer.startsWith(p));
}

function isAcceptableIssuer(issuer: string, extraPrefixes?: readonly string[]): boolean {
  if (EXACT_ISSUERS.has(issuer)) return true;
  for (const p of ISSUER_PREFIXES) if (issuer.startsWith(p)) return true;
  if (extraPrefixes) {
    for (const p of extraPrefixes) if (issuer.startsWith(p)) return true;
  }
  return false;
}

function jwksKeyToPem(k: JwksKey): string | null {
  // Prefer the x5c chain when available — a base64-encoded DER
  // certificate that we can wrap in PEM markers directly. Both the
  // Bot Connector and AAD JWKS ship `x5c` for every active key.
  if (Array.isArray(k.x5c) && k.x5c.length > 0) {
    const b64 = k.x5c[0]!;
    return `-----BEGIN CERTIFICATE-----\n${chunk64(b64)}\n-----END CERTIFICATE-----`;
  }
  return null;
}

function chunk64(s: string): string {
  return s.match(/.{1,64}/g)?.join('\n') ?? s;
}
