import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { z } from 'zod';

import type { AgenticEvent, AgenticMessage, ToolDef } from '../types';
import { agenticApproval } from '../factories/agentic-approval';
import { agenticTool } from '../factories/agentic-tool';
import { ApprovalRegistry } from '../registries/approval-registry';
import { runUntilSettled } from './run-orchestrator';
import { FakeAgenticBackend } from '../testing/fake-agentic-backend';
import { InMemoryTelemetrySink } from '../testing/in-memory-telemetry-sink';

/**
 * Capability F4 — chat-shell intercept tests (r3 plan §9.4).
 *
 * Runs the same `runUntilSettled` engine as the existing tool-call test,
 * but with an `ApprovalRegistry` wired in. Asserts that a tool call
 * matching a registered policy is NOT executed; instead a pending
 * Approval is enqueued and a synthetic queued result lands on the
 * tool-call message.
 */
describe('runUntilSettled — F4 approval intercept', () => {
  let registry: ApprovalRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ApprovalRegistry);
    registry.clearApprovals();
  });

  function setupGatedTool() {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const tool = agenticTool({
      name: 'exportProductionSet',
      description: 'gated',
      schema: z.object({ productionId: z.string() }),
      handler,
    }) as ToolDef;
    return { tool, handler };
  }

  function feedToolCall(backend: FakeAgenticBackend, toolName: string, args: object) {
    const events: AgenticEvent[] = [
      { type: 'tool-call-start', toolCallId: 'tc1', name: toolName },
      { type: 'tool-call-args', toolCallId: 'tc1', delta: JSON.stringify(args) },
      { type: 'tool-call-end', toolCallId: 'tc1' },
    ];
    backend.enqueueScript(events);
    // Settle the run after the synthetic result is attached.
    backend.enqueueScript([{ type: 'text-delta', messageId: 'm2', delta: 'queued' }]);
  }

  it('queues a tool call when the policy returns required=true', async () => {
    const { tool, handler } = setupGatedTool();
    registry.register(
      agenticApproval({
        tool: 'exportProductionSet',
        required: () => true,
        approverRoles: ['lead-counsel'],
        diffRenderer: 'diff-widget',
        signoffMessage: (args) =>
          `Approve delivery of ${(args as { productionId: string }).productionId}?`,
      }),
    );
    const backend = new FakeAgenticBackend();
    feedToolCall(backend, 'exportProductionSet', { productionId: 'PROD-001' });

    const messages = signal<readonly AgenticMessage[]>([]);
    const telemetry = new InMemoryTelemetrySink();

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
      telemetry,
      approvalRegistry: registry,
      activePersona: () => 'paralegal',
    });

    // Tool MUST NOT have executed.
    expect(handler).not.toHaveBeenCalled();

    // ApprovalRegistry holds a single pending record matching the call.
    const pending = registry.byStatus('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      toolName: 'exportProductionSet',
      args: { productionId: 'PROD-001' },
      requesterPersona: 'paralegal',
      status: 'pending',
    });
    expect(pending[0].continuationHandle).toEqual({
      threadId: 't1',
      runId: 'r1',
      toolCallId: 'tc1',
    });

    // The synthetic result landed on a tool call attached to the message
    // graph so the LLM sees it next turn.
    const allCalls = messages().flatMap((m) => m.toolCalls);
    const withResult = allCalls.find((tc) => tc.toolCallId === 'tc1' && tc.result !== undefined);
    expect(withResult?.result).toMatchObject({
      queued: true,
      status: 'pending-approval',
      approvalId: pending[0].id,
    });

    // The synthetic result attached a `mvk-approval-card` widget.
    const widgets = messages().flatMap((m) => m.widgets);
    expect(widgets.some((w) => w.name === 'mvk-approval-card')).toBe(true);
  });

  it('does NOT queue when required(args, ctx) returns false', async () => {
    const { tool, handler } = setupGatedTool();
    registry.register(
      agenticApproval({
        tool: 'exportProductionSet',
        required: (_args, ctx) => ctx.persona !== 'lead-counsel',
        approverRoles: ['lead-counsel'],
        diffRenderer: 'diff',
        signoffMessage: () => 'Approve?',
      }),
    );
    const backend = new FakeAgenticBackend();
    feedToolCall(backend, 'exportProductionSet', { productionId: 'PROD-002' });

    const messages = signal<readonly AgenticMessage[]>([]);
    await runUntilSettled({
      backend,
      threadId: 't',
      runId: 'r',
      initialMessages: [],
      tools: [tool],
      widgets: [],
      messageStream: messages,
      maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry: new InMemoryTelemetrySink(),
      approvalRegistry: registry,
      // Active persona is the same as the approver role → policy returns false.
      activePersona: () => 'lead-counsel',
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(registry.byStatus('pending')).toEqual([]);
  });

  it('does not intercept tools that have no policy registered', async () => {
    const { tool, handler } = setupGatedTool();
    // No approval policy registered.
    const backend = new FakeAgenticBackend();
    feedToolCall(backend, 'exportProductionSet', { productionId: 'PROD-003' });

    const messages = signal<readonly AgenticMessage[]>([]);
    await runUntilSettled({
      backend,
      threadId: 't',
      runId: 'r',
      initialMessages: [],
      tools: [tool],
      widgets: [],
      messageStream: messages,
      maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry: new InMemoryTelemetrySink(),
      approvalRegistry: registry,
      activePersona: () => 'paralegal',
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(registry.byStatus('pending')).toEqual([]);
  });

  it('fails closed (queues) when the predicate throws', async () => {
    const { tool, handler } = setupGatedTool();
    registry.register(
      agenticApproval({
        tool: 'exportProductionSet',
        required: () => { throw new Error('predicate bug'); },
        approverRoles: ['lead-counsel'],
        diffRenderer: 'diff',
        signoffMessage: () => 'Approve?',
      }),
    );
    const backend = new FakeAgenticBackend();
    feedToolCall(backend, 'exportProductionSet', { productionId: 'PROD-004' });

    const messages = signal<readonly AgenticMessage[]>([]);
    await runUntilSettled({
      backend,
      threadId: 't',
      runId: 'r',
      initialMessages: [],
      tools: [tool],
      widgets: [],
      messageStream: messages,
      maxLocalTurns: 5,
      signal: new AbortController().signal,
      telemetry: new InMemoryTelemetrySink(),
      approvalRegistry: registry,
      activePersona: () => 'paralegal',
    });

    expect(handler).not.toHaveBeenCalled();
    expect(registry.byStatus('pending')).toHaveLength(1);
  });
});
