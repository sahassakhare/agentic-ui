import { describe, expect, it } from 'vitest';
import {
  asAttachment,
  errorCard,
  parseBotActivity,
  readTeamsIdentity,
  verifyBotJwt,
  welcomeCard,
  widgetFallbackCard,
} from './index.js';
import { createSign, generateKeyPairSync } from 'node:crypto';

describe('parseBotActivity', () => {
  const baseActivity = {
    type: 'message',
    id: 'act-1',
    serviceUrl: 'https://smba.trafficmanager.net/teams/',
    conversation: { id: 'conv-1', conversationType: 'personal', tenantId: 'tn-1' },
    from: { id: 'u-1', name: 'alice', aadObjectId: 'aad-1' },
    recipient: { id: 'b-1', name: 'bot' },
    text: 'place a legal hold',
    locale: 'en-US',
  };

  it('parses a well-formed message activity', () => {
    const a = parseBotActivity(baseActivity);
    expect(a).not.toBeNull();
    expect(a?.type).toBe('message');
    expect(a?.conversation.id).toBe('conv-1');
    expect(a?.from?.aadObjectId).toBe('aad-1');
    expect(a?.text).toBe('place a legal hold');
  });

  it('returns null when required fields are missing', () => {
    expect(parseBotActivity(null)).toBeNull();
    expect(parseBotActivity('not-an-object')).toBeNull();
    expect(parseBotActivity({ type: 'message' })).toBeNull();          // no serviceUrl
    expect(parseBotActivity({ type: 'message', serviceUrl: 'x' })).toBeNull();  // no conversation
    expect(parseBotActivity({ ...baseActivity, conversation: { } })).toBeNull(); // conversation has no id
  });

  it('keeps optional fields when present, omits them when absent', () => {
    const a = parseBotActivity({
      type: 'message',
      serviceUrl: 'https://example/',
      conversation: { id: 'c' },
    });
    expect(a?.text).toBeUndefined();
    expect(a?.from).toBeUndefined();
  });
});

describe('readTeamsIdentity', () => {
  it('extracts the identity surface', () => {
    const a = parseBotActivity({
      type: 'message',
      serviceUrl: 'https://example/',
      conversation: { id: 'conv-1', conversationType: 'channel', tenantId: 'tn-9' },
      from: { id: 'u-1', name: 'alice', aadObjectId: 'aad-1' },
      locale: 'fr-FR',
    })!;
    const id = readTeamsIdentity(a);
    expect(id).toEqual({
      userId: 'u-1',
      userName: 'alice',
      aadObjectId: 'aad-1',
      tenantId: 'tn-9',
      conversationId: 'conv-1',
      conversationType: 'channel',
      locale: 'fr-FR',
    });
  });

  it('uses nulls for absent optional fields', () => {
    const a = parseBotActivity({
      type: 'message',
      serviceUrl: 'https://example/',
      conversation: { id: 'c' },
    })!;
    const id = readTeamsIdentity(a);
    expect(id.userId).toBeNull();
    expect(id.tenantId).toBeNull();
    expect(id.conversationType).toBeNull();
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
    const card = welcomeCard() as { body: Array<{ type: string; text?: string; weight?: string }> };
    expect(card.body[0]?.type).toBe('TextBlock');
    expect(card.body[0]?.weight).toBe('Bolder');
  });

  it('welcomeCard accepts overrides', () => {
    const card = welcomeCard({ title: 'Hello!', body: 'How can I help?' }) as {
      body: Array<{ text?: string }>;
    };
    expect(card.body[0]?.text).toBe('Hello!');
    expect(card.body[1]?.text).toBe('How can I help?');
  });

  it('errorCard surfaces the message + Attention colour', () => {
    const card = errorCard('boom') as {
      body: Array<{ text?: string; color?: string }>;
    };
    expect(card.body[0]?.color).toBe('Attention');
    expect(card.body[1]?.text).toBe('boom');
  });
});

describe('widgetFallbackCard', () => {
  it('uses props.name as the title and lists primitive props as facts', () => {
    const card = widgetFallbackCard({
      name: 'legalHoldCard',
      props: {
        name: 'HOLD-001',
        scope: 'Project Phoenix emails',
        custodianCount: 3,
        released: false,
      },
    }) as { body: Array<{ type: string; text?: string; facts?: Array<{ title: string; value: string }> }> };
    expect(card.body[0]?.text).toBe('HOLD-001');
    const fs = card.body[1];
    expect(fs?.type).toBe('FactSet');
    const facts = fs?.facts ?? [];
    expect(facts.find((f) => f.title === 'Scope')?.value).toBe('Project Phoenix emails');
    expect(facts.find((f) => f.title === 'Custodian count')?.value).toBe('3');
    expect(facts.find((f) => f.title === 'Released')?.value).toBe('false');
  });

  it('falls back to humanised widget name when no title-like prop exists', () => {
    const card = widgetFallbackCard({
      name: 'placeLegalHoldCard',
      props: {},
    }) as { body: Array<{ text?: string }> };
    expect(card.body[0]?.text).toBe('Place legal hold card');
  });

  it('adds an Open-in-app action when deepLinkUrl is provided', () => {
    const card = widgetFallbackCard({
      name: 'something',
      props: { name: 'X' },
      deepLinkUrl: 'https://app/holds/x',
    }) as { actions?: Array<{ type: string; url: string }> };
    expect(card.actions?.[0]?.url).toBe('https://app/holds/x');
  });

  it('handles object + array props (length / [...] markers)', () => {
    const card = widgetFallbackCard({
      name: 'capCard',
      props: {
        name: 'X',
        custodianIds: ['c-1', 'c-2', 'c-3'],
        body: { nested: true },
      },
    }) as { body: Array<{ facts?: Array<{ title: string; value: string }> }> };
    const facts = card.body[1]?.facts ?? [];
    expect(facts.find((f) => f.title === 'Custodian ids')?.value).toBe('c-1, c-2, c-3');
    expect(facts.find((f) => f.title === 'Body')?.value).toBe('{…}');
  });
});

describe('verifyBotJwt', () => {
  it('rejects when the Authorization header is missing', async () => {
    const r = await verifyBotJwt({ authorization: null, expectedAudience: 'app-1' });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('missing-header');
  });

  it('rejects malformed JWTs', async () => {
    const r = await verifyBotJwt({
      authorization: 'Bearer not.a.jwt.really',
      expectedAudience: 'app-1',
    });
    expect(r.valid).toBe(false);
    expect(['malformed-jwt', 'bad-audience', 'bad-issuer']).toContain(r.reason);
  });

  it('accepts skipVerification (dev only)', async () => {
    const r = await verifyBotJwt({
      authorization: null,
      expectedAudience: 'app-1',
      skipVerification: true,
    });
    expect(r.valid).toBe(true);
  });

  it('checks the audience claim', async () => {
    const wrongAud = makeJwt({
      aud: 'wrong-app',
      iss: 'https://api.botframework.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyBotJwt({
      authorization: `Bearer ${wrongAud.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => wrongAud.publicPem,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad-audience');
  });

  it('checks the issuer claim', async () => {
    const wrongIss = makeJwt({
      aud: 'app-1',
      iss: 'https://attacker.example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyBotJwt({
      authorization: `Bearer ${wrongIss.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => wrongIss.publicPem,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad-issuer');
  });

  it('rejects expired tokens', async () => {
    const expired = makeJwt({
      aud: 'app-1',
      iss: 'https://api.botframework.com',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const r = await verifyBotJwt({
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
    const r = await verifyBotJwt({
      authorization: `Bearer ${fresh.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => null,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unknown-key');
  });

  it('accepts a valid signature', async () => {
    const fresh = makeJwt({
      aud: 'app-1',
      iss: 'https://api.botframework.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const r = await verifyBotJwt({
      authorization: `Bearer ${fresh.token}`,
      expectedAudience: 'app-1',
      resolveKey: async () => fresh.publicPem,
    });
    expect(r.valid).toBe(true);
  });
});

// ── test helpers ────────────────────────────────────────────────────

function makeJwt(payload: { aud: string; iss: string; exp: number }): {
  token: string;
  publicPem: string;
} {
  // generateKeyPairSync with PEM encoding returns the keys as
  // ready-to-use PEM strings; no further KeyObject round-trip needed.
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
