import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose';
import type { Principal } from '../domain/principal.js';

export interface JwtVerifierConfig {
  /**
   * The OIDC issuer URL. Used to (a) build the JWKS URI by appending
   * `/.well-known/jwks.json` (override via `jwksUri` if your provider
   * uses a non-standard path), (b) check the `iss` claim on every
   * incoming token.
   */
  readonly issuer: string;

  /**
   * Override the JWKS URI. Default: `${issuer}/.well-known/jwks.json`.
   * Useful for providers that publish JWKS at a non-standard path
   * (Auth0 uses `${issuer}/.well-known/jwks.json` natively, but
   * AWS Cognito uses `${issuer}/.well-known/jwks.json` too — most
   * providers conform).
   */
  readonly jwksUri?: string;

  /**
   * Required `aud` claim. Tokens that don't include this audience
   * are rejected. Required because most attacks against JWT auth
   * exploit unscoped audience checks.
   */
  readonly audience: string;

  /**
   * Custom JWT claim that carries the tenant identifier. Most IdPs
   * support custom claims (Auth0 rules, Keycloak attribute mappers,
   * Azure AD app roles). Default: `'tenant_id'`.
   */
  readonly tenantClaim?: string;

  /**
   * Custom JWT claim that carries the role list. Default: `'roles'`.
   */
  readonly rolesClaim?: string;
}

/**
 * Stateful JWT verifier — caches a JWKS reference (which itself
 * caches signing keys with a 10-minute TTL by default in `jose`).
 * Construct once at server startup; reuse for every request.
 */
export class JwtVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly options: JWTVerifyOptions;
  private readonly tenantClaim: string;
  private readonly rolesClaim: string;
  private readonly issuer: string;

  constructor(config: JwtVerifierConfig) {
    const jwksUri = config.jwksUri ?? `${config.issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
    this.jwks = createRemoteJWKSet(new URL(jwksUri), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60 * 1000, // 10 min — picks up key rotations within 10 min
    });
    this.options = {
      issuer: config.issuer,
      audience: config.audience,
      // Reject tokens with extreme clock skew. 60s is the conventional
      // tolerance — covers occasional NTP drift without giving an
      // attacker meaningful replay window.
      clockTolerance: 60,
    };
    this.tenantClaim = config.tenantClaim ?? 'tenant_id';
    this.rolesClaim = config.rolesClaim ?? 'roles';
    this.issuer = config.issuer;
  }

  /**
   * Verify a Bearer token + extract the principal. Throws on any
   * failure: missing claim, invalid signature, expired, wrong issuer,
   * wrong audience.
   */
  async verify(token: string): Promise<Principal> {
    const { payload } = await jwtVerify(token, this.jwks, this.options);
    return this.payloadToPrincipal(payload);
  }

  private payloadToPrincipal(payload: JWTPayload): Principal {
    const subject = typeof payload.sub === 'string' ? payload.sub : '';
    if (!subject) {
      throw new Error('JWT missing required `sub` claim');
    }

    const tenantId = readStringClaim(payload, this.tenantClaim);
    if (!tenantId) {
      throw new Error(`JWT missing required tenant claim "${this.tenantClaim}"`);
    }

    const displayNameClaim = readStringClaim(payload, 'name')
      ?? readStringClaim(payload, 'preferred_username')
      ?? subject;

    const rolesValue = (payload as Record<string, unknown>)[this.rolesClaim];
    const roles: string[] = Array.isArray(rolesValue)
      ? rolesValue.filter((r): r is string => typeof r === 'string')
      : [];

    return {
      subject,
      tenantId,
      displayName: displayNameClaim,
      roles,
      issuer: typeof payload.iss === 'string' ? payload.iss : this.issuer,
    };
  }
}

function readStringClaim(payload: JWTPayload, name: string): string | null {
  const v = (payload as Record<string, unknown>)[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
