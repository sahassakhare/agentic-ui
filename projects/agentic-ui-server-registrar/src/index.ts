/**
 * @maverick/agentic-ui-server-registrar
 *
 * Server-side helper for the AgenticBackend deployments. Auto-registers
 * with the Maverick catalog at boot, sends periodic heartbeats so
 * operators can see "is the gemini coordinator alive" in the ops
 * console, and gracefully marks itself inactive on SIGTERM.
 *
 * Slice AGT / [ADR-039](../../../docs/adr/0039-agent-auto-registration.md).
 *
 * Mirrors the runtime tier's `provideCatalogCapabilityRegistrar`
 * pattern (ADR-032) — idempotent POST (409 = already registered,
 * success), best-effort heartbeat (catalog flips status to
 * 'degraded' after 2× missed heartbeats; sweeper marks 'inactive'
 * after a grace window).
 *
 * @example
 * ```ts
 * // In your agent server's main.ts:
 * import { registerAgentWithCatalog } from '@maverick/agentic-ui-server-registrar';
 *
 * const reg = await registerAgentWithCatalog({
 *   catalogUrl: process.env.CATALOG_URL!,
 *   tenantId: process.env.TENANT_ID!,
 *   getToken: () => process.env.CATALOG_TOKEN ?? null,
 *   agent: {
 *     name: 'gemini-coordinator',
 *     kind: 'ag-ui',
 *     manifestUrl: process.env.PUBLIC_URL!,
 *     capabilities: server.toolNames(),
 *   },
 *   heartbeatIntervalMs: 30_000,
 * });
 *
 * // Graceful shutdown — flips status to 'inactive' so operators don't
 * // see a stale 'active' row.
 * process.on('SIGTERM', () => reg.shutdown());
 * ```
 */

export interface AgentRegistration {
  readonly name: string;
  readonly kind: 'ag-ui' | 'hashbrown' | 'a2ui' | 'mcp' | 'custom';
  readonly manifestUrl: string;
  readonly version?: string;
  readonly requiredHostVersion?: string;
  readonly capabilities?: readonly string[];
}

export interface RegistrarOptions {
  readonly catalogUrl: string;
  readonly tenantId: string;
  readonly getToken: () => Promise<string | null | undefined> | string | null | undefined;
  readonly agent: AgentRegistration;
  /**
   * Heartbeat interval in ms. Default `30_000` (30s). Set `0` to
   * disable heartbeating (initial registration only).
   */
  readonly heartbeatIntervalMs?: number;
  /**
   * Override of `globalThis.fetch`. Test seam.
   */
  readonly fetchFn?: typeof fetch;
  /**
   * Optional logger; defaults to a console.warn/info shim. Pass a
   * pino instance or similar for structured logging.
   */
  readonly logger?: { info: (msg: string, ...args: unknown[]) => void; warn: (msg: string, ...args: unknown[]) => void };
}

export interface RegistrationHandle {
  /** UUID assigned by the catalog. `null` if registration failed. */
  readonly id: string | null;
  /** Stop the heartbeat timer + mark the agent inactive. */
  shutdown(): Promise<void>;
  /** Force a heartbeat now (e.g. on health-check tick). */
  heartbeat(status?: 'active' | 'degraded' | 'inactive'): Promise<void>;
}

const DEFAULT_LOGGER = {
  info: (msg: string, ...args: unknown[]) => console.info(`[agent-registrar] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[agent-registrar] ${msg}`, ...args),
};

/**
 * Register the agent + start heartbeating. Returns a handle the
 * caller uses to gracefully shut down. Failures are non-fatal —
 * the agent server keeps running even if the catalog is
 * unreachable.
 */
export async function registerAgentWithCatalog(
  options: RegistrarOptions,
): Promise<RegistrationHandle> {
  const fetcher = options.fetchFn ?? fetch;
  const logger = options.logger ?? DEFAULT_LOGGER;
  const baseUrl = `${stripTrail(options.catalogUrl)}/v1/catalogs/${encodeURIComponent(options.tenantId)}/agents`;

  const buildHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const token = await options.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  // Step 1 — register or recover the existing row.
  let id: string | null = null;
  try {
    const headers = await buildHeaders();
    const res = await fetcher(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.agent),
    });
    if (res.status === 201) {
      const body = await res.json() as { id: string };
      id = body.id;
      logger.info(`registered agent ${options.agent.name} (id=${id}) with catalog`);
    } else if (res.status === 409) {
      // Already registered (typical on re-deploy). Look up the id
      // via GET ?name= so heartbeats can target the existing row.
      logger.info(`agent ${options.agent.name} already registered — looking up id`);
      const list = await fetcher(baseUrl, { headers });
      if (list.ok) {
        const body = await list.json() as { items: Array<{ id: string; name: string }> };
        const found = body.items.find((a) => a.name === options.agent.name);
        if (found) {
          id = found.id;
          logger.info(`recovered id=${id} for ${options.agent.name}`);
        } else {
          logger.warn(`agent ${options.agent.name} reported 409 but not found in list`);
        }
      } else {
        logger.warn(`recovery list failed: HTTP ${list.status}`);
      }
    } else {
      const detail = await safeText(res);
      logger.warn(`registration failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
  } catch (err) {
    logger.warn(`registration errored: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 2 — heartbeat loop.
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function sendHeartbeat(status?: 'active' | 'degraded' | 'inactive'): Promise<void> {
    if (!id) return;
    try {
      const headers = await buildHeaders();
      const res = await fetcher(`${baseUrl}/${id}/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(status ? { status } : {}),
      });
      if (!res.ok) {
        logger.warn(`heartbeat failed: HTTP ${res.status}`);
      }
    } catch (err) {
      logger.warn(`heartbeat errored: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (heartbeatIntervalMs > 0 && id) {
    timer = setInterval(() => { void sendHeartbeat(); }, heartbeatIntervalMs);
    // Don't keep the process alive for the heartbeat alone.
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as unknown as { unref: () => void }).unref();
    }
  }

  return {
    id,
    async shutdown(): Promise<void> {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // Best-effort flip to inactive so operators don't see a stale
      // 'active' row.
      await sendHeartbeat('inactive');
    },
    heartbeat(status?: 'active' | 'degraded' | 'inactive'): Promise<void> {
      return sendHeartbeat(status);
    },
  };
}

function stripTrail(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 500); }
  catch { return ''; }
}
