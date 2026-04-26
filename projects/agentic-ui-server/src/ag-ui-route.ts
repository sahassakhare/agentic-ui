import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import type { AgentResolver, ServerAgent } from './types.js';

export interface AgUiRouteOptions {
  /** Pre-resolved single agent. Mutually exclusive with `resolver`. */
  readonly agent?: ServerAgent;
  /** Resolver for multi-agent setups (e.g., `/agents/:agentId/run`). */
  readonly resolver?: AgentResolver;
  /** Override how the agent id is extracted from the request. Defaults to last path segment before `/run` or the `agentId` query param. */
  readonly extractAgentId?: (req: Request) => string | undefined;
}

/**
 * Web-standards SSE route handler for AG-UI runs. Accepts a `Request` whose
 * body is `{ threadId, runId, messages, tools?, state?, context?, forwardedProps? }`
 * and returns a `Response` whose body is a stream of SSE-encoded AG-UI events.
 *
 * Wire into Hono with `app.post('/agents/:id/run', (c) => agUiRouteHandler(...)(c.req.raw))`,
 * into Express via a tiny `web-standards` adapter, or into Cloudflare Workers / Bun directly.
 */
export function agUiRouteHandler(options: AgUiRouteOptions): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return jsonError(405, 'method_not_allowed', 'POST required');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'Body must be valid JSON');
    }

    const validation = validateRunInput(body);
    if (!validation.ok) return jsonError(400, validation.code, validation.message);
    const input = validation.input;

    const agent = resolveAgent(options, request);
    if (!agent) return jsonError(404, 'agent_not_found', 'No agent matched the request');

    const encoder = new EventEncoder({ accept: request.headers.get('accept') ?? undefined });
    const ac = new AbortController();
    const onClientAbort = () => ac.abort();
    request.signal.addEventListener('abort', onClientAbort, { once: true });

    const textEncoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const ev of agent.run(input, ac.signal)) {
            controller.enqueue(textEncoder.encode(encoder.encodeSSE(ev)));
          }
        } catch (err) {
          const errorEvent: BaseEvent = {
            type: EventType.RUN_ERROR,
            ...({ message: err instanceof Error ? err.message : String(err), code: 'agent_error' } as Record<string, unknown>),
          } as BaseEvent;
          controller.enqueue(textEncoder.encode(encoder.encodeSSE(errorEvent)));
        } finally {
          controller.close();
          request.signal.removeEventListener('abort', onClientAbort);
        }
      },
      cancel() {
        ac.abort();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': encoder.getContentType(),
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  };
}

function resolveAgent(options: AgUiRouteOptions, request: Request): ServerAgent | undefined {
  if (options.agent) return options.agent;
  if (!options.resolver) return undefined;

  const id = (options.extractAgentId ?? defaultExtractAgentId)(request);
  return id ? options.resolver.resolve(id) : undefined;
}

function defaultExtractAgentId(request: Request): string | undefined {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('agentId');
  if (fromQuery) return fromQuery;
  const segments = url.pathname.split('/').filter(Boolean);
  const runIdx = segments.lastIndexOf('run');
  if (runIdx > 0) return segments[runIdx - 1];
  return segments[segments.length - 1];
}

interface ValidInput { readonly ok: true; readonly input: RunAgentInput }
interface InvalidInput { readonly ok: false; readonly code: string; readonly message: string }

function validateRunInput(body: unknown): ValidInput | InvalidInput {
  if (!body || typeof body !== 'object') return { ok: false, code: 'invalid_body', message: 'Body must be a JSON object' };
  const b = body as Record<string, unknown>;
  if (typeof b['threadId'] !== 'string') return { ok: false, code: 'missing_thread_id', message: 'threadId is required' };
  if (typeof b['runId'] !== 'string') return { ok: false, code: 'missing_run_id', message: 'runId is required' };
  if (!Array.isArray(b['messages'])) return { ok: false, code: 'missing_messages', message: 'messages must be an array' };
  return {
    ok: true,
    input: {
      threadId: b['threadId'],
      runId: b['runId'],
      messages: b['messages'] as RunAgentInput['messages'],
      tools: (b['tools'] ?? []) as RunAgentInput['tools'],
      state: b['state'] ?? {},
      context: (b['context'] ?? []) as RunAgentInput['context'],
      forwardedProps: b['forwardedProps'] ?? {},
    },
  };
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
