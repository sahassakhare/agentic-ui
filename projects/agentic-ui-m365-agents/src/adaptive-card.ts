/**
 * Adaptive Card builders shared by the response path. Cards are
 * raw JSON per AC schema 1.5; the adapter wraps them in the
 * `attachments: [{ contentType, content }]` field on the outgoing
 * activity.
 *
 * Same builders ship in the sibling `@infra-tools/agentic-ui-teams-bot`
 * adapter — both M365 Copilot and Teams render Adaptive Cards with
 * the same schema. Re-exporting (rather than depending) keeps each
 * adapter free of cross-package coupling.
 *
 * @see https://adaptivecards.io/explorer/
 */

export const ADAPTIVE_CARD_MIME = 'application/vnd.microsoft.card.adaptive';
export const ADAPTIVE_CARD_SCHEMA_VERSION = '1.5';

/** Wrap a raw card JSON into an Activity attachment. */
export function asAttachment(card: object): { contentType: string; content: object } {
  return { contentType: ADAPTIVE_CARD_MIME, content: card };
}

/** Welcome card emitted on `conversationUpdate`. Adopters override
 *  to brand the entry experience. */
export function welcomeCard(opts?: { title?: string; body?: string }): object {
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: ADAPTIVE_CARD_SCHEMA_VERSION,
    body: [
      {
        type: 'TextBlock',
        text: opts?.title ?? 'Hi! I can help.',
        weight: 'Bolder',
        size: 'Medium',
      },
      {
        type: 'TextBlock',
        text:
          opts?.body
          ?? 'Ask me anything. I\'ll use the same tools your web app does.',
        wrap: true,
      },
    ],
  };
}

/** Build an error card. */
export function errorCard(message: string): object {
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: ADAPTIVE_CARD_SCHEMA_VERSION,
    body: [
      {
        type: 'TextBlock',
        text: 'Something went wrong',
        weight: 'Bolder',
        size: 'Medium',
        color: 'Attention',
      },
      { type: 'TextBlock', text: message, wrap: true },
    ],
  };
}

/**
 * Generic fallback that converts a `{ name, props }` widget spec
 * into a passable Adaptive Card. Used when a tool result lacks an
 * explicit `adaptiveCard` hint.
 *
 * Pattern:
 *   - Title = props.title / props.name / humanized widget name.
 *   - Body = FactSet of primitive props (truncates at 8 entries).
 *   - Optional `Action.OpenUrl` when a deepLinkUrl is supplied.
 */
export function widgetFallbackCard(spec: {
  name: string;
  props: unknown;
  deepLinkUrl?: string;
}): object {
  const title = extractTitle(spec.props) ?? humanize(spec.name);
  const facts = collectFacts(spec.props);
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: ADAPTIVE_CARD_SCHEMA_VERSION,
    body: [
      { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium' },
      ...(facts.length > 0 ? [{ type: 'FactSet', facts }] : []),
      ...(facts.length === 0
        ? [{ type: 'TextBlock', text: 'No additional details available.', wrap: true, isSubtle: true }]
        : []),
    ],
    ...(spec.deepLinkUrl
      ? {
          actions: [
            { type: 'Action.OpenUrl', title: 'Open in app', url: spec.deepLinkUrl },
          ],
        }
      : {}),
  };
}

function extractTitle(props: unknown): string | null {
  if (!props || typeof props !== 'object') return null;
  const p = props as Record<string, unknown>;
  for (const key of ['name', 'title', 'label']) {
    const v = p[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function collectFacts(props: unknown): Array<{ title: string; value: string }> {
  if (!props || typeof props !== 'object') return [];
  const out: Array<{ title: string; value: string }> = [];
  for (const [key, raw] of Object.entries(props as Record<string, unknown>)) {
    if (['name', 'title', 'label'].includes(key)) continue;
    const value = scalarize(raw);
    if (!value) continue;
    out.push({ title: humanize(key), value });
    if (out.length >= 8) break;
  }
  return out;
}

function scalarize(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 197) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return v.slice(0, 5).map(String).join(', ') + (v.length > 5 ? ` (+${v.length - 5})` : '');
    }
    return `${v.length} item${v.length === 1 ? '' : 's'}`;
  }
  if (typeof v === 'object') return '{…}';
  return String(v);
}

function humanize(camelOrKebab: string): string {
  const spaced = camelOrKebab
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
