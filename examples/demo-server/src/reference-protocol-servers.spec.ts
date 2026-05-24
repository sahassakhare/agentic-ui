import { describe, expect, it } from 'vitest';
import { decodeFrames, type Frame } from '@hashbrownai/core';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import type { AgentResolver, ServerAgent } from '@infra-tools/agentic-ui-server';
import { hashbrownReferenceHandler, a2uiReferenceHandler } from './reference-protocol-servers.js';

/**
 * The reference servers run the resolver's `gemini` agent and transcode its
 * AG-UI events into each wire (Hashbrown frames / A2UI NDJSON). We drive
 * them with a FAKE agent that emits a scripted text + tool-call sequence,
 * so the tests assert the transcoding deterministically (no LLM / network).
 * With no resolver, each handler falls back to an LLM-free echo.
 */

async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function readFrames(res: Response): Promise<Frame[]> {
  const frames: Frame[] = [];
  for await (const f of decodeFrames(res.body as ReadableStream<Uint8Array>, { signal: new AbortController().signal })) {
    frames.push(f);
  }
  return frames;
}

function req(body: unknown): Request {
  return new Request('http://localhost/agents/x/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Fake agent: RUN_STARTED → text → bookFlight tool call → RUN_FINISHED. */
const fakeAgent: ServerAgent = {
  id: 'gemini',
  async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
    const mid = `msg-${input.runId}`;
    yield { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent;
    yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: mid, delta: 'Booking… ' } as BaseEvent;
    yield { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'bookFlight' } as BaseEvent;
    yield { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"from":"LAX","to":"JFK"}' } as BaseEvent;
    yield { type: EventType.TOOL_CALL_END, toolCallId: 'tc1' } as BaseEvent;
    yield { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent;
  },
};
const resolver: AgentResolver = { resolve: (id) => (id === 'gemini' ? fakeAgent : undefined) };

describe('hashbrownReferenceHandler — real agent (transcoded to frames)', () => {
  it('streams text + a real tool call as Hashbrown frames', async () => {
    const res = await hashbrownReferenceHandler(req({ messages: [{ role: 'user', content: 'book LAX to JFK' }] }), resolver);
    expect(res.headers.get('Content-Type')).toContain('application/octet-stream');
    const frames = await readFrames(res);

    expect(frames[0]).toEqual({ type: 'generation-start' });
    expect(frames.at(-1)).toEqual({ type: 'generation-finish' });

    const chunks = frames.filter((f): f is Extract<Frame, { type: 'generation-chunk' }> => f.type === 'generation-chunk');
    // text delta surfaced
    expect(chunks.map((c) => c.chunk.choices[0]?.delta?.content ?? '').join('')).toContain('Booking');
    // a real tool call surfaced (name + streamed args)
    const toolDeltas = chunks.flatMap((c) => c.chunk.choices[0]?.delta?.toolCalls ?? []);
    expect(toolDeltas.some((t) => t?.function?.name === 'bookFlight')).toBe(true);
    expect(toolDeltas.map((t) => t?.function?.arguments ?? '').join('')).toContain('LAX');
  });

  it('falls back to an echo when no agent is configured', async () => {
    const res = await hashbrownReferenceHandler(req({ messages: [{ role: 'user', content: 'hi' }] }));
    const frames = await readFrames(res);
    const text = frames
      .filter((f): f is Extract<Frame, { type: 'generation-chunk' }> => f.type === 'generation-chunk')
      .map((f) => f.chunk.choices[0]?.delta?.content ?? '').join('');
    expect(text).toContain('echo: "hi"');
    expect(frames.at(-1)).toEqual({ type: 'generation-finish' });
  });
});

describe('a2uiReferenceHandler — real agent (transcoded to NDJSON)', () => {
  it('streams canonical text + tool-call events and a ui-action before run-finished', async () => {
    const res = await a2uiReferenceHandler(req({ threadId: 't9', runId: 'r9', messages: [{ role: 'user', content: 'book it' }] }), resolver);
    const events = await readEvents(res);
    const types = events.map((e) => e['type']);

    expect(types).toContain('text-delta');
    expect(types).toContain('tool-call-start');
    expect(events.find((e) => e['type'] === 'tool-call-start')).toMatchObject({ name: 'bookFlight' });
    expect(types).toContain('tool-call-args');
    expect(types).toContain('tool-call-end');

    // ui-action fires just before run-finished.
    const uiIdx = types.indexOf('ui-action');
    const finIdx = types.indexOf('run-finished');
    expect(uiIdx).toBeGreaterThanOrEqual(0);
    expect(uiIdx).toBeLessThan(finIdx);
  });

  it('falls back to an echo (with ui-action) when no agent is configured', async () => {
    const res = await a2uiReferenceHandler(req({ runId: 'r1', messages: [{ role: 'user', content: 'hi' }] }));
    const events = await readEvents(res);
    expect(events.find((e) => e['type'] === 'ui-action')).toMatchObject({ op: 'notify' });
    expect(events.at(-1)).toMatchObject({ type: 'run-finished', runId: 'r1' });
  });
});
