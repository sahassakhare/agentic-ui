import { describe, expect, it } from 'vitest';
import {
  asAttachment,
  errorCard,
  parseM365Activity,
  readM365AgentIdentity,
  verifyM365AgentJwt,
  welcomeCard,
  widgetFallbackCard,
} from './index.js';
import { createSign, generateKeyPairSync } from 'node:crypto';

describe('parseM365Activity', () => {
  const baseActivity = {
    type: 'message',
    id: 'act-1',
    serviceUrl: 'https://smba.trafficmanager.net/teams/',
    channelId: 'msteams',
    conversation: { id: 'conv-1', conversationType: 'personal', tenantId: 'tn-1' },
    from: { id: 'u-1', name: 'alice', aadObjectId: 'aad-1' },
    recipient: { id: 'b-1', name: 'agent' },
    text: 'hello',
    locale: 'en-US',
  };

  it('parses a well-formed message activity', () => {
    const a = parseM365Activity(baseActivity);
    expect(a).not.toBeNull();
    expect(a?.type).toBe('message');
    expect(a?.conversation.id).toBe('conv-1');
    expect(a?.channelId).toBe('msteams');
    expect(a?.from?.aadObjectId).toBe('aad-1');
  });

  it('returns null when required fields are missing', () => {
    expect(parseM365Activity(null)).toBeNull();
    expect(parseM365Activity('not-an-object')).toBeNull();
    expect(parseM365Activity({ type: 'message' })).toBeNull();
    expect(parseM365Activity({ type: 'message', serviceUrl: 'x' })).toBeNull();
    expect(parseM365Activity({ ...baseActivity, conversation: { } })).toBeNull();
  });

  it('preserves channelId for M365 Copilot channels', () => {
    const a = parseM365Activity({
      type: 'message',
      serviceUrl: 'https://copilot.example/',
      channelId: 'm365copilot',
      conversation: { id: 'c' },
    });
    expect(a?.channelId).toBe('m365copilot');
  });
});

describe('readM365AgentIdentity', () => {
  it('extracts the identity surface including channelId', () => {
    const a = parseM365Activity({
      type: 'message',
      serviceUrl: 'https://example/',
      channelId: 'm365copilot',
      conversation: { id: 'conv-1', conversationType: 'personal', tenantId: 'tn-9' },
      from: { id: 'u-1', name: 'alice', aadObjectId: 'aad-1' },
      locale: 'fr-FR',
    })!;
    const id = readM365AgentIdentity(a);
    expect(id).toEqual({
      userId: 'u-1',
      userName: 'alice',
      aadObjectId: 'aad-1',
      tenantId: 'tn-9',
      conversationId: 'conv-1',
      conversationType: 'personal',
      channelId: 'm365copilot',
      locale: 'fr-FR',
    });
  });

  it('uses nulls for absent optional fields', () => {
    const a = parseM365Activity({
      type: 'message',
      serviceUrl: 'https://example/',
      conversation: { id: 'c' },
    })!;
    const id = readM365AgentIdentity(a);
    expect(id.userId).toBeNull();
    expect(id.channelId).toBeNull();
    expect(id.locale).toBeNull();
  });
});

describe('Adaptive Card builders', () => {
  it('asAttachment wraps a card in the right MIME', () => {
    const att = asAttachment({ type: 'AdaptiveCard' });
    expect(att.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(att.content).toEqual({ type: 'AdaptiveCard' });
  });

  it('welcomeCard renders a TextBlock with a default title', () => {
    const card = welcomeCard() as { body: Array<{ type: string; weight?: string }> };
    expect(card.body[0]?.type).toBe('TextBlock');
    expect(card.body[0]?.weight).toBe('Bolder');
  });

  it('errorCard surfaces the message + Attention colour', () => {
    const card = errorCard('boom') as { body: Array<{ text?: string; color?: string }> };
    expect(card.body[0]?.color).toBe('Attention');
    expect(card.body[1]?.text).toBe('boom');
  });

  it('widgetFallbackCard renders a FactSet of primitive props', () => {
    const card = widgetFallbackCard({
      name: 'holdCard',
      props: { name: 'HOLD-001', scope: 'Project Phoenix', released: false },
    }) as { body: Array<{ type: string; text?: string; facts?: Array<{ title: string; value: string }> }> };
    expect(card.body[0]?.text).toBe('HOLD-001');
    const facts = card.body[1]?.facts ?? [];
    expect(facts.find((f) => f.title === 'Scope')?.value).toBe('Project Phoenix');
    expect(facts.find((f) => f.title === 'Released')?.value).toBe('false');
  });

  it('widgetFallbackCard adds an Open-in-app action when a deepLinkUrl is provided', () => {
    const card = widgetFallbackCard({
      name: 'x',
      props: { name: 'X' },
      deepLinkUrl: 'https://app/x',
    }) as { actions?: Array<{ url: string }> };
    expect(card.actions?.[0]?.url).toBe('https://app/x');
  });
});

describe('verifyM365AgentJwt', () => {
  it('rejects when the Authorization header is missing', async () => {
    const r = await verifyM365AgentJwt({ authorization: null, expectedAudience: 'app-1' });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('missing-header');
  });

  it('rejects malformed JWTs', async () => {
    const r = await verifyM365AgentJwt({
      authorization: 'Bearer not.a.jwt.really',
      expectedAudience: 'app-1',
    });
    expect(r.valid).toBe(false);
    expect(['malformed-jwt', 'bad-audience', 'bad-issuer']).toContain(r.reason);
  });

  it('accepts skipVerification (dev only)', async () => {
    const r = await verifyM365AgentJwt({
      authorization: null,
      expectedAudience: 'app-1',
      skipVerification: true,
    });
    expect(r.valid).toBe(true);
  });

  it('accepts the legacy Bot Connector issuer', async () => {
    const fresh = makeJwt({
      aud: 'app-1',
      iss: 'https://api.botframework.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyM365AgentJwt({
      authorization: `Bearer ${fresh.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => fresh.publicPem,
    });
    expect(r.valid).toBe(true);
  });

  it('accepts an AAD v2.0 tenanted issuer (M365 Copilot channel)', async () => {
    const fresh = makeJwt({
      aud: 'app-1',
      iss: 'https://login.microsoftonline.com/d6d49420-f39b-4df7-a1dc-d59a935871db/v2.0',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyM365AgentJwt({
      authorization: `Bearer ${fresh.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => fresh.publicPem,
    });
    expect(r.valid).toBe(true);
  });

  it('accepts an AAD v1.0 tenanted issuer', async () => {
    const fresh = makeJwt({
      aud: 'app-1',
      iss: 'https://sts.windows.net/some-tenant-guid/',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyM365AgentJwt({
      authorization: `Bearer ${fresh.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => fresh.publicPem,
    });
    expect(r.valid).toBe(true);
  });

  it('accepts a sovereign-cloud issuer via additionalIssuerPrefixes', async () => {
    const fresh = makeJwt({
      aud: 'app-1',
      iss: 'https://login.microsoftonline.us/tenant/v2.0',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyM365AgentJwt({
      authorization: `Bearer ${fresh.token}`,
      expectedAudience: 'app-1',
      additionalIssuerPrefixes: ['https://login.microsoftonline.us/'],
      resolveKey: async () => fresh.publicPem,
    });
    expect(r.valid).toBe(true);
  });

  it('rejects an unknown issuer not in either default set', async () => {
    const r = await verifyM365AgentJwt({
      authorization: `Bearer ${makeJwt({
        aud: 'app-1',
        iss: 'https://attacker.example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }).token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => 'irrelevant',
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad-issuer');
  });

  it('checks the audience claim', async () => {
    const wrongAud = makeJwt({
      aud: 'wrong-app',
      iss: 'https://api.botframework.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyM365AgentJwt({
      authorization: `Bearer ${wrongAud.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => wrongAud.publicPem,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad-audience');
  });

  it('rejects expired tokens', async () => {
    const expired = makeJwt({
      aud: 'app-1',
      iss: 'https://api.botframework.com',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const r = await verifyM365AgentJwt({
      authorization: `Bearer ${expired.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => expired.publicPem,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('rejects when the key resolver returns null', async () => {
    const fresh = makeJwt({
      aud: 'app-1',
      iss: 'https://api.botframework.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyM365AgentJwt({
      authorization: `Bearer ${fresh.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => null,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unknown-key');
  });

  it('rejects bad signatures', async () => {
    const a = makeJwt({
      aud: 'app-1',
      iss: 'https://api.botframework.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    // Use a *different* key to verify — signature won't match.
    const b = makeJwt({
      aud: 'app-1',
      iss: 'https://api.botframework.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyM365AgentJwt({
      authorization: `Bearer ${a.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => b.publicPem,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad-signature');
  });
});

// ── test helpers ────────────────────────────────────────────────────

function makeJwt(payload: { aud: string; iss: string; exp: number }): {
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
  const sigB64 = sig.toString('base64url');
  return { token: `${signed}.${sigB64}`, publicPem: publicKey };
}
