import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { encodeFrame, type Frame } from '@hashbrownai/core';
import { agenticTool } from '../../factories/agentic-tool';
import { HashbrownBackend } from './hashbrown-backend';
import { InMemoryTelemetrySink } from '../../testing/in-memory-telemetry-sink';
import type { AgenticEvent, AgenticMessage, ToolDef } from '../../internal';

/**
 * Hashbrown adapter spec — native `@hashbrownai/core` integration.
 *
 * Asserts the real-protocol contract:
 *   - the request body is a `Chat.Api.CompletionCreateParams`
 *     (`operation`, `model`, `system`, `messages`, `tools` with full
 *     JSON-Schema parameters);
 *   - the length-prefixed `Frame` response (built here with the SDK's
 *     `encodeFrame`) is decoded + mapped to canonical `AgenticEvent`s;
 *   - the adapter owns run lifecycle + error handling.
 *
 * Mocks `fetch` to control the wire — no live HTTP.
 */

/** A length-prefixed frame stream, encoded with the real SDK codec. */
function framesReadable(frames: Frame[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encodeFrame(f));
      controller.close();
    },
  });
}

function framesResponse(frames: Frame[]): Response {
  return new Response(framesReadable(frames), {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

function chunk(content: string): Frame {
  return { type: 'generation-chunk', chunk: { choices: [{ index: 0, delta: { content }, finishReason: null }] } };
}

let lastRequest: { url: string; body: unknown } | null = null;

function stubFetch(response: Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    lastRequest = { url, body: init?.body ? JSON.parse(String(init.body)) : null };
    return response;
  }) as typeof fetch;
}

async function collect(iter: AsyncIterable<AgenticEvent>): Promise<AgenticEvent[]> {
  const out: AgenticEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  threadId: 't-1',
  runId: 'r-1',
  messages: [{ id: 'u-1', role: 'user', content: 'hello', toolCalls: [], widgets: [] }] as readonly AgenticMessage[],
  tools: [] as readonly ToolDef[],
  widgets: [],
  signal: new AbortController().signal,
  ...overrides,
});

describe('HashbrownBackend — native @hashbrownai/core integration', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    lastRequest = null;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts a CompletionCreateParams request (operation/model/system/messages)', async () => {
    globalThis.fetch = stubFetch(framesResponse([{ type: 'generation-finish' }]));

    const backend = new HashbrownBackend({ url: 'http://hashbrown.test/run', model: 'gpt-4o-mini' }, new InMemoryTelemetrySink());
    await collect(backend.run(baseInput({
      messages: [
        { id: 's', role: 'system', content: 'Be terse.', toolCalls: [], widgets: [] },
        { id: 'u', role: 'user', content: 'hi', toolCalls: [], widgets: [] },
      ] as readonly AgenticMessage[],
    })));

    const body = lastRequest?.body as {
      operation: string; model: string; system: string; messages: Array<{ role: string }>;
    };
    expect(body.operation).toBe('generate');
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.system).toBe('Be terse.');           // system lifted out of messages
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('defaults the model to gpt-4o and posts tools with full JSON-Schema parameters', async () => {
    globalThis.fetch = stubFetch(framesResponse([{ type: 'generation-finish' }]));

    const tool = agenticTool({
      name: 'searchDocs',
      description: 'free-text search',
      schema: z.object({ q: z.string(), limit: z.number().optional() }),
      handler: async () => ({ ok: true }),
    });
    const backend = new HashbrownBackend({ url: 'http://hashbrown.test/run' }, new InMemoryTelemetrySink());
    await collect(backend.run(baseInput({ tools: [tool] as unknown as ToolDef[] })));

    const body = lastRequest?.body as { model: string; tools: Array<{ name: string; parameters: { properties?: Record<string, unknown> } }> };
    expect(body.model).toBe('gpt-4o');
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]?.name).toBe('searchDocs');
    expect(body.tools[0]?.parameters?.properties?.['q']).toBeDefined();
    expect(body.tools[0]?.parameters?.properties?.['limit']).toBeDefined();
  });

  it('decodes a frame stream into run-started → text-delta* → run-finished', async () => {
    globalThis.fetch = stubFetch(framesResponse([
      { type: 'generation-start' },
      chunk('Hi '),
      chunk('there'),
      { type: 'generation-finish' },
    ]));

    const backend = new HashbrownBackend({ url: 'http://hashbrown.test/run' }, new InMemoryTelemetrySink());
    const events = await collect(backend.run(baseInput()));

    expect(events.map((e) => e.type)).toEqual(['run-started', 'text-delta', 'text-delta', 'run-finished']);
    const text = events.filter((e): e is Extract<AgenticEvent, { type: 'text-delta' }> => e.type === 'text-delta').map((e) => e.delta).join('');
    expect(text).toBe('Hi there');
  });

  it('maps streamed tool calls to tool-call-start/args/end', async () => {
    globalThis.fetch = stubFetch(framesResponse([
      { type: 'generation-chunk', chunk: { choices: [{ index: 0, delta: { toolCalls: [{ index: 0, id: 'tc1', function: { name: 'searchDocs', arguments: '{"q":' } }] }, finishReason: null }] } },
      { type: 'generation-chunk', chunk: { choices: [{ index: 0, delta: { toolCalls: [{ index: 0, function: { arguments: '"ipsa"}' } }] }, finishReason: null }] } },
      { type: 'generation-finish' },
    ]));

    const backend = new HashbrownBackend({ url: 'http://hashbrown.test/run' }, new InMemoryTelemetrySink());
    const events = await collect(backend.run(baseInput()));
    const toolEvents = events.filter((e) => e.type.startsWith('tool-call'));
    expect(toolEvents).toEqual([
      { type: 'tool-call-start', toolCallId: 'tc1', name: 'searchDocs' },
      { type: 'tool-call-args', toolCallId: 'tc1', delta: '{"q":' },
      { type: 'tool-call-args', toolCallId: 'tc1', delta: '"ipsa"}' },
      { type: 'tool-call-end', toolCallId: 'tc1' },
    ]);
  });

  it('surfaces a generation-error frame as a run-error event', async () => {
    globalThis.fetch = stubFetch(framesResponse([
      { type: 'generation-start' },
      { type: 'generation-error', error: 'model exploded' },
    ]));

    const backend = new HashbrownBackend({ url: 'http://hashbrown.test/run' }, new InMemoryTelemetrySink());
    const events = await collect(backend.run(baseInput()));
    const err = events.find((e): e is Extract<AgenticEvent, { type: 'run-error' }> => e.type === 'run-error');
    expect(err?.error.code).toBe('hashbrown_generation_error');
    expect(err?.error.message).toBe('model exploded');
  });

  it('yields run-error + telemetry when the wire request fails', async () => {
    globalThis.fetch = stubFetch(new Response('boom', { status: 500 }));
    const sink = new InMemoryTelemetrySink();

    const backend = new HashbrownBackend({ url: 'http://hashbrown.test/run' }, sink);
    const events = await collect(backend.run(baseInput()));

    const err = events.find((e): e is Extract<AgenticEvent, { type: 'run-error' }> => e.type === 'run-error');
    expect(err?.error.code).toBe('hashbrown_error');
    expect(sink.eventsByName('agentic.run.malformed_event').length).toBeGreaterThanOrEqual(1);
  });

  it('honours a pre-aborted signal — emits run-started + run-finished, no fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const backend = new HashbrownBackend({ url: 'http://hashbrown.test/run' }, new InMemoryTelemetrySink());
    const ac = new AbortController();
    ac.abort();
    const events = await collect(backend.run(baseInput({ signal: ac.signal })));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['run-started', 'run-finished']);
  });

  it('advertises capabilities (streaming + clientTools + generativeUi)', () => {
    const backend = new HashbrownBackend({ url: 'http://hashbrown.test/run' }, new InMemoryTelemetrySink());
    expect(backend.capabilities.streaming).toBe(true);
    expect(backend.capabilities.clientTools).toBe(true);
    expect(backend.capabilities.generativeUi).toBe(true);
    expect(backend.capabilities.uiActions).toBe(false);
  });
});
