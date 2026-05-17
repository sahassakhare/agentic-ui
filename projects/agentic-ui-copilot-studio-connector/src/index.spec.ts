import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildConnectorManifest,
  readConnectorIdentity,
  verifyConnectorJwt,
  zodToOpenApi,
} from './index.js';
import { createSign, generateKeyPairSync } from 'node:crypto';

describe('zodToOpenApi', () => {
  it('translates primitive types', () => {
    expect(zodToOpenApi(z.string())).toEqual({ type: 'string' });
    expect(zodToOpenApi(z.number())).toEqual({ type: 'number' });
    expect(zodToOpenApi(z.boolean())).toEqual({ type: 'boolean' });
  });

  it('captures length / range refinements', () => {
    const out = zodToOpenApi(z.string().min(2).max(80));
    expect(out).toMatchObject({ type: 'string', minLength: 2, maxLength: 80 });
  });

  it('maps string formats (email / url / uuid)', () => {
    expect(zodToOpenApi(z.string().email())).toMatchObject({ format: 'email' });
    expect(zodToOpenApi(z.string().url())).toMatchObject({ format: 'uri' });
    expect(zodToOpenApi(z.string().uuid())).toMatchObject({ format: 'uuid' });
  });

  it('maps integer + min/max on numbers', () => {
    const out = zodToOpenApi(z.number().int().min(1).max(500));
    expect(out).toMatchObject({ type: 'integer', minimum: 1, maximum: 500 });
  });

  it('translates enums', () => {
    const out = zodToOpenApi(z.enum(['draft', 'published', 'archived']));
    expect(out.type).toBe('string');
    expect(out.enum).toContain('draft');
    expect(out.enum).toContain('published');
  });

  it('translates arrays', () => {
    const out = zodToOpenApi(z.array(z.string()));
    expect(out).toMatchObject({ type: 'array', items: { type: 'string' } });
  });

  it('translates objects with required + optional fields', () => {
    const out = zodToOpenApi(
      z.object({
        name: z.string(),
        age: z.number().optional(),
        flag: z.boolean(),
      }),
    );
    expect(out.type).toBe('object');
    expect(out.properties?.['name']).toEqual({ type: 'string' });
    expect(out.required).toContain('name');
    expect(out.required).toContain('flag');
    expect(out.required).not.toContain('age');
  });

  it('respects describe() for description', () => {
    const out = zodToOpenApi(z.string().describe('Custodian email'));
    expect(out.description).toBe('Custodian email');
  });

  it('preserves nullable + default', () => {
    expect(zodToOpenApi(z.string().nullable())).toMatchObject({ nullable: true });
    expect(zodToOpenApi(z.string().default('x'))).toMatchObject({ default: 'x' });
  });

  it('falls back permissively on unsupported types', () => {
    const warnings: string[] = [];
    const out = zodToOpenApi(z.union([z.string(), z.number()]), {
      onUnsupported: (type) => warnings.push(type),
    });
    expect(out).toEqual({ additionalProperties: true });
    expect(warnings).toContain('ZodUnion');
  });
});

describe('buildConnectorManifest', () => {
  const manifest = buildConnectorManifest({
    title: 'Maverick eDiscovery',
    description: 'Catalog tools exposed to M365 Copilot.',
    version: '1.0.0',
    host: 'agent.example.com',
    aadAppId: 'app-id-1',
    aadTenantId: 'tenant-1',
    tools: [
      {
        name: 'placeLegalHold',
        description: 'Issue a hold.',
        schema: z.object({
          custodianIds: z.array(z.string()).min(1),
          scope: z.string().min(10),
        }),
      },
      {
        name: 'addCustodian',
        description: 'Add a custodian to the matter.',
        schema: z.object({
          name: z.string(),
          email: z.string().email(),
          department: z.string(),
        }),
        summary: 'Onboard custodian',
      },
    ],
  });

  it('emits swagger 2.0 + the right info block', () => {
    expect(manifest.swagger).toBe('2.0');
    expect(manifest.info.title).toBe('Maverick eDiscovery');
    expect(manifest.info.version).toBe('1.0.0');
    expect(manifest.host).toBe('agent.example.com');
  });

  it('declares OAuth2 with the AAD endpoints', () => {
    const sec = manifest.securityDefinitions['oauth2_auth'] as {
      authorizationUrl: string;
      tokenUrl: string;
    };
    expect(sec.authorizationUrl).toContain('tenant-1');
    expect(sec.tokenUrl).toContain('tenant-1');
    expect(manifest.security).toEqual([{ oauth2_auth: ['api://app-id-1/.default'] }]);
  });

  it('emits one POST path per tool with the OpenAPI schema as the body', () => {
    const placeHold = manifest.paths['/actions/placeLegalHold'] as {
      post: { parameters: Array<{ schema: { properties?: Record<string, { type?: string }> } }>; summary: string };
    };
    expect(placeHold.post.summary).toBe('Place legal hold');
    const schema = placeHold.post.parameters[0]?.schema;
    expect(schema?.properties?.['custodianIds']?.type).toBe('array');
    expect(schema?.properties?.['scope']?.type).toBe('string');
  });

  it('uses the supplied summary when provided', () => {
    const add = manifest.paths['/actions/addCustodian'] as { post: { summary: string } };
    expect(add.post.summary).toBe('Onboard custodian');
  });

  it('wires the agreed ConnectorActionResult response shape', () => {
    const placeHold = manifest.paths['/actions/placeLegalHold'] as {
      post: { responses: { '200': { schema: { properties: Record<string, unknown> } } } };
    };
    const ok = placeHold.post.responses['200'].schema.properties;
    expect(ok['message']).toBeTruthy();
    expect(ok['adaptiveCard']).toBeTruthy();
    expect(ok['data']).toBeTruthy();
  });

  it('falls back to additionalProperties:true for hand-written OpenAPI fragments', () => {
    const handWritten = buildConnectorManifest({
      title: 't', description: 'd', version: '1.0.0', host: 'h',
      aadAppId: 'a',
      tools: [{
        name: 'rawTool',
        description: 'raw',
        schema: { type: 'object', properties: { x: { type: 'string' } } },
      }],
    });
    const raw = handWritten.paths['/actions/rawTool'] as {
      post: { parameters: Array<{ schema: { properties?: Record<string, { type?: string }> } }> };
    };
    expect(raw.post.parameters[0]?.schema.properties?.['x']?.type).toBe('string');
  });
});

describe('readConnectorIdentity', () => {
  it('maps the standard AAD claim names', () => {
    const id = readConnectorIdentity({
      tid: 'tn-1',
      oid: 'oid-1',
      preferred_username: 'alice@contoso.com',
      roles: ['lead-counsel', 'associate'],
      groups: ['g1', 'g2'],
    });
    expect(id.tenantId).toBe('tn-1');
    expect(id.userObjectId).toBe('oid-1');
    expect(id.userPrincipalName).toBe('alice@contoso.com');
    expect(id.roles).toEqual(['lead-counsel', 'associate']);
    expect(id.groups).toEqual(['g1', 'g2']);
  });

  it('falls back to upn when preferred_username is absent', () => {
    const id = readConnectorIdentity({ tid: 't', oid: 'o', upn: 'bob@contoso.com' });
    expect(id.userPrincipalName).toBe('bob@contoso.com');
  });

  it('uses empty defaults for missing fields', () => {
    const id = readConnectorIdentity({});
    expect(id.tenantId).toBe('');
    expect(id.userObjectId).toBe('');
    expect(id.userPrincipalName).toBeNull();
    expect(id.roles).toEqual([]);
    expect(id.groups).toEqual([]);
  });
});

describe('verifyConnectorJwt', () => {
  it('rejects missing Authorization header', async () => {
    const r = await verifyConnectorJwt({
      authorization: null,
      expectedAudience: 'app-1',
      allowedTenants: ['tn-1'],
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('missing-header');
  });

  it('accepts skipVerification (dev only)', async () => {
    const r = await verifyConnectorJwt({
      authorization: null,
      expectedAudience: 'app-1',
      allowedTenants: ['tn-1'],
      skipVerification: true,
    });
    expect(r.valid).toBe(true);
  });

  it('checks the audience claim', async () => {
    const wrong = makeJwt({
      aud: 'wrong-app',
      tid: 'tn-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyConnectorJwt({
      authorization: `Bearer ${wrong.token}`,
      expectedAudience: 'app-1',
      allowedTenants: ['tn-1'],
      resolveKey: async () => wrong.publicPem,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad-audience');
  });

  it("accepts api:// audience wrap", async () => {
    const wrapped = makeJwt({
      aud: 'api://app-1',
      tid: 'tn-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyConnectorJwt({
      authorization: `Bearer ${wrapped.token}`,
      expectedAudience: 'app-1',
      allowedTenants: ['tn-1'],
      resolveKey: async () => wrapped.publicPem,
    });
    expect(r.valid).toBe(true);
  });

  it('rejects when tenant is not whitelisted', async () => {
    const fresh = makeJwt({
      aud: 'app-1',
      tid: 'attacker-tenant',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyConnectorJwt({
      authorization: `Bearer ${fresh.token}`,
      expectedAudience: 'app-1',
      allowedTenants: ['tn-1'],
      resolveKey: async () => fresh.publicPem,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad-tenant');
  });

  it('rejects expired tokens', async () => {
    const exp = makeJwt({
      aud: 'app-1',
      tid: 'tn-1',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const r = await verifyConnectorJwt({
      authorization: `Bearer ${exp.token}`,
      expectedAudience: 'app-1',
      allowedTenants: ['tn-1'],
      resolveKey: async () => exp.publicPem,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('accepts a valid signature', async () => {
    const ok = makeJwt({
      aud: 'app-1',
      tid: 'tn-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyConnectorJwt({
      authorization: `Bearer ${ok.token}`,
      expectedAudience: 'app-1',
      allowedTenants: ['tn-1'],
      resolveKey: async () => ok.publicPem,
    });
    expect(r.valid).toBe(true);
    expect((r.claims as { aud: string }).aud).toBe('app-1');
  });
});

// ── helpers ────────────────────────────────────────────────────────

function makeJwt(payload: { aud: string; tid: string; exp: number }): {
  token: string;
  publicPem: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const header = { alg: 'RS256', typ: 'JWT', kid: 'kid-1' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signed = `${headerB64}.${payloadB64}`;
  const signer = createSign('SHA256');
  signer.update(signed);
  signer.end();
  const sig = signer.sign(privateKey);
  return { token: `${signed}.${sig.toString('base64url')}`, publicPem: publicKey };
}
