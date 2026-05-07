import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';

import type { AgenticEvent, AgenticMessage, ToolDef } from '../types';
import { agenticTool } from '../factories/agentic-tool';
import { OperationRegistry } from '../registries/operation-registry';
import { runUntilSettled } from './run-orchestrator';
import { FakeAgenticBackend } from '../testing/fake-agentic-backend';
import { InMemoryTelemetrySink } from '../testing/in-memory-telemetry-sink';

/**
 * Capability F5 — verify the LRO surface on ToolContext routes through
 * the OperationRegistry the chat shell wires (r3 plan §9.5).
 */
describe('runUntilSettled — F5 LRO ToolContext surface', () => {
  let registry: OperationRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(OperationRegistry);
    registry.clear();
  });

  function feedToolCall(backend: FakeAgenticBackend, name: string, args: object) {
    const events: AgenticEvent[] = [
      { type: 'tool-call-start', toolCallId: 'tc1', name },
      { type: 'tool-call-args', toolCallId: 'tc1', delta: JSON.stringify(args) },
      { type: 'tool-call-end', toolCallId: 'tc1' },
    ];
    backend.enqueueScript(events);
    backend.enqueueScript([{ type: 'text-delta', messageId: 'm2', delta: 'ok' }]);
  }

  it('startOperation mints a record bound to the active thread/run/toolCallId', async () => {
    let capturedOpId: string | undefined;
    const tool = agenticTool({
      name: 'runTAR',
      description: 'gated',
      schema: z.object({}),
      longRunning: true,
      handler: async (_args, ctx) => {
        capturedOpId = ctx.startOperation({ description: 'TAR classification', estDurationMs: 60000 });
        ctx.reportProgress(capturedOpId, { pct: 25, phase: 'phase 1' });
        ctx.completeOperation(capturedOpId, { scored: 100 });
        return { opId: capturedOpId };
      },
    }) as ToolDef;

    const backend = new FakeAgenticBackend();
    feedToolCall(backend, 'runTAR', {});
    const messages = signal<readonly AgenticMessage[]>([]);

    await runUntilSettled({
      backend,
      threadId: 't1',
      runId: 'r1',
      initialMessages: [],
      tools: [tool],
      widgets: [],
      messageStream: messages,
      maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry: new InMemoryTelemetrySink(),
      operationRegistry: registry,
    });

    expect(capturedOpId).toBeDefined();
    const op = registry.get(capturedOpId!)!;
    expect(op).toMatchObject({
      toolName: 'runTAR',
      description: 'TAR classification',
      status: 'finished',
      threadId: 't1',
      runId: 'r1',
      toolCallId: 'tc1',
      result: { scored: 100 },
    });
  });

  it('reportProgress + failOperation route through the registry', async () => {
    const tool = agenticTool({
      name: 'runTAR',
      description: 'gated',
      schema: z.object({}),
      longRunning: true,
      handler: async (_args, ctx) => {
        const opId = ctx.startOperation({ description: 'TAR' });
        ctx.reportProgress(opId, { pct: 50, phase: 'halfway' });
        ctx.failOperation(opId, { code: 'QUOTA', message: 'monthly cap reached' });
        return { opId };
      },
    }) as ToolDef;

    const backend = new FakeAgenticBackend();
    feedToolCall(backend, 'runTAR', {});
    const messages = signal<readonly AgenticMessage[]>([]);
    await runUntilSettled({
      backend,
      threadId: 't', runId: 'r',
      initialMessages: [], tools: [tool], widgets: [],
      messageStream: messages, maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry: new InMemoryTelemetrySink(),
      operationRegistry: registry,
    });

    const ops = registry.byStatus('failed');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      status: 'failed',
      pct: 50,
      phase: 'halfway',
      error: { code: 'QUOTA', message: 'monthly cap reached' },
    });
  });

  it('without an OperationRegistry, startOperation is a typed stub (no crash)', async () => {
    const tool = agenticTool({
      name: 'runTAR',
      description: 'gated',
      schema: z.object({}),
      longRunning: true,
      handler: async (_args, ctx) => {
        const opId = ctx.startOperation({ description: 'TAR' });
        ctx.reportProgress(opId, { pct: 25 });
        ctx.completeOperation(opId, 'done');
        return { opId };
      },
    }) as ToolDef;

    const backend = new FakeAgenticBackend();
    feedToolCall(backend, 'runTAR', {});
    const messages = signal<readonly AgenticMessage[]>([]);

    await expect(runUntilSettled({
      backend,
      threadId: 't', runId: 'r',
      initialMessages: [], tools: [tool], widgets: [],
      messageStream: messages, maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry: new InMemoryTelemetrySink(),
      // operationRegistry intentionally omitted
    })).resolves.toBeUndefined();
  });
});
