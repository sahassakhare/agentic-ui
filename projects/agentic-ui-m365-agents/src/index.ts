export type {
  AgentAccount,
  AgentConversation,
  M365Activity,
  M365AgentCredentials,
  M365AgentEvent,
  M365AgentHandler,
  M365AgentIdentity,
} from './types.js';

export { parseM365Activity, readM365AgentIdentity } from './activity.js';
export { verifyM365AgentJwt, resolveAgentSigningKey } from './verify.js';
export type { VerifyOptions, VerifyResult } from './verify.js';
export {
  ADAPTIVE_CARD_MIME,
  ADAPTIVE_CARD_SCHEMA_VERSION,
  asAttachment,
  errorCard,
  welcomeCard,
  widgetFallbackCard,
} from './adaptive-card.js';
export {
  acquireAgentToken,
  sendReply,
} from './respond.js';
export type { SendOptions, SendResult } from './respond.js';

import type {
  M365Activity,
  M365AgentCredentials,
  M365AgentEvent,
  M365AgentHandler,
} from './types.js';
import { parseM365Activity, readM365AgentIdentity } from './activity.js';
import { verifyM365AgentJwt } from './verify.js';
import { sendReply } from './respond.js';
import { errorCard, welcomeCard } from './adaptive-card.js';

/**
 * Connect-style middleware that translates an inbound M365 Agents
 * activity into an `M365AgentHandler` run, then streams the
 * handler's events back to the conversation as Adaptive Cards.
 * Mount at `POST /api/messages` — the default endpoint the M365
 * Agents service expects.
 *
 * The middleware is channel-agnostic: the same handler answers
 * Teams chat, M365 Copilot, Direct Line embeds, and any other
 * channel the Agents service brokers. Branch UX by inspecting
 * `identity.channelId` inside the handler.
 *
 * Wiring:
 *   1. Verify the JWT bearer (skipped only when
 *      `skipSignatureVerification` is true — local dev only).
 *   2. Parse the activity payload.
 *   3. For `conversationUpdate` — emit a welcome card and return.
 *   4. For `message` — run the handler, post each
 *      `M365AgentEvent` to the conversation.
 *
 * Unhandled errors are logged and surfaced as an error card to
 * the user so the conversation doesn't go silent.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { createM365AgentMiddleware } from '@infra-tools/agentic-ui-m365-agents';
 *
 * const app = express();
 * app.post(
 *   '/api/messages',
 *   express.json({ limit: '2mb' }),
 *   createM365AgentMiddleware({
 *     credentials: {
 *       appId: process.env.AGENT_APP_ID!,
 *       appPassword: process.env.AGENT_APP_PASSWORD!,
 *     },
 *     handler: yourM365AgentHandler,
 *     skipSignatureVerification: process.env.NODE_ENV !== 'production',
 *   }),
 * );
 * ```
 */
export interface CreateMiddlewareOptions {
  readonly credentials: M365AgentCredentials;
  readonly handler: M365AgentHandler;
  readonly skipSignatureVerification?: boolean;
  /** Optional welcome-card override. */
  readonly welcome?: () => object;
  /**
   * Optional extra issuer prefixes accepted by the JWT verifier
   * (sovereign clouds — Azure Government, Azure China, …).
   */
  readonly additionalIssuerPrefixes?: readonly string[];
}

interface NodeRequestLike {
  readonly headers: Record<string, string | string[] | undefined>;
  on?: (event: string, listener: () => void) => void;
  body?: unknown;
}
interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(payload?: string): void;
}

export function createM365AgentMiddleware(opts: CreateMiddlewareOptions) {
  return async function m365AgentHandler(
    req: NodeRequestLike,
    res: NodeResponseLike,
  ): Promise<void> {
    // 1. Verify JWT.
    const verified = await verifyM365AgentJwt({
      authorization: headerOf(req, 'authorization'),
      expectedAudience: opts.credentials.appId,
      ...(opts.additionalIssuerPrefixes
        ? { additionalIssuerPrefixes: opts.additionalIssuerPrefixes }
        : {}),
      ...(opts.skipSignatureVerification !== undefined
        ? { skipVerification: opts.skipSignatureVerification }
        : {}),
    });
    if (!verified.valid) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'jwt-failed', reason: verified.reason }));
      return;
    }

    // 2. Parse activity.
    const activity = parseM365Activity(req.body);
    if (!activity) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'invalid-activity' }));
      return;
    }

    // 3. Branch on activity type.
    if (activity.type === 'conversationUpdate') {
      const card = opts.welcome ? opts.welcome() : welcomeCard();
      await sendReply({
        inboundActivity: activity,
        credentials: opts.credentials,
        card,
      });
      res.statusCode = 200;
      res.end();
      return;
    }

    if (activity.type !== 'message') {
      // Ignore non-message activities (invoke, event, typing, …) for
      // now. Adopters needing invoke / event handling extend this
      // switch with their own dispatch.
      res.statusCode = 200;
      res.end();
      return;
    }

    // 4. Run the handler.
    const identity = readM365AgentIdentity(activity);
    const abort = new AbortController();
    req.on?.('close', () => abort.abort());

    try {
      for await (const event of opts.handler({
        activity, identity, signal: abort.signal,
      })) {
        await dispatchEvent(event, activity, opts.credentials);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[agentic-ui-m365-agents] handler threw:', err);
      const message = err instanceof Error ? err.message : 'internal error';
      await sendReply({
        inboundActivity: activity,
        credentials: opts.credentials,
        card: errorCard(message),
      });
    }

    res.statusCode = 200;
    res.end();
  };
}

async function dispatchEvent(
  event: M365AgentEvent,
  activity: M365Activity,
  credentials: M365AgentCredentials,
): Promise<void> {
  switch (event.type) {
    case 'text':
      await sendReply({ inboundActivity: activity, credentials, text: event.text });
      return;
    case 'adaptive-card': {
      const opts: Parameters<typeof sendReply>[0] = {
        inboundActivity: activity, credentials, card: event.card,
      };
      if (event.summary) (opts as { text?: string }).text = event.summary;
      await sendReply(opts);
      return;
    }
    case 'typing':
      // Optional UX — typing indicators are channel-specific and
      // omitted here to keep the protocol surface small.
      return;
    case 'error':
      await sendReply({
        inboundActivity: activity, credentials, card: errorCard(event.message),
      });
      return;
  }
}

function headerOf(
  req: NodeRequestLike,
  name: string,
): string | null {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}
