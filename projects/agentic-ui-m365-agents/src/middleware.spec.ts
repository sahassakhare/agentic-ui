import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  createM365AgentMiddleware,
  type M365AgentEvent,
} from './index.js';
import { _resetTokenCache } from './respond.js';

/**
 * Slice L6 — middleware smoke e2e mirroring the teams-bot spec.
 * The m365-agents adapter accepts traffic from a broader channel
 * set (Teams + M365 Copilot + Direct Line + sovereign clouds), so
 * the smoke verifies the channelId surfaces correctly to the
 * handler's identity.
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
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    captured.push({ url, body });
    return new Response(JSON.stringify({ id: `reply-${captured.length}` }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

const copilotActivity = {
  type: 'message' as const,
  id: 'act-1',
  serviceUrl: 'https://copilot.example/',
  channelId: 'm365copilot',
  conversation: { id: 'conv-cp-1', conversationType: 'personal', tenantId: 'tn-1' },
  from: { id: 'u-1', name: 'alice', aadObjectId: 'aad-1' },
  recipient: { id: 'a-1', name: 'agent' },
  text: 'hello from copilot',
  locale: 'en-US',
};

describe('createM365AgentMiddleware — L6 smoke e2e', () => {
  beforeEach(() => { _resetTokenCache(); });

  it('routes a Copilot-channel message through the handler with channelId surfaced', async () => {
    const captured: CapturedReply[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(captured);

    const handler = vi.fn(async function* (input): AsyncIterable<M365AgentEvent> {
      // identity carries the channelId so handlers can branch per surface
      expect(input.identity.channelId).toBe('m365copilot');
      expect(input.activity.text).toBe('hello from copilot');
      yield { type: 'text', text: 'hi from agent' };
    });

    const mw = createM365AgentMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: true,
    });
    const { req, res } = buildHttpStubs();
    req.body = copilotActivity;

    await mw(req, res);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body).toMatchObject({ type: 'message', text: 'hi from agent' });

    globalThis.fetch = originalFetch;
  });

  it('responds 401 when JWT verification is enabled and no token present', async () => {
    const handler = vi.fn();
    const mw = createM365AgentMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: false,
    });
    const { req, res } = buildHttpStubs();
    delete req.headers.authorization;
    req.body = copilotActivity;

    await mw(req, res);

    expect(res.statusCode).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('emits a welcome card on conversationUpdate', async () => {
    const captured: CapturedReply[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(captured);

    const handler = vi.fn();
    const mw = createM365AgentMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: true,
    });
    const { req, res } = buildHttpStubs();
    req.body = { ...copilotActivity, type: 'conversationUpdate' };

    await mw(req, res);

    expect(handler).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    expect((captured[0]?.body as { attachments?: Array<{ contentType: string }> })?.attachments?.[0]?.contentType)
      .toBe('application/vnd.microsoft.card.adaptive');

    globalThis.fetch = originalFetch;
  });

  it('routes adaptive-card events to AC attachments', async () => {
    const captured: CapturedReply[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(captured);

    const card = { type: 'AdaptiveCard', version: '1.5', body: [] };
    const handler = async function* (): AsyncIterable<M365AgentEvent> {
      yield { type: 'adaptive-card', card };
    };
    const mw = createM365AgentMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: true,
    });
    const { req, res } = buildHttpStubs();
    req.body = copilotActivity;

    await mw(req, res);

    expect(res.statusCode).toBe(200);
    const sent = captured[0]?.body as { attachments?: Array<{ content?: unknown }> };
    expect(sent.attachments?.[0]?.content).toEqual(card);

    globalThis.fetch = originalFetch;
  });

  it('surfaces a thrown handler as an error card', async () => {
    const captured: CapturedReply[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(captured);

    // eslint-disable-next-line require-yield
    const handler = async function* (): AsyncIterable<M365AgentEvent> {
      throw new Error('m365 handler boom');
    };
    const mw = createM365AgentMiddleware({
      credentials: { appId: 'app-1', appPassword: 'secret-1' },
      handler,
      skipSignatureVerification: true,
    });
    const { req, res } = buildHttpStubs();
    req.body = copilotActivity;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mw(req, res);
    consoleSpy.mockRestore();

    expect(res.statusCode).toBe(200);
    const sent = captured[0]?.body as { attachments?: Array<{ content?: { body?: Array<{ text?: string }> } }> };
    expect(sent.attachments?.[0]?.content?.body?.[1]?.text).toBe('m365 handler boom');

    globalThis.fetch = originalFetch;
  });
});
