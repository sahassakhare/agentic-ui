import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { z } from 'zod';
import type { AgenticEvent, AgenticMessage, ToolDef } from '../types';
import { agenticTool } from '../factories/agentic-tool';
import { runUntilSettled } from './run-orchestrator';
import { FakeAgenticBackend } from '../testing/fake-agentic-backend';
import { InMemoryTelemetrySink } from '../testing/in-memory-telemetry-sink';

describe('runUntilSettled', () => {
  it('streams text deltas into the message stream', async () => {
    const backend = new FakeAgenticBackend();
    backend.enqueueScript([
      { type: 'text-delta', messageId: 'm1', delta: 'Hello' },
      { type: 'text-delta', messageId: 'm1', delta: ' world' },
      { type: 'text-end', messageId: 'm1' },
    ]);
    const messages = signal<readonly AgenticMessage[]>([]);
    const ac = new AbortController();
    const telemetry = new InMemoryTelemetrySink();

    await runUntilSettled({
      backend,
      threadId: 't1',
      runId: 'r1',
      initialMessages: [],
      tools: [],
      widgets: [],
      messageStream: messages,
      maxLocalTurns: 5,
      signal: ac.signal,
      telemetry,
    });

    const [m] = messages();
    expect(m?.content).toBe('Hello world');
    expect(telemetry.hasSpan('agentic.run.start')).toBe(true);
  });

  it('executes a client tool when its tool-call-end is observed', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const tool = agenticTool({
      name: 'add',
      description: 'add two numbers',
      schema: z.object({ a: z.number(), b: z.number() }),
      handler: async (args) => {
        calls.push({ name: 'add', args });
        return args.a + args.b;
      },
    });

    const backend = new FakeAgenticBackend();
    const events: AgenticEvent[] = [
      { type: 'tool-call-start', toolCallId: 'tc1', name: 'add' },
      { type: 'tool-call-args', toolCallId: 'tc1', delta: '{"a":2,"b":3}' },
      { type: 'tool-call-end', toolCallId: 'tc1' },
    ];
    backend.enqueueScript(events);
    backend.enqueueScript([{ type: 'text-delta', messageId: 'm2', delta: 'done' }]);

    const messages = signal<readonly AgenticMessage[]>([]);
    const telemetry = new InMemoryTelemetrySink();

    await runUntilSettled({
      backend,
      threadId: 't1',
      runId: 'r1',
      initialMessages: [],
      tools: [tool as ToolDef],
      widgets: [],
      messageStream: messages,
      maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry,
    });

    expect(calls).toEqual([{ name: 'add', args: { a: 2, b: 3 } }]);
    expect(telemetry.hasSpan('agentic.tool_call.start')).toBe(true);
  });
});
