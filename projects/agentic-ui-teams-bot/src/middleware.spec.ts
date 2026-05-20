import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  createTeamsBotMiddleware,
  type TeamsBotEvent,
} from './index.js';
import { _resetTokenCache } from './respond.js';

/**
 * Slice L6 — middleware smoke e2e. The existing spec covers parsers,
 * card builders, and JWT verification at unit level; this spec
 * exercises `createTeamsBotMiddleware` end-to-end: request → JWT
 * skip → parse → handler → sendReply → 200.
 *
 * Wire seams mocked:
 *   - JWT verification disabled via `skipSignatureVerification`.
 *   - Bot Connector reply endpoint mocked via the `fetch` global.
 *   - AAD token endpoint mocked via the same `fetch` global.
 */

interface CapturedReply {
  readonly url: string;
  readonly body: unknown;
}

function buildHttpStubs(): {
  req: {
    headers: Record<string, string>;
    body: unknown;
    on?: (event: string, listener: () => void) => void;
  };
  res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (payload?: string) => void;
    headers: Record<string, string>;
    payload: string | undefined;
  };
} {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    payload: undefined as string | undefined,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    end(payload?: string) { this.payload = payload; },
  };
  const req = {
    headers: { authorization: 'Bearer dev-token' } as Record<string, string>,
    body: {},
  };
  return { req, res };
}

function stubFetch(captured: CapturedReply[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/oauth2/v2.0/token')) {
      return new Response(JSON.stringify({ access_token: 'fake-aad-token', expires_in: 3600 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    // Bot Connector reply endpoint
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    captured.push({ url, body });
    return new Response(JSON.stringify({ id: `reply-${captured.length}` }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

const baseMessageActivity = {
  type: 'message' as const,
  id: 'act-1',
  serviceUrl: 'https://smba.trafficmanager.net/teams/',
  conversation: { id: 'conv-1', conversationType: 'personal', tenantId: 'tn-1' },
  from: { id: 'u-1', name: 'alice', aadObjectId: 'aad-1' },
  recipient: { id: 'b-1', name: 'bot' },
  text: 'hello',
  locale: 'en-US',
};

describe('createTeamsBotMiddleware — L6 smoke e2e', () => {
  beforeEach(() => { _resetTokenCache(); });

  it('verifies (skipped), parses, runs handler, posts a reply, ends 200', async () => {
    const captured: CapturedReply[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(captured);

    const handler = vi.fn(async function* (input): AsyncIterable<TeamsBotEvent> {
      // Identity + activity flow through unchanged.
      expect(input.identity.userId).toBe('u-1');
      expect(input.activity.text).toBe('hello');
      yield { type: 'text', text: 'hi back' };
    });

    const mw = createTeamsBotMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: true,
    });
    const { req, res } = buildHttpStubs();
    req.body = baseMessageActivity;

    await mw(req, res);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body).toMatchObject({
      type: 'message',
      text: 'hi back',
      conversation: { id: 'conv-1' },
    });

    globalThis.fetch = originalFetch;
  });

  it('responds with 401 when JWT verification fails (skipVerification=false, no token)', async () => {
    const handler = vi.fn();
    const mw = createTeamsBotMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      // Explicit production-mode flag — verification IS enabled.
      skipSignatureVerification: false,
    });
    const { req, res } = buildHttpStubs();
    delete req.headers.authorization;
    req.body = baseMessageActivity;

    await mw(req, res);

    expect(res.statusCode).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('responds with 400 on a malformed activity payload', async () => {
    const handler = vi.fn();
    const mw = createTeamsBotMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: true,
    });
    const { req, res } = buildHttpStubs();
    req.body = { type: 'message' };  // missing serviceUrl + conversation

    await mw(req, res);

    expect(res.statusCode).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('emits a welcome card on a conversationUpdate without invoking the handler', async () => {
    const captured: CapturedReply[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(captured);

    const handler = vi.fn();
    const mw = createTeamsBotMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: true,
    });
    const { req, res } = buildHttpStubs();
    req.body = { ...baseMessageActivity, type: 'conversationUpdate' };

    await mw(req, res);

    expect(handler).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    expect((captured[0]?.body as { attachments?: Array<{ contentType: string }> })?.attachments?.[0]?.contentType)
      .toBe('application/vnd.microsoft.card.adaptive');

    globalThis.fetch = originalFetch;
  });

  it('routes adaptive-card events through to an Adaptive Card attachment on the reply', async () => {
    const captured: CapturedReply[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(captured);

    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [{ type: 'TextBlock', text: 'Custom card' }],
    };
    const handler = async function* (): AsyncIterable<TeamsBotEvent> {
      yield { type: 'adaptive-card', card, summary: 'A custom card' };
    };
    const mw = createTeamsBotMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: true,
    });
    const { req, res } = buildHttpStubs();
    req.body = baseMessageActivity;

    await mw(req, res);

    expect(res.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    const sent = captured[0]?.body as { text?: string; attachments?: Array<{ contentType: string; content: unknown }> };
    expect(sent.text).toBe('A custom card');
    expect(sent.attachments?.[0]?.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(sent.attachments?.[0]?.content).toEqual(card);

    globalThis.fetch = originalFetch;
  });

  it('surfaces a thrown handler as an error card via sendReply', async () => {
    const captured: CapturedReply[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(captured);

    // eslint-disable-next-line require-yield
    const handler = async function* (): AsyncIterable<TeamsBotEvent> {
      throw new Error('handler boom');
    };
    const mw = createTeamsBotMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: true,
    });
    const { req, res } = buildHttpStubs();
    req.body = baseMessageActivity;

    // The middleware logs the error to console; squelch it in the test.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mw(req, res);
    consoleSpy.mockRestore();

    expect(res.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    // The error card structure is the adaptive-card-attachment shape.
    const sent = captured[0]?.body as { attachments?: Array<{ content?: { body?: Array<{ text?: string }> } }> };
    const errorText = sent.attachments?.[0]?.content?.body?.[1]?.text;
    expect(errorText).toBe('handler boom');

    globalThis.fetch = originalFetch;
  });
});
