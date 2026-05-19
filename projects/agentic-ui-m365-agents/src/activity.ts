import type { M365Activity, M365AgentIdentity } from './types.js';

/**
 * Type-guarded parse of an Agents activity payload. Returns null
 * when required fields (`type`, `conversation.id`, `serviceUrl`)
 * are missing — the webhook handler should respond 400 in that
 * case.
 */
export function parseM365Activity(raw: unknown): M365Activity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['type'] !== 'string') return null;
  if (typeof r['serviceUrl'] !== 'string') return null;
  const conv = r['conversation'];
  if (!conv || typeof conv !== 'object') return null;
  const convId = (conv as { id?: unknown }).id;
  if (typeof convId !== 'string') return null;

  const out: M365Activity = {
    type: r['type'],
    serviceUrl: r['serviceUrl'],
    conversation: pickConversation(conv),
    ...pickStr(r, 'id'),
    ...pickStr(r, 'timestamp'),
    ...pickStr(r, 'text'),
    ...pickStr(r, 'replyToId'),
    ...pickStr(r, 'channelId'),
    ...pickStr(r, 'locale'),
    ...(r['from'] ? { from: pickAccount(r['from']) } : {}),
    ...(r['recipient'] ? { recipient: pickAccount(r['recipient']) } : {}),
  };
  return out;
}

/**
 * Pull the identity surface from a parsed activity. `channelId`
 * is preserved so the host can branch UX per surface (richer
 * cards for Teams, plain text for Copilot web, etc).
 */
export function readM365AgentIdentity(activity: M365Activity): M365AgentIdentity {
  return {
    userId: activity.from?.id ?? null,
    userName: activity.from?.name ?? null,
    aadObjectId: activity.from?.aadObjectId ?? null,
    tenantId: activity.conversation.tenantId ?? null,
    conversationId: activity.conversation.id,
    conversationType: activity.conversation.conversationType ?? null,
    channelId: activity.channelId ?? null,
    locale: activity.locale ?? null,
  };
}

// ── helpers ─────────────────────────────────────────────────────────

function pickAccount(raw: unknown): { id: string; name?: string; aadObjectId?: string } {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    id: typeof a['id'] === 'string' ? a['id'] : '',
    ...(typeof a['name'] === 'string' ? { name: a['name'] } : {}),
    ...(typeof a['aadObjectId'] === 'string' ? { aadObjectId: a['aadObjectId'] } : {}),
  };
}

function pickConversation(raw: unknown): M365Activity['conversation'] {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = typeof c['id'] === 'string' ? c['id'] : '';
  return {
    id,
    ...(typeof c['conversationType'] === 'string'
      ? { conversationType: c['conversationType'] as M365Activity['conversation']['conversationType'] }
      : {}),
    ...(typeof c['tenantId'] === 'string' ? { tenantId: c['tenantId'] } : {}),
    ...(typeof c['name'] === 'string' ? { name: c['name'] } : {}),
  };
}

function pickStr<K extends string>(raw: Record<string, unknown>, key: K): { [P in K]?: string } {
  return typeof raw[key] === 'string' ? ({ [key]: raw[key] } as { [P in K]: string }) : ({} as { [P in K]?: string });
}
