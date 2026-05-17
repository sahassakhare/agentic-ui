import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { logger } from './logger.js';

/**
 * RFC 7807 problem+json shape. Consumers programmatically discriminate
 * on `type` (URI reference) and human-display `title` / `detail`.
 *
 * https://www.rfc-editor.org/rfc/rfc7807
 */
export interface ProblemJson {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly errors?: readonly { path: string; message: string }[];
  readonly requestId?: string;
}

const PROBLEM_TYPE_BASE = 'https://github.com/sahassakhare/agentic-ui/blob/main/platform/agentic-catalog-server/docs/problems';

function problemTypeFor(status: number): string {
  switch (status) {
    case 400: return `${PROBLEM_TYPE_BASE}/bad-request.md`;
    case 401: return `${PROBLEM_TYPE_BASE}/unauthorized.md`;
    case 403: return `${PROBLEM_TYPE_BASE}/forbidden.md`;
    case 404: return `${PROBLEM_TYPE_BASE}/not-found.md`;
    case 409: return `${PROBLEM_TYPE_BASE}/conflict.md`;
    case 422: return `${PROBLEM_TYPE_BASE}/unprocessable.md`;
    case 429: return `${PROBLEM_TYPE_BASE}/too-many-requests.md`;
    case 500: return `${PROBLEM_TYPE_BASE}/internal-error.md`;
    case 503: return `${PROBLEM_TYPE_BASE}/service-unavailable.md`;
    default:  return `${PROBLEM_TYPE_BASE}/${status}.md`;
  }
}

function titleFor(status: number): string {
  switch (status) {
    case 400: return 'Bad Request';
    case 401: return 'Unauthorized';
    case 403: return 'Forbidden';
    case 404: return 'Not Found';
    case 409: return 'Conflict';
    case 422: return 'Unprocessable Entity';
    case 429: return 'Too Many Requests';
    case 500: return 'Internal Server Error';
    case 503: return 'Service Unavailable';
    default:  return `HTTP ${status}`;
  }
}

/**
 * Catches any error thrown out of a handler / middleware, formats
 * it as RFC 7807, logs at appropriate severity, and returns the
 * problem+json response.
 */
export const globalErrorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') as string | undefined;

  // Zod validation error → 422
  if (err instanceof ZodError) {
    const body: ProblemJson = {
      type: problemTypeFor(422),
      title: titleFor(422),
      status: 422,
      detail: 'Request body / query failed validation',
      errors: err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
      requestId,
    };
    logger.warn({ err, requestId }, 'request validation failed');
    return c.json(body, 422 as 422, { 'Content-Type': 'application/problem+json' });
  }

  if (err instanceof HTTPException) {
    const status = err.status;
    const body: ProblemJson = {
      type: problemTypeFor(status),
      title: titleFor(status),
      status,
      detail: err.message,
      requestId,
    };
    logger[status >= 500 ? 'error' : 'warn']({ err, requestId, status }, 'HTTP exception');
    return c.json(body, status as 400, { 'Content-Type': 'application/problem+json' });
  }

  // Unhandled — bare Error or non-Error throw. 500.
  const detail = err instanceof Error ? err.message : 'Unknown error';
  const body: ProblemJson = {
    type: problemTypeFor(500),
    title: titleFor(500),
    status: 500,
    detail,
    requestId,
  };
  logger.error({ err, requestId }, 'unhandled error');
  return c.json(body, 500 as 500, { 'Content-Type': 'application/problem+json' });
};

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}

/**
 * Generate / propagate a request id. Honours `X-Request-Id` from the
 * caller (typical pattern for tracing across a load balancer); falls
 * back to a fresh UUID. Echoed in every log line + every error.
 */
export function requestIdMiddleware() {
  return async (c: Context, next: () => Promise<void>) => {
    const incoming = c.req.header('x-request-id');
    const id = incoming && incoming.length > 0 && incoming.length <= 200
      ? incoming
      : crypto.randomUUID();
    c.set('requestId', id);
    c.res.headers.set('X-Request-Id', id);
    await next();
  };
}
