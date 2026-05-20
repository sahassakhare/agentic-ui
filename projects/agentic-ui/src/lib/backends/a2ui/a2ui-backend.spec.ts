import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { agenticTool } from '../../factories/agentic-tool';
import { A2uiBackend, type UiActionDispatcher } from './a2ui-backend';
import { InMemoryTelemetrySink } from '../../testing/in-memory-telemetry-sink';
import type { AgenticEvent, AgenticMessage, ToolDef } from '../../internal';

/**
 * Slice L1 — A2UI adapter spec. Asserts the parity contract:
 *   - Tools posted with full JSON-Schema parameters
 *   - `state` field threaded per ADR-013
 *   - Inbound NDJSON Zod-validated; malformed lines telemetry'd + dropped
 *   - `ui-action` events route to the dispatcher with the LIVE threadId
 *     and runId (was: hardcoded empty strings — audit attribution broken)
 */

function ndjsonReadable(events: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const ev of events) {
        controller.enqueue(enc.encode(JSON.stringify(ev) + '\n'));
      }
      controller.close();
    },
  });
}

function ndjsonResponse(events: unknown[]): Response {
  return new Response(ndjsonReadable(events), {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

let lastRequest: { url: string; body: unknown } | null = null;

function stubFetch(response: Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    lastRequest = { url, body };
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

const noopDispatcher: UiActionDispatcher = { dispatch: async () => undefined };

describe('A2uiBackend — L1 parity', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    lastRequest = null;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts tools with their full JSON-Schema parameters (was: dropped)', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([{ type: 'run-finished', runId: 'r-1' }]));

    const tool = agenticTool({
      name: 'tagDoc',
      description: 'tag a document',
      schema: z.object({ id: z.string(), tag: z.string() }),
      handler: async () => ({ ok: true }),
    });
    const backend = new A2uiBackend(
      { url: 'http://a2ui.test/run' },
      noopDispatcher,
      new InMemoryTelemetrySink(),
    );

    await collect(backend.run(baseInput({ tools: [tool] as unknown as ToolDef[] })));

    const tools = (lastRequest?.body as { tools: Array<{ name: string; parameters: { properties?: Record<string, unknown> } }> }).tools;
    expect(tools[0]?.parameters?.properties?.['id']).toBeDefined();
    expect(tools[0]?.parameters?.properties?.['tag']).toBeDefined();
  });

  it('threads the host `state` field', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([{ type: 'run-finished', runId: 'r-1' }]));

    const backend = new A2uiBackend(
      { url: 'http://a2ui.test/run' },
      noopDispatcher,
      new InMemoryTelemetrySink(),
    );

    await collect(backend.run(baseInput({
      state: { persona: 'paralegal', route: '/documents' },
    })));

    const state = (lastRequest?.body as { state: Record<string, unknown> }).state;
    expect(state['persona']).toBe('paralegal');
    expect(state['route']).toBe('/documents');
  });

  it('posts the configured specVersion', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([{ type: 'run-finished', runId: 'r-1' }]));
    const backend = new A2uiBackend(
      { url: 'http://a2ui.test/run', specVersion: '1.0-rc.3' },
      noopDispatcher,
      new InMemoryTelemetrySink(),
    );
    await collect(backend.run(baseInput()));
    expect((lastRequest?.body as { specVersion: string }).specVersion).toBe('1.0-rc.3');
  });

  it('dispatches ui-action events with the LIVE threadId + runId (L1 fix)', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([
      { type: 'ui-action', actionId: 'act-1', op: 'navigate', payload: { to: '/x' } },
      { type: 'run-finished', runId: 'r-1' },
    ]));

    const dispatchCalls: Array<{ actionId: string; op: string; payload: unknown; threadId: string; runId: string }> = [];
    const dispatcher: UiActionDispatcher = {
      dispatch: async (args) => {
        const { actionId, op, payload, threadId, runId } = args;
        dispatchCalls.push({ actionId, op, payload, threadId, runId });
      },
    };

    const backend = new A2uiBackend(
      { url: 'http://a2ui.test/run' },
      dispatcher,
      new InMemoryTelemetrySink(),
    );

    await collect(backend.run(baseInput({ threadId: 't-live', runId: 'r-live' })));

    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]).toMatchObject({
      actionId: 'act-1',
      op: 'navigate',
      threadId: 't-live',     // was: '' before L1
      runId: 'r-live',        // was: '' before L1
    });
  });

  it('drops malformed NDJSON lines with telemetry', async () => {
    globalThis.fetch = stubFetch(ndjsonResponse([
      { type: 'ui-action', op: 'click' },  // missing actionId + payload
      { type: 'text-delta', messageId: 'm-1', delta: 'valid' },
      { type: 'run-finished', runId: 'r-1' },
    ]));
    const sink = new InMemoryTelemetrySink();

    const backend = new A2uiBackend(
      { url: 'http://a2ui.test/run' },
      noopDispatcher,
      sink,
    );

    const events = await collect(backend.run(baseInput()));
    expect(events.some((e) => e.type === 'text-delta')).toBe(true);
    const malformed = sink.eventsByName('agentic.run.malformed_event');
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.attributes?.['agentic.backend.id']).toBe('a2ui');
    expect(malformed[0]?.attributes?.['agentic.event.type']).toBe('ui-action');
  });

  it('yields run-error when the wire request fails', async () => {
    globalThis.fetch = stubFetch(new Response('boom', { status: 502 }));

    const backend = new A2uiBackend(
      { url: 'http://a2ui.test/run' },
      noopDispatcher,
      new InMemoryTelemetrySink(),
    );

    const events = await collect(backend.run(baseInput()));
    const err = events.find((e): e is Extract<AgenticEvent, { type: 'run-error' }> => e.type === 'run-error');
    expect(err?.error.code).toBe('a2ui_error');
  });

  it('advertises capabilities (streaming + clientTools + generativeUi + uiActions)', () => {
    const backend = new A2uiBackend(
      { url: 'http://a2ui.test/run' },
      noopDispatcher,
      new InMemoryTelemetrySink(),
    );
    expect(backend.capabilities.uiActions).toBe(true);
    expect(backend.capabilities.streaming).toBe(true);
    expect(backend.capabilities.clientTools).toBe(true);
    expect(backend.capabilities.generativeUi).toBe(true);
  });
});
