import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateKeyPair, SignJWT, exportJWK, type KeyLike } from 'jose';
import { JwtVerifier } from './jwt.js';

/**
 * Stand up a tiny HTTP server that publishes a JWKS document. Lets
 * `JwtVerifier` resolve keys via `createRemoteJWKSet` exactly like
 * it would against a real OIDC provider — no mocking of jose itself.
 */
async function startJwksServer(jwk: object, port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('JWKS server failed to bind');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const ISSUER_PATH = ''; // we'll set issuer = JWKS server origin

describe('JwtVerifier', () => {
  let privateKey: KeyLike;
  let publicJwk: object;
  let jwksServer: { url: string; close: () => Promise<void> };
  let issuer: string;

  beforeAll(async () => {
    const { privateKey: priv, publicKey: pub } = await generateKeyPair('RS256');
    privateKey = priv;
    const jwk = await exportJWK(pub);
    jwk.kid = 'test-key-1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    publicJwk = jwk;
    jwksServer = await startJwksServer(publicJwk);
    issuer = jwksServer.url;
  });

  afterAll(async () => {
    await jwksServer.close();
  });

  async function mintToken(claims: Record<string, unknown> = {}, options: { aud?: string; iss?: string; expIn?: string } = {}): Promise<string> {
    return await new SignJWT({
      tenant_id: 'tenant-acme',
      roles: ['member'],
      name: 'Alice Example',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setSubject('user-001')
      .setIssuer(options.iss ?? issuer)
      .setAudience(options.aud ?? 'agentic-catalog')
      .setIssuedAt()
      .setExpirationTime(options.expIn ?? '1h')
      .sign(privateKey);
  }

  it('verifies a valid token + extracts the principal', async () => {
    const verifier = new JwtVerifier({
      issuer,
      audience: 'agentic-catalog',
    });
    const token = await mintToken();
    const principal = await verifier.verify(token);
    expect(principal.subject).toBe('user-001');
    expect(principal.tenantId).toBe('tenant-acme');
    expect(principal.roles).toEqual(['member']);
    expect(principal.displayName).toBe('Alice Example');
    expect(principal.issuer).toBe(issuer);
  });

  it('rejects a token with the wrong audience', async () => {
    const verifier = new JwtVerifier({ issuer, audience: 'agentic-catalog' });
    const token = await mintToken({}, { aud: 'wrong-audience' });
    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it('rejects a token with the wrong issuer', async () => {
    const verifier = new JwtVerifier({ issuer, audience: 'agentic-catalog' });
    const token = await mintToken({}, { iss: 'https://attacker.example.com' });
    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it('rejects a token without the required tenant claim', async () => {
    const verifier = new JwtVerifier({ issuer, audience: 'agentic-catalog' });
    // Mint a token explicitly omitting tenant_id.
    const token = await new SignJWT({ roles: ['member'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setSubject('u')
      .setIssuer(issuer)
      .setAudience('agentic-catalog')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    await expect(verifier.verify(token)).rejects.toThrow(/tenant claim/);
  });

  it('honours custom tenantClaim + rolesClaim names', async () => {
    const verifier = new JwtVerifier({
      issuer,
      audience: 'agentic-catalog',
      tenantClaim: 'org_id',
      rolesClaim: 'permissions',
    });
    const token = await mintToken({
      tenant_id: undefined,  // standard claim absent
      org_id: 'tenant-zeta',
      roles: undefined,
      permissions: ['read', 'write'],
    });
    const principal = await verifier.verify(token);
    expect(principal.tenantId).toBe('tenant-zeta');
    expect(principal.roles).toEqual(['read', 'write']);
  });

  it('rejects a token with no roles claim → empty array', async () => {
    const verifier = new JwtVerifier({ issuer, audience: 'agentic-catalog' });
    const token = await new SignJWT({ tenant_id: 'tenant-acme' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setSubject('u')
      .setIssuer(issuer)
      .setAudience('agentic-catalog')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    const principal = await verifier.verify(token);
    expect(principal.roles).toEqual([]);
  });

  it('rejects expired tokens (clock tolerance applies)', async () => {
    const verifier = new JwtVerifier({ issuer, audience: 'agentic-catalog' });
    // Sign a token that expired 5 minutes ago — beyond the 60s tolerance.
    const token = await new SignJWT({ tenant_id: 'tenant-acme' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setSubject('u')
      .setIssuer(issuer)
      .setAudience('agentic-catalog')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(privateKey);
    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it('falls back to preferred_username when name is absent', async () => {
    const verifier = new JwtVerifier({ issuer, audience: 'agentic-catalog' });
    const token = await mintToken({
      name: undefined,
      preferred_username: 'alice@acme',
    });
    const principal = await verifier.verify(token);
    expect(principal.displayName).toBe('alice@acme');
  });

  it('falls back to subject when no display name claims are present', async () => {
    const verifier = new JwtVerifier({ issuer, audience: 'agentic-catalog' });
    const token = await mintToken({
      name: undefined,
      preferred_username: undefined,
    });
    const principal = await verifier.verify(token);
    expect(principal.displayName).toBe('user-001');
  });
});
