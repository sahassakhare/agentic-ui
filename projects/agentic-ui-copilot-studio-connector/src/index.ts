export type {
  ConnectorActionHandler,
  ConnectorActionResult,
  ConnectorIdentity,
  ConnectorToolDef,
  OpenApiSchema,
} from './types.js';
export { zodToOpenApi } from './zod-to-openapi.js';
export type { ZodToOpenApiOptions } from './zod-to-openapi.js';
export { buildConnectorManifest } from './manifest.js';
export type { BuildManifestOptions, ConnectorManifest } from './manifest.js';
export { verifyConnectorJwt, resolveAadKey } from './verify.js';
export type { VerifyOptions, VerifyResult } from './verify.js';

import type {
  ConnectorActionHandler,
  ConnectorActionResult,
  ConnectorIdentity,
} from './types.js';
import { verifyConnectorJwt } from './verify.js';

/**
 * Pull the {@link ConnectorIdentity} surface from the verified
 * JWT claims. Strict mirror of how the Teams Bot and Copilot
 * Skill adapters do it -- keeps `mapToCatalog(identity)` shape-
 * identical across surfaces so adopters write one translation
 * helper.
 */
export function readConnectorIdentity(claims: Readonly<Record<string, unknown>>): ConnectorIdentity {
  return {
    tenantId: typeof claims['tid'] === 'string' ? claims['tid'] : '',
    userObjectId: typeof claims['oid'] === 'string' ? claims['oid'] : '',
    userPrincipalName:
      typeof claims['preferred_username'] === 'string'
        ? claims['preferred_username']
        : typeof claims['upn'] === 'string'
          ? claims['upn']
          : null,
    roles: Array.isArray(claims['roles'])
      ? (claims['roles'] as unknown[]).filter((r): r is string => typeof r === 'string')
      : [],
    groups: Array.isArray(claims['groups'])
      ? (claims['groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
      : [],
  };
}

/**
 * Connect-style request handler that wires verify + parse +
 * dispatch + JSON response for one Connector tool action.
 *
 * Mount at `POST /api/copilot-studio/actions/:toolName` and
 * route by the dynamic param into `handlers.get(toolName)`.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import {
 *   createConnectorMiddleware,
 *   type ConnectorActionHandler,
 * } from '@infra-tools/agentic-ui-copilot-studio-connector';
 *
 * const handlers = new Map<string, ConnectorActionHandler>();
 * handlers.set('placeLegalHold', async ({ args, identity }) => {
 *   const principal = await mapTeamsToCatalog(identity);
 *   const hold = await yourAgent.dispatch('placeLegalHold', args, principal);
 *   return {
 *     message: `Hold issued: ${hold.id}`,
 *     adaptiveCard: hold.card,
 *     data: { holdId: hold.id },
 *   };
 * });
 *
 * const app = express();
 * app.post(
 *   '/api/copilot-studio/actions/:toolName',
 *   express.json({ limit: '2mb' }),
 *   createConnectorMiddleware({
 *     handlers,
 *     credentials: {
 *       expectedAudience: process.env.BOT_APP_ID!,
 *       allowedTenants: [process.env.AAD_TENANT_ID!],
 *     },
 *     skipSignatureVerification: process.env.NODE_ENV !== 'production',
 *   }),
 * );
 * ```
 */
export interface CreateMiddlewareOptions {
  readonly handlers: ReadonlyMap<string, ConnectorActionHandler>;
  readonly credentials: {
    readonly expectedAudience: string;
    readonly allowedTenants: readonly string[];
  };
  readonly skipSignatureVerification?: boolean;
  /** Override the param name in the URL. Defaults to `toolName`
   *  to match the example route. */
  readonly toolNameParam?: string;
}

interface NodeRequestLike {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly params?: Record<string, string>;
  readonly body?: unknown;
  readonly url?: string;
  on?: (event: string, listener: () => void) => void;
}

interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(payload?: string): void;
}

export function createConnectorMiddleware(opts: CreateMiddlewareOptions) {
  const paramName = opts.toolNameParam ?? 'toolName';

  return async function connectorHandler(
    req: NodeRequestLike,
    res: NodeResponseLike,
  ): Promise<void> {
    // 1. Verify JWT.
    const verified = await verifyConnectorJwt({
      authorization: headerOf(req, 'authorization'),
      expectedAudience: opts.credentials.expectedAudience,
      allowedTenants: opts.credentials.allowedTenants,
      ...(opts.skipSignatureVerification !== undefined
        ? { skipVerification: opts.skipSignatureVerification }
        : {}),
    });
    if (!verified.valid) {
      respond(res, 401, { error: 'jwt-failed', detail: verified.reason });
      return;
    }

    // 2. Resolve tool from URL params or trailing path segment.
    const toolName =
      req.params?.[paramName]
      ?? extractTrailingSegment(req.url ?? '', '/actions/');
    if (!toolName) {
      respond(res, 400, { error: 'missing-tool-name' });
      return;
    }
    const handler = opts.handlers.get(toolName);
    if (!handler) {
      respond(res, 404, { error: 'unknown-tool', detail: toolName });
      return;
    }

    // 3. Parse body. Power Platform sends JSON-encoded objects.
    const args: Record<string, unknown> =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    // 4. Run handler + return result.
    const abort = new AbortController();
    req.on?.('close', () => abort.abort());
    const identity = readConnectorIdentity(verified.claims ?? {});
    let result: ConnectorActionResult;
    try {
      result = await handler({
        toolName,
        args,
        identity,
        signal: abort.signal,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[copilot-studio-connector] handler ${toolName} threw:`, err);
      respond(res, 500, {
        error: 'handler-error',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    respond(res, 200, result as unknown as Record<string, unknown>);
  };
}

function respond(res: NodeResponseLike, code: number, body: Record<string, unknown>): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function headerOf(req: NodeRequestLike, name: string): string | null {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

function extractTrailingSegment(url: string, prefix: string): string | null {
  const i = url.indexOf(prefix);
  if (i < 0) return null;
  const rest = url.slice(i + prefix.length);
  const stop = rest.search(/[/?#]/);
  const seg = stop < 0 ? rest : rest.slice(0, stop);
  return seg.length > 0 ? decodeURIComponent(seg) : null;
}
