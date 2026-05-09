import { createServer, type Server } from 'node:http';
import { generateKeyPair, SignJWT, exportJWK, type KeyLike } from 'jose';
import { buildApp } from '../app.js';
import { createPgMemPool, type PgMemHandle } from './pg-mem-pool.js';

/**
 * Spin up a full integration harness for HTTP tests:
 * - in-memory Postgres seeded with the migration + a default tenant
 * - JWKS HTTP server publishing a signing key
 * - Hono app wired against both
 * - JWT minter so tests can produce tokens with arbitrary claims
 *
 * Built once per `describe` block; tear down in `afterAll`.
 */
export interface IntegrationHarness {
  /** Hono app's `fetch` — invoke with `Request` instances. */
  readonly fetch: (req: Request) => Promise<Response>;
  /** Direct DB pool access for setup / assertion. */
  readonly pool: PgMemHandle['pool'];
  /** Mint a JWT with the specified claims (defaults: subject=u-001, tenant=test-tenant, roles=[member]). */
  readonly mintToken: (claims?: Partial<TokenClaims>) => Promise<string>;
  /** Mint + format `Authorization: Bearer …` header value. */
  readonly authHeader: (claims?: Partial<TokenClaims>) => Promise<string>;
  /** Tear everything down. */
  readonly destroy: () => Promise<void>;
}

interface TokenClaims {
  readonly subject: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly displayName: string;
  readonly audience: string;
  readonly expiresIn: string;
}

const DEFAULT_TENANT = 'test-tenant';
const DEFAULT_AUDIENCE = 'agentic-catalog';

export async function buildIntegrationHarness(): Promise<IntegrationHarness> {
  const dbHandle = createPgMemPool({ seedTenantId: DEFAULT_TENANT });

  // JWKS server
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key-1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const jwksServer: Server = createServer((req, res) => {
    if (req.url === '/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r));
  const address = jwksServer.address();
  if (!address || typeof address === 'string') throw new Error('JWKS bind failed');
  const issuer = `http://127.0.0.1:${address.port}`;

  const app = buildApp({
    pool: dbHandle.pool,
    auth: {
      issuer,
      audience: DEFAULT_AUDIENCE,
    },
  });

  async function mintToken(claims: Partial<TokenClaims> = {}): Promise<string> {
    const subject = claims.subject ?? 'u-001';
    const tenantId = claims.tenantId ?? DEFAULT_TENANT;
    const roles = claims.roles ?? ['member'];
    const displayName = claims.displayName ?? 'Test User';
    const audience = claims.audience ?? DEFAULT_AUDIENCE;
    const expiresIn = claims.expiresIn ?? '1h';
    return await new SignJWT({
      tenant_id: tenantId,
      roles,
      name: displayName,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey as KeyLike);
  }

  return {
    fetch: (req) => app.fetch(req),
    pool: dbHandle.pool,
    mintToken,
    authHeader: async (claims) => `Bearer ${await mintToken(claims)}`,
    destroy: async () => {
      await new Promise<void>((r) => jwksServer.close(() => r()));
      await dbHandle.destroy();
    },
  };
}

/**
 * Harness for {@link AppDeps.authMode} `'disabled'`. No JWKS server,
 * no JWT minting — every request the test fires lands as a synthetic
 * platform-admin principal scoped to the URL path's tenant. Used to
 * verify the AUTH_MODE=disabled path that ships for the Render demo
 * blueprint (ADR-022).
 */
export interface DisabledAuthHarness {
  readonly fetch: (req: Request) => Promise<Response>;
  readonly pool: PgMemHandle['pool'];
  readonly destroy: () => Promise<void>;
}

export async function buildDisabledAuthHarness(): Promise<DisabledAuthHarness> {
  const dbHandle = createPgMemPool({ seedTenantId: DEFAULT_TENANT });
  const app = buildApp({
    pool: dbHandle.pool,
    authMode: 'disabled',
  });
  return {
    fetch: (req) => app.fetch(req),
    pool: dbHandle.pool,
    destroy: async () => { await dbHandle.destroy(); },
  };
}
