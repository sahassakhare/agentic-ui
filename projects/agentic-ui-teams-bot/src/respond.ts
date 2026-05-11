import type { BotActivity, BotCredentials } from './types.js';
import { asAttachment } from './adaptive-card.js';

/**
 * POST a reply back to the Bot Connector. Replies are scoped to
 * the inbound activity's `serviceUrl` (per-region) +
 * `conversation.id`. The connector signs the response with the
 * bot's AAD bearer; we acquire one via client-credentials flow on
 * first call and cache it until ~10min before expiry.
 *
 * @see https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages
 */
export interface SendOptions {
  readonly inboundActivity: BotActivity;
  readonly credentials: BotCredentials;
  /** Body of the reply -- text + optional Adaptive Card. Pass at
   *  least one of `text` or `card`. */
  readonly text?: string;
  readonly card?: object;
  /** Override the request `fetch` for tests. */
  readonly fetchImpl?: typeof fetch;
  /** Override the token acquirer for tests. */
  readonly getToken?: (creds: BotCredentials) => Promise<string>;
}

export interface SendResult {
  readonly ok: boolean;
  readonly status: number;
  readonly responseId?: string;
  readonly error?: string;
}

export async function sendReply(opts: SendOptions): Promise<SendResult> {
  const { inboundActivity, credentials } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tokenFn = opts.getToken ?? acquireBotToken;

  const body: Record<string, unknown> = {
    type: 'message',
    from: inboundActivity.recipient,
    recipient: inboundActivity.from,
    conversation: inboundActivity.conversation,
    ...(inboundActivity.id ? { replyToId: inboundActivity.id } : {}),
  };
  if (opts.text) body['text'] = opts.text;
  if (opts.card) body['attachments'] = [asAttachment(opts.card)];

  if (!body['text'] && !body['attachments']) {
    return { ok: false, status: 0, error: 'no-text-or-card' };
  }

  let token: string;
  try {
    token = await tokenFn(credentials);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: 'token-error: ' + (err instanceof Error ? err.message : String(err)),
    };
  }

  const replyToId = inboundActivity.id ?? '';
  const url =
    inboundActivity.serviceUrl.replace(/\/$/, '') +
    `/v3/conversations/${encodeURIComponent(inboundActivity.conversation.id)}` +
    (replyToId ? `/activities/${encodeURIComponent(replyToId)}` : '/activities');

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: 'fetch-error: ' + (err instanceof Error ? err.message : String(err)),
    };
  }

  let json: { id?: unknown } | null = null;
  try { json = (await res.json()) as { id?: unknown }; } catch { /* response might be empty */ }
  return {
    ok: res.ok,
    status: res.status,
    ...(typeof json?.id === 'string' ? { responseId: json.id } : {}),
    ...(!res.ok ? { error: `bot-connector-${res.status}` } : {}),
  };
}

// ── token acquirer ──────────────────────────────────────────────────

interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>();
const TOKEN_PADDING_MS = 60_000;   // refresh 60s before expiry

/**
 * Client-credentials flow against AAD. The bot's appId + appPassword
 * exchange for an access token scoped to the Bot Connector audience.
 * Cached per appId in-process until ~1 minute before expiry.
 *
 * @see https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
 */
export async function acquireBotToken(credentials: BotCredentials): Promise<string> {
  const cached = tokenCache.get(credentials.appId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const tenant = credentials.tenantId ?? 'botframework.com';
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.appId,
    client_secret: credentials.appPassword,
    scope: 'https://api.botframework.com/.default',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!res.ok) {
    throw new Error(`AAD token endpoint returned ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (typeof json.access_token !== 'string') {
    throw new Error('AAD response missing access_token');
  }
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  tokenCache.set(credentials.appId, {
    token: json.access_token,
    expiresAt: Date.now() + expiresIn * 1000 - TOKEN_PADDING_MS,
  });
  return json.access_token;
}

/** Test helper -- clears the in-process token cache. */
export function _resetTokenCache(): void {
  tokenCache.clear();
}
