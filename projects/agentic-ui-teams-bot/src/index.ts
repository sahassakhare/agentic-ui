export type {
  BotAccount,
  BotActivity,
  BotConversation,
  BotCredentials,
  TeamsBotEvent,
  TeamsBotHandler,
  TeamsIdentity,
} from './types.js';

export { parseBotActivity, readTeamsIdentity } from './activity.js';
export { verifyBotJwt, resolveBotConnectorKey } from './verify.js';
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
  acquireBotToken,
  sendReply,
} from './respond.js';
export type { SendOptions, SendResult } from './respond.js';

import type {
  BotActivity,
  BotCredentials,
  TeamsBotEvent,
  TeamsBotHandler,
} from './types.js';
import { parseBotActivity, readTeamsIdentity } from './activity.js';
import { verifyBotJwt } from './verify.js';
import { sendReply } from './respond.js';
import { errorCard, welcomeCard } from './adaptive-card.js';

/**
 * Connect-style middleware that translates an inbound Bot
 * Framework activity into a `TeamsBotHandler` run, then streams
 * the handler's events back to the conversation as Adaptive
 * Cards. Suitable for mounting at `POST /api/messages` -- the
 * default endpoint a Bot Framework registration expects.
 *
 * Wiring:
 *   1. Verify the JWT bearer (skipped only when
 *      `skipSignatureVerification` is true -- local dev only).
 *   2. Parse the activity payload.
 *   3. For `conversationUpdate` -- emit a welcome card and return.
 *   4. For `message` -- run the handler, post each
 *      `TeamsBotEvent` to the conversation, end the run on
 *      handler completion.
 *
 * Unhandled errors are logged and surfaced as an error card to
 * the user so the conversation doesn't go silent.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { createTeamsBotMiddleware } from '@infra-tools/agentic-ui-teams-bot';
 *
 * const app = express();
 * app.post(
 *   '/api/messages',
 *   express.json({ limit: '2mb' }),
 *   createTeamsBotMiddleware({
 *     credentials: {
 *       appId: process.env.BOT_APP_ID!,
 *       appPassword: process.env.BOT_APP_PASSWORD!,
 *     },
 *     handler: yourTeamsBotHandler,
 *     skipSignatureVerification: process.env.NODE_ENV !== 'production',
 *   }),
 * );
 * ```
 */
export interface CreateMiddlewareOptions {
  readonly credentials: BotCredentials;
  readonly handler: TeamsBotHandler;
  readonly skipSignatureVerification?: boolean;
  /** Optional welcome-card override. Default: a generic
   *  "ask me to..." prompt. */
  readonly welcome?: () => object;
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

export function createTeamsBotMiddleware(opts: CreateMiddlewareOptions) {
  return async function teamsBotHandler(
    req: NodeRequestLike,
    res: NodeResponseLike,
  ): Promise<void> {
    // 1. Verify JWT.
    const verified = await verifyBotJwt({
      authorization: headerOf(req, 'authorization'),
      expectedAudience: opts.credentials.appId,
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
    const activity = parseBotActivity(req.body);
    if (!activity) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'invalid-activity' }));
      return;
    }

    // 3. Branch on activity type.
    if (activity.type === 'conversationUpdate') {
      // Reply only when WE were added (otherwise we'd reply to
      // every membersAdded event).
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
      // Ignore everything else (invoke, event, ...) for now.
      res.statusCode = 200;
      res.end();
      return;
    }

    // 4. Run the handler.
    const identity = readTeamsIdentity(activity);
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
      console.error('[agentic-ui-teams-bot] handler threw:', err);
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
  event: TeamsBotEvent,
  activity: BotActivity,
  credentials: BotCredentials,
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
      // Optional UX -- send a "typing" indicator activity.
      // Skipped here to keep the protocol surface small.
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
