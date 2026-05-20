import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { z } from 'zod';
import type { AgenticEvent, AgenticMessage, ToolDef } from '../types';
import { agenticTool } from '../factories/agentic-tool';
import { runUntilSettled } from './run-orchestrator';
import { FakeAgenticBackend } from '../testing/fake-agentic-backend';
import { InMemoryTelemetrySink } from '../testing/in-memory-telemetry-sink';

/**
 * Slice L4 — orchestrator failure-mode coverage. Each test exercises
 * one branch the lib's pitch ("orchestration loop you don't write")
 * promises adopters get for free. None of these were tested before
 * this slice landed.
 *
 *   - Backend emits `run-error` mid-stream → run breaks, error
 *     surfaces on the transcript.
 *   - Tool handler throws → tool result carries `error: { code:
 *     'tool_error', message }`, run continues (next turn).
 *   - Multiple `tool-call-start` events before any `tool-call-end`
 *     (concurrent calls) → every call's handler runs.
 *   - Malformed JSON in `tool-call-args` → safeJson falls back to the
 *     raw string; the tool's Zod schema rejects + the handler is
 *     called with the parser's `.parse` throw recorded as
 *     tool_error.
 *   - Abort during tool execution → orchestrator unwinds, the
 *     handler's signal is signalled.
 *   - Stream ends without `run-finished` → orchestrator still
 *     processes any accumulated tool calls before settling.
 */

function defaultRunner(scriptFactory: () => readonly AgenticEvent[]) {
  return async function* (input: { threadId: string; runId: string }): AsyncIterable<AgenticEvent> {
    for (const ev of scriptFactory()) {
      yield ev;
    }
    void input;
  };
}

describe('runUntilSettled — L4 failure modes', () => {
  it('surfaces backend run-error and stops the loop', async () => {
    const backend = new FakeAgenticBackend();
    backend.useResponder(defaultRunner(() => [
      { type: 'text-delta', messageId: 'm', delta: 'hello' },
      { type: 'run-error', runId: 'r', error: { code: 'backend_error', message: 'wire blew up' } },
    ]));
    const messages = signal<readonly AgenticMessage[]>([]);
    const telemetry = new InMemoryTelemetrySink();

    await runUntilSettled({
      backend, threadId: 't', runId: 'r',
      initialMessages: [], tools: [], widgets: [],
      messageStream: messages, maxLocalTurns: 5,
      signal: new AbortController().signal, telemetry,
    });

    // Error surfaced into the transcript.
    const transcriptText = messages().map((m) => typeof m.content === 'string' ? m.content : '').join('\n');
    expect(transcriptText).toContain('wire blew up');
  });

  it('captures a thrown tool handler as tool_error and continues to next turn', async () => {
    const failingTool = agenticTool({
      name: 'fail',
      description: 'always throws',
      schema: z.object({}),
      handler: async () => { throw new Error('boom'); },
    });
    const backend = new FakeAgenticBackend();
    let runCount = 0;
    backend.useResponder(async function* (input) {
      runCount++;
      if (runCount === 1) {
        yield { type: 'tool-call-start', toolCallId: 'tc-1', name: 'fail' };
        yield { type: 'tool-call-args', toolCallId: 'tc-1', delta: '{}' };
        yield { type: 'tool-call-end', toolCallId: 'tc-1' };
        // No `run-finished` — orchestrator should still process the
        // accumulated call. This dual-purposes the test: covers both
        // "tool throws" and "stream ends without run-finished."
      } else {
        // The orchestrator runs another turn with the tool result
        // attached. End cleanly.
        yield { type: 'run-finished', runId: input.runId };
      }
    });
    const messages = signal<readonly AgenticMessage[]>([]);
    const telemetry = new InMemoryTelemetrySink();

    await runUntilSettled({
      backend, threadId: 't', runId: 'r',
      initialMessages: [], tools: [failingTool as ToolDef], widgets: [],
      messageStream: messages, maxLocalTurns: 5,
      signal: new AbortController().signal, telemetry,
    });

    // The orchestrator records a `tool-call-start` placeholder on one
    // message and the resolved result on a fresh message — both share
    // `toolCallId`. The settled version is the one that carries
    // result/error.
    const tc = messages()
      .flatMap((m) => m.toolCalls)
      .find((c) => c.toolCallId === 'tc-1' && (c.error !== undefined || c.result !== undefined));
    expect(tc?.error?.code).toBe('tool_error');
    expect(tc?.error?.message).toBe('boom');
  });

  it('executes multiple concurrent tool calls from a single turn', async () => {
    const calls: string[] = [];
    const echoA = agenticTool({
      name: 'echoA', description: 'echo A',
      schema: z.object({ v: z.string() }),
      handler: async (a) => { calls.push(`A:${a.v}`); return { ok: true, who: 'A' }; },
    });
    const echoB = agenticTool({
      name: 'echoB', description: 'echo B',
      schema: z.object({ v: z.string() }),
      handler: async (a) => { calls.push(`B:${a.v}`); return { ok: true, who: 'B' }; },
    });
    const backend = new FakeAgenticBackend();
    let nth = 0;
    backend.useResponder(async function* (input) {
      nth++;
      if (nth === 1) {
        // Two concurrent calls interleaved (start/start/args/args/end/end).
        yield { type: 'tool-call-start', toolCallId: 'tc-a', name: 'echoA' };
        yield { type: 'tool-call-start', toolCallId: 'tc-b', name: 'echoB' };
        yield { type: 'tool-call-args', toolCallId: 'tc-a', delta: '{"v":"x"}' };
        yield { type: 'tool-call-args', toolCallId: 'tc-b', delta: '{"v":"y"}' };
        yield { type: 'tool-call-end', toolCallId: 'tc-a' };
        yield { type: 'tool-call-end', toolCallId: 'tc-b' };
        yield { type: 'run-finished', runId: input.runId };
      } else {
        yield { type: 'run-finished', runId: input.runId };
      }
    });
    const messages = signal<readonly AgenticMessage[]>([]);

    await runUntilSettled({
      backend, threadId: 't', runId: 'r',
      initialMessages: [], tools: [echoA as ToolDef, echoB as ToolDef], widgets: [],
      messageStream: messages, maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry: new InMemoryTelemetrySink(),
    });

    expect(calls).toContain('A:x');
    expect(calls).toContain('B:y');
    const allCalls = messages().flatMap((m) => m.toolCalls);
    expect(allCalls.some((c) => c.toolCallId === 'tc-a' && (c.result as { who?: string })?.who === 'A')).toBe(true);
    expect(allCalls.some((c) => c.toolCallId === 'tc-b' && (c.result as { who?: string })?.who === 'B')).toBe(true);
  });

  it('falls back gracefully when tool-call-args carries non-JSON delta', async () => {
    const handler = vi.fn(async (_: unknown) => ({ ok: true }));
    const lenient = agenticTool({
      name: 'lenient',
      description: 'accepts string arg',
      schema: z.string(),
      handler,
    });
    const backend = new FakeAgenticBackend();
    let nth = 0;
    backend.useResponder(async function* (input) {
      nth++;
      if (nth === 1) {
        yield { type: 'tool-call-start', toolCallId: 'tc-1', name: 'lenient' };
        // Not JSON — `safeJson` returns the raw string.
        yield { type: 'tool-call-args', toolCallId: 'tc-1', delta: 'not-json-arg' };
        yield { type: 'tool-call-end', toolCallId: 'tc-1' };
        yield { type: 'run-finished', runId: input.runId };
      } else {
        yield { type: 'run-finished', runId: input.runId };
      }
    });
    const messages = signal<readonly AgenticMessage[]>([]);

    await runUntilSettled({
      backend, threadId: 't', runId: 'r',
      initialMessages: [], tools: [lenient as ToolDef], widgets: [],
      messageStream: messages, maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry: new InMemoryTelemetrySink(),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBe('not-json-arg');
  });

  it('captures tool_error when Zod rejects the parsed args', async () => {
    const strict = agenticTool({
      name: 'strict',
      description: 'needs an object with id:string',
      schema: z.object({ id: z.string() }),
      handler: async () => ({ ok: true }),
    });
    const backend = new FakeAgenticBackend();
    let nth = 0;
    backend.useResponder(async function* (input) {
      nth++;
      if (nth === 1) {
        yield { type: 'tool-call-start', toolCallId: 'tc-1', name: 'strict' };
        // Zod will reject: id is a number.
        yield { type: 'tool-call-args', toolCallId: 'tc-1', delta: '{"id":42}' };
        yield { type: 'tool-call-end', toolCallId: 'tc-1' };
        yield { type: 'run-finished', runId: input.runId };
      } else {
        yield { type: 'run-finished', runId: input.runId };
      }
    });
    const messages = signal<readonly AgenticMessage[]>([]);

    await runUntilSettled({
      backend, threadId: 't', runId: 'r',
      initialMessages: [], tools: [strict as ToolDef], widgets: [],
      messageStream: messages, maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry: new InMemoryTelemetrySink(),
    });

    // The orchestrator records a `tool-call-start` placeholder on one
    // message and the resolved result on a fresh message — both share
    // `toolCallId`. The settled version is the one that carries
    // result/error.
    const tc = messages()
      .flatMap((m) => m.toolCalls)
      .find((c) => c.toolCallId === 'tc-1' && (c.error !== undefined || c.result !== undefined));
    expect(tc?.error?.code).toBe('tool_error');
  });

  it('honours abort signal during tool execution', async () => {
    const slow = agenticTool({
      name: 'slow',
      description: 'waits on the signal',
      schema: z.object({}),
      handler: async (_, ctx) =>
        new Promise<{ ok: boolean }>((resolve, reject) => {
          if (ctx.signal.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
          ctx.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
          // Never resolves on its own — only the abort path unwinds.
          setTimeout(() => resolve({ ok: true }), 5_000);
        }),
    });
    const backend = new FakeAgenticBackend();
    backend.useResponder(async function* () {
      yield { type: 'tool-call-start', toolCallId: 'tc-1', name: 'slow' };
      yield { type: 'tool-call-args', toolCallId: 'tc-1', delta: '{}' };
      yield { type: 'tool-call-end', toolCallId: 'tc-1' };
    });
    const messages = signal<readonly AgenticMessage[]>([]);
    const ac = new AbortController();

    const run = runUntilSettled({
      backend, threadId: 't', runId: 'r',
      initialMessages: [], tools: [slow as ToolDef], widgets: [],
      messageStream: messages, maxLocalTurns: 5,
      signal: ac.signal,
      telemetry: new InMemoryTelemetrySink(),
    });

    // Abort once the tool has started.
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();

    // The handler's reject yields tool_error 'aborted'; the run unwinds
    // either via that error path or via the outer AbortError throw —
    // both are acceptable, and neither hangs.
    const result = await run.catch((err) => err);

    // The orchestrator records a `tool-call-start` placeholder on one
    // message and the resolved result on a fresh message — both share
    // `toolCallId`. The settled version is the one that carries
    // result/error.
    const tc = messages()
      .flatMap((m) => m.toolCalls)
      .find((c) => c.toolCallId === 'tc-1' && (c.error !== undefined || c.result !== undefined));
    if (tc) {
      expect(tc.error?.code).toBe('tool_error');
      expect(String(tc.error?.message)).toContain('aborted');
    } else {
      expect(result).toBeInstanceOf(Error);
    }
  });
});
