/**
 * Pure helpers shared by the catalog **data-source** and **tool** compilers.
 *
 * They turn authored, declarative rows into runtime behaviour:
 *  - a data source declares an API `endpoint` (+ method + headers, where header
 *    values may reference `${SECRET}` resolved from the host's secrets map), and
 *  - a tool declares `{ dataSource, method, path, query, body }` whose `{arg}`
 *    placeholders are filled from the agent's call arguments.
 *
 * Kept free of Angular so it's trivially testable and costs nothing at boot.
 */

export interface HttpConfig {
  /** Base URL, e.g. `https://crm.example.com/v1`. */
  readonly endpoint: string;
  /** Default HTTP method when a query doesn't override it. */
  readonly method?: string;
  /** Static headers (already secret-resolved) sent on every request. */
  readonly headers?: Record<string, string>;
}

export interface HttpQuery {
  /** Path appended to the endpoint (e.g. `/customers/123`). */
  readonly path?: string;
  readonly method?: string;
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
}

/** Replace `${NAME}` references in a string from a secrets map (missing → empty). */
export function interpolateSecrets(value: string, secrets: Record<string, string>): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => secrets[name] ?? '');
}

/** Resolve `${SECRET}` refs in every header value; accepts a JSON string or an object. */
export function resolveHeaders(
  headers: Record<string, string> | string | undefined,
  secrets: Record<string, string>,
): Record<string, string> {
  const obj = typeof headers === 'string' ? safeJson(headers) : headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj ?? {})) out[k] = interpolateSecrets(String(v), secrets);
  return out;
}

/** Fill `{arg}` placeholders in a template string from the call args. */
export function fillTemplate(template: string, args: Record<string, unknown>, encode = false): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = args[key];
    const s = v == null ? '' : String(v);
    return encode ? encodeURIComponent(s) : s;
  });
}

/**
 * Deep-fill `{arg}` placeholders in a query/body value. A string that is exactly
 * `{arg}` yields the raw arg (type preserved — a number stays a number); an
 * embedded `{arg}` yields an interpolated string.
 */
export function fillDeep(value: unknown, args: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = value.match(/^\{(\w+)\}$/);
    return whole ? args[whole[1]] : fillTemplate(value, args);
  }
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, args));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = fillDeep(v, args);
    return out;
  }
  return value;
}

/** Join a base URL and a path, preserving any base path prefix (unlike `new URL`). */
export function joinUrl(base: string, path?: string): string {
  if (!path) return base;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Build the `fetch`-backed adapter closure for a data source. */
export function buildHttpAdapter(cfg: HttpConfig, fetchFn: typeof fetch = globalThis.fetch): (q: HttpQuery) => Promise<unknown> {
  return async (q: HttpQuery) => {
    const url = new URL(joinUrl(cfg.endpoint, q.path));
    for (const [k, v] of Object.entries(q.query ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const method = (q.method ?? cfg.method ?? 'GET').toUpperCase();
    const sendsBody = q.body !== undefined && method !== 'GET' && method !== 'HEAD';
    const res = await fetchFn(url.toString(), {
      method,
      headers: {
        accept: 'application/json',
        ...(sendsBody ? { 'content-type': 'application/json' } : {}),
        ...cfg.headers,
      },
      body: sendsBody ? JSON.stringify(q.body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${url.toString()} failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  };
}

function safeJson(s: string): Record<string, string> | undefined {
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? (v as Record<string, string>) : undefined; }
  catch { return undefined; }
}
