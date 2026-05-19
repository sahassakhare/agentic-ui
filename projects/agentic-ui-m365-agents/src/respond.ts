import type { M365Activity, M365AgentCredentials } from './types.js';
import { asAttachment } from './adaptive-card.js';

/**
 * POST a reply back to the M365 Agents service. The reply is
 * scoped to the inbound activity's `serviceUrl` (per-channel,
 * per-region) and `conversation.id`. The service signs the
 * response with the agent's AAD bearer; the adapter acquires
 * one via client-credentials flow on first call and caches it
 * until ~1 minute before expiry.
 *
 * @see https://learn.microsoft.com/microsoft-365/agents-sdk/
 * @see https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages
 */
export interface SendOptions {
  readonly inboundActivity: M365Activity;
  readonly credentials: M365AgentCredentials;
  /** Body of the reply — text + optional Adaptive Card. Pass at
   *  least one of `text` or `card`. */
  readonly text?: string;
  readonly card?: object;
  /** Override the request `fetch` for tests. */
  readonly fetchImpl?: typeof fetch;
  /** Override the token acquirer for tests. */
  readonly getToken?: (creds: M365AgentCredentials) => Promise<string>;
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
  const tokenFn = opts.getToken ?? acquireAgentToken;

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
    ...(!res.ok ? { error: `agents-service-${res.status}` } : {}),
  };
}

// ── token acquirer ──────────────────────────────────────────────────

interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>();
const TOKEN_PADDING_MS = 60_000;   // refresh 60s before expiry

/**
 * Client-credentials flow against AAD. The agent's appId +
 * appPassword exchange for an access token scoped to the Agents
 * Service audience. Cached per appId in-process until ~1 minute
 * before expiry.
 *
 * The token scope is `https://api.botframework.com/.default` —
 * the M365 Agents service preserves the legacy Bot Connector
 * audience for backward compatibility with existing tooling.
 *
 * @see https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
 */
export async function acquireAgentToken(credentials: M365AgentCredentials): Promise<string> {
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

/** Test helper — clears the in-process token cache. */
export function _resetTokenCache(): void {
  tokenCache.clear();
}
