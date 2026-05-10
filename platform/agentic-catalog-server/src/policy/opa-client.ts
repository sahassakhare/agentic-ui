import { logger } from '../logger.js';
import type { PolicyDecisionResponse } from '../domain/policy.js';

/**
 * Thin client over the OPA sidecar's standard REST API. Slice
 * OPA-A / ADR-040.
 *
 * The catalog server doesn't bundle the OPA Go binary — operators
 * run it as a sidecar (Docker compose service / Kubernetes
 * sidecar container) and configure `OPA_URL` (e.g.
 * `http://opa:8181`). We POST to `{OPA_URL}/v1/data/{rule_path}`
 * with the input envelope; OPA returns `{result: <rule output>}`.
 */
export interface OpaClientConfig {
  readonly url: string;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface OpaClient {
  readonly enabled: boolean;
  readonly url: string | null;
  evaluate(
    rulePath: string,
    input: Record<string, unknown>,
    bundleName: string | null,
  ): Promise<PolicyDecisionResponse>;
}

class NoopOpaClient implements OpaClient {
  readonly enabled = false;
  readonly url = null;
  async evaluate(): Promise<PolicyDecisionResponse> {
    throw new Error('OPA not configured. Set OPA_URL to enable policy decisions. See ADR-040.');
  }
}

class HttpOpaClient implements OpaClient {
  readonly enabled = true;
  readonly url: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(cfg: OpaClientConfig) {
    this.url = stripTrail(cfg.url);
    this.fetcher = cfg.fetchFn ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 2_000;
  }

  async evaluate(
    rulePath: string,
    input: Record<string, unknown>,
    bundleName: string | null,
  ): Promise<PolicyDecisionResponse> {
    const path = rulePath.replace(/^\/+/, '').replace(/\.+/g, '/');
    const url = `${this.url}/v1/data/${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await safeText(res);
        throw new Error(`OPA returned HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
      }
      const body = await res.json() as { result?: unknown };
      return interpretOpaResult(body.result, bundleName, rulePath);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), url },
        'opa decision call failed',
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Map OPA's `result` to the catalog's `PolicyDecisionResponse`. Three
 * shapes are supported:
 * - Bare boolean → `{ allow: <bool> }`.
 * - `{ allow: bool, reason?, obligations? }` → passed through.
 * - Anything else (truthy/falsy fallback) → `{ allow: <truthy>, raw: <result> }`.
 */
export function interpretOpaResult(
  result: unknown,
  bundleName: string | null,
  rulePath: string,
): PolicyDecisionResponse {
  if (typeof result === 'boolean') {
    return { allow: result, bundle: bundleName, rulePath };
  }
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r['allow'] === 'boolean') {
      const out: PolicyDecisionResponse = {
        allow: r['allow'],
        bundle: bundleName,
        rulePath,
      };
      const reason = r['reason'];
      if (typeof reason === 'string') (out as { reason?: string }).reason = reason;
      const obligations = r['obligations'];
      if (obligations && typeof obligations === 'object') {
        (out as { obligations?: Record<string, unknown> }).obligations = obligations as Record<string, unknown>;
      }
      return out;
    }
  }
  return {
    allow: Boolean(result),
    bundle: bundleName,
    rulePath,
    raw: result,
  };
}

export function makeOpaClient(cfg: OpaClientConfig | null): OpaClient {
  if (!cfg) return new NoopOpaClient();
  return new HttpOpaClient(cfg);
}

function stripTrail(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function safeText(r: Response): Promise<string> {
  try { return (await r.text()).slice(0, 500); }
  catch { return ''; }
}
