import type { CopilotIdentity, CopilotRequestBody } from './types.js';

/**
 * Parse the body GitHub Copilot Chat POSTs to a skill webhook.
 * The body is JSON shaped roughly like an OpenAI Chat Completion
 * request -- a `messages` array plus a handful of Copilot-
 * specific fields.
 *
 * Returns null if the payload is missing required fields. The
 * webhook handler returns 400 in that case.
 */
export function parseCopilotRequest(raw: unknown): CopilotRequestBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as { messages?: unknown };
  if (!Array.isArray(body.messages)) return null;
  const messages = body.messages
    .map(parseMessage)
    .filter((m): m is CopilotRequestBody['messages'][number] => m !== null);
  if (messages.length === 0) return null;
  return {
    messages,
    copilot_thread_id: typeof (raw as { copilot_thread_id?: unknown }).copilot_thread_id === 'string'
      ? (raw as { copilot_thread_id: string }).copilot_thread_id
      : undefined,
    copilot_skills: Array.isArray((raw as { copilot_skills?: unknown }).copilot_skills)
      ? ((raw as { copilot_skills: unknown[] }).copilot_skills.filter((s): s is string => typeof s === 'string'))
      : undefined,
  };
}

function parseMessage(raw: unknown): CopilotRequestBody['messages'][number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as { role?: unknown; content?: unknown };
  if (typeof m.role !== 'string') return null;
  if (typeof m.content !== 'string') return null;
  const role = m.role as 'system' | 'user' | 'assistant' | 'tool';
  if (!['system', 'user', 'assistant', 'tool'].includes(role)) return null;
  return { role, content: m.content };
}

/**
 * Pull the identity GitHub adds to every Copilot Chat webhook.
 * Most adopters will run these through a claims mapper into the
 * catalog principal. Headers GitHub sets:
 *   X-GitHub-User
 *   X-GitHub-User-Id
 *   X-GitHub-Enterprise
 *   X-GitHub-Org
 * Production deployments should also call back into GitHub's API
 * to validate the bearer token; this helper just normalises the
 * fields the webhook can see directly.
 */
export function readCopilotIdentity(headers: Record<string, string | string[] | undefined>): CopilotIdentity {
  return {
    githubUserLogin: pickHeader(headers, 'x-github-user'),
    githubUserId: pickHeader(headers, 'x-github-user-id'),
    enterprise: pickHeader(headers, 'x-github-enterprise'),
    orgs: pickHeaderList(headers, 'x-github-org'),
  };
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

function pickHeaderList(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): readonly string[] {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v;
  return [];
}
