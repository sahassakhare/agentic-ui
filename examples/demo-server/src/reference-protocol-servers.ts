/**
 * Reference protocol servers — Hashbrown + A2UI (NDJSON).
 *
 * The AG-UI reference server is `agUiRouteHandler` (SSE). These two are
 * the NDJSON-wire counterparts the Hashbrown + A2UI client adapters in
 * `@infra-tools/agentic-ui` consume. They demonstrate exactly what such
 * a server emits: one JSON-encoded canonical `AgenticEvent` per line.
 *
 * Echo-based (LLM-free) so they run without an API key — the WIRE SHAPE
 * is identical to what an LLM-backed server would emit; only the content
 * is an echo. Adopters copy these as the starting point for a real
 * Hashbrown / A2UI server and swap the echo body for their LLM loop.
 *
 * Reference implementations R1 + R2 of
 * docs/plans/reference-implementations-plan.md. See ADR-048 for the
 * canonical event contract every adapter conforms to.
 */

/** Subset of the request body the client adapters POST (see ADR-048). */
interface RefRequestBody {
  readonly threadId?: string;
  readonly runId?: string;
  readonly messages?: ReadonlyArray<{ readonly role?: string; readonly content?: unknown }>;
  readonly tools?: ReadonlyArray<{ readonly name?: string; readonly description?: string; readonly parameters?: unknown }>;
  readonly state?: Record<string, unknown>;
}

function lastUserText(messages: RefRequestBody['messages']): string {
  const last = [...(messages ?? [])].reverse().find((m) => m.role === 'user');
  if (!last) return '(no user message)';
  return typeof last.content === 'string' ? last.content : '[multipart content]';
}

/** Stream an async generator of events as `application/x-ndjson`. */
function ndjsonResponse(events: () => AsyncGenerator<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of events()) {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
          // Small pause so the stream visibly arrives in chunks (streaming feel).
          await new Promise((r) => setTimeout(r, 25));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  });
}

/**
 * Hashbrown reference server (R1). Echoes the user message back as a
 * canonical `text-delta` stream, surfacing the tool count + state keys
 * it received — proof that the client adapter serialized tools (with
 * JSON-Schema parameters) and threaded `state` per ADR-013.
 */
export async function hashbrownReferenceHandler(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as RefRequestBody;
  const runId = body.runId ?? `run-${Date.now()}`;
  const threadId = body.threadId ?? `thread-${Date.now()}`;
  const text = lastUserText(body.messages);
  const toolNames = (body.tools ?? []).map((t) => t.name).filter(Boolean);
  const stateKeys = Object.keys(body.state ?? {});

  return ndjsonResponse(async function* () {
    yield { type: 'run-started', threadId, runId };
    const messageId = `m-${runId}`;
    const reply =
      `Hashbrown reference server — echo: "${text}". ` +
      `Received ${toolNames.length} tool(s)` +
      (toolNames.length ? ` [${toolNames.join(', ')}]` : '') +
      ` and state key(s) [${stateKeys.join(', ') || 'none'}].`;
    for (const word of reply.split(' ')) {
      yield { type: 'text-delta', messageId, delta: word + ' ' };
    }
    yield { type: 'text-end', messageId };
    yield { type: 'run-finished', runId };
  });
}

/**
 * A2UI reference server (R2). Like Hashbrown's echo, plus it emits the
 * distinguishing A2UI `ui-action` event — exercising the client
 * adapter's `UiActionDispatcher` path (and the L1 fix that threads the
 * live `threadId` / `runId` into the dispatched action).
 */
export async function a2uiReferenceHandler(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as RefRequestBody;
  const runId = body.runId ?? `run-${Date.now()}`;
  const threadId = body.threadId ?? `thread-${Date.now()}`;
  const text = lastUserText(body.messages);

  return ndjsonResponse(async function* () {
    yield { type: 'run-started', threadId, runId };
    const messageId = `m-${runId}`;
    const reply = `A2UI reference server — echo: "${text}". Firing a ui-action you can dispatch via ActionRegistry.`;
    for (const word of reply.split(' ')) {
      yield { type: 'text-delta', messageId, delta: word + ' ' };
    }
    yield { type: 'text-end', messageId };
    // The A2UI distinguishing feature — a UI op the host dispatches.
    // 'notify' is a safe demo op; adopters map it to a registered ActionDef.
    yield {
      type: 'ui-action',
      actionId: `act-${runId}`,
      op: 'notify',
      payload: { message: 'A2UI reference server fired a ui-action', level: 'info' },
    };
    yield { type: 'run-finished', runId };
  });
}
