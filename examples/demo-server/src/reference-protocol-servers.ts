/**
 * Reference protocol servers — Hashbrown + A2UI.
 *
 * Both reuse the SAME `GeminiAgent` the AG-UI route runs, then transcode
 * its AG-UI event stream into their own wire (see protocol-transcoders.ts):
 *
 *  - **Hashbrown (R1)** answers a `Chat.Api.CompletionCreateParams` request
 *    with a stream of length-prefixed `Frame`s (`encodeFrame`).
 *  - **A2UI (R2)** answers with canonical `AgenticEvent` NDJSON, plus the
 *    distinguishing `ui-action` event.
 *
 * Because the agent emits a REAL tool call (e.g. `bookFlight`) and the
 * tool's handler runs CLIENT-SIDE, the chat shell renders the same
 * generative-UI widget over all three protocols — no echo, no special
 * casing. When no API key is configured the agent is absent and each
 * handler falls back to an LLM-free echo so the demo still runs.
 *
 * Reference implementations R1 + R2 of
 * docs/plans/reference-implementations-plan.md. See ADR-048 for the
 * canonical event contract every adapter conforms to.
 */
import { EventType } from '@ag-ui/core';
import { encodeFrame, type Frame } from '@hashbrownai/core';
import type { AgentResolver } from '@infra-tools/agentic-ui-server';
import {
  AgUiToHashbrownFrames,
  aguiEventToCanonical,
  a2uiBodyToRunInput,
  hashbrownParamsToRunInput,
} from './protocol-transcoders.js';

/** The agent both reference servers run when an API key is configured. */
const AGENT_ID = 'gemini';

function lastUserText(messages: ReadonlyArray<{ role?: string; content?: unknown }> | undefined): string {
  const last = [...(messages ?? [])].reverse().find((m) => m.role === 'user');
  if (!last) return '(no user message)';
  return typeof last.content === 'string' ? last.content : '[multipart content]';
}

/** Bridge the incoming web `Request`'s abort to an `AbortController`. */
function abortFromRequest(req: Request): AbortController {
  const ac = new AbortController();
  req.signal?.addEventListener('abort', () => ac.abort(), { once: true });
  return ac;
}

/** Stream an async generator of events as `application/x-ndjson`. */
function ndjsonResponse(events: () => AsyncGenerator<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of events()) {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
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
 * Stream Hashbrown `Frame`s as the SDK's length-prefixed binary format
 * (`application/octet-stream`) — `[4-byte BE length][UTF-8 JSON]`, exactly
 * what the client adapter's `decodeFrames` expects.
 */
function framesResponse(frames: () => AsyncGenerator<Frame>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const frame of frames()) {
          controller.enqueue(encodeFrame(frame));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-cache' },
  });
}

/**
 * Hashbrown reference server (R1). Runs the real agent and transcodes its
 * AG-UI events to Hashbrown `Frame`s (`generation-start` → `generation-chunk`*
 * carrying text + streamed `tool_calls` → `generation-finish`). Falls back
 * to an echo when no agent (no API key) is available.
 */
export async function hashbrownReferenceHandler(req: Request, resolver?: AgentResolver): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const agent = resolver?.resolve(AGENT_ID);

  if (!agent) {
    const text = lastUserText(body['messages'] as ReadonlyArray<{ role?: string; content?: unknown }>);
    return framesResponse(async function* () {
      yield { type: 'generation-start' };
      const reply = `Hashbrown reference (no API key) — echo: "${text}".`;
      for (const word of reply.split(' ')) {
        yield { type: 'generation-chunk', chunk: { choices: [{ index: 0, delta: { content: word + ' ' }, finishReason: null }] } };
      }
      yield { type: 'generation-finish' };
    });
  }

  const input = hashbrownParamsToRunInput(body);
  const ac = abortFromRequest(req);
  const transcoder = new AgUiToHashbrownFrames();
  return framesResponse(async function* () {
    for await (const ev of agent.run(input, ac.signal)) {
      for (const frame of transcoder.frames(ev)) yield frame;
    }
  });
}

/**
 * A2UI reference server (R2). Runs the real agent and transcodes its AG-UI
 * events to canonical `AgenticEvent` NDJSON, injecting the distinguishing
 * `ui-action` event just before `run-finished`. Falls back to an echo when
 * no agent (no API key) is available.
 */
export async function a2uiReferenceHandler(req: Request, resolver?: AgentResolver): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const agent = resolver?.resolve(AGENT_ID);
  const runId = String(body['runId'] ?? `run-${Date.now()}`);
  const threadId = String(body['threadId'] ?? `thread-${Date.now()}`);

  if (!agent) {
    const text = lastUserText(body['messages'] as ReadonlyArray<{ role?: string; content?: unknown }>);
    return ndjsonResponse(async function* () {
      yield { type: 'run-started', threadId, runId };
      const messageId = `m-${runId}`;
      const reply = `A2UI reference (no API key) — echo: "${text}".`;
      for (const word of reply.split(' ')) {
        yield { type: 'text-delta', messageId, delta: word + ' ' };
      }
      yield { type: 'text-end', messageId };
      yield { type: 'ui-action', actionId: `act-${runId}`, op: 'notify', payload: { message: 'A2UI fired a ui-action', level: 'info' } };
      yield { type: 'run-finished', runId };
    });
  }

  const input = a2uiBodyToRunInput(body);
  const ac = abortFromRequest(req);
  return ndjsonResponse(async function* () {
    for await (const ev of agent.run(input, ac.signal)) {
      // The A2UI distinguishing feature — a UI op fired alongside the run,
      // dispatched host-side (UI_ACTION_DISPATCHER → ActionRegistry).
      if (ev.type === EventType.RUN_FINISHED) {
        yield { type: 'ui-action', actionId: `act-${input.runId}`, op: 'notify', payload: { message: 'A2UI agent fired a ui-action', level: 'info' } };
      }
      for (const c of aguiEventToCanonical(ev, { threadId: input.threadId, runId: input.runId })) yield c;
    }
  });
}
