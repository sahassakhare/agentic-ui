import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ApprovalPolicy, ToolDef } from '@infra-tools/agentic-ui';
import { invokeWebMcpTool, syncRegistrations, type WebMcpInvokeDeps } from './web-mcp-invoke';
import type { NavigatorModelContext, WebMcpToolHandle, WebMcpToolRegistration } from './types';

/**
 * Phase 2 — pure-core spec for the WebMCP adapter. No Angular / TestBed:
 * the security-critical logic (scope gate, arg validation, approval
 * queueing, dispatch, registration diff) lives in pure functions so it
 * can be unit-tested directly. The DI shell (WebMcpService) is verified
 * by the package build. Matches the repo convention (cf.
 * agentic-ui-opa-authorizer testing pure compose logic).
 */

function makeTool(name: string, schema = z.object({}), handler = vi.fn(async () => ({ ok: true }))): ToolDef {
  return { name, description: name, schema, handler } as unknown as ToolDef;
}

function recordingTelemetry() {
  const events: Array<{ name: string; attrs?: Record<string, unknown> }> = [];
  return {
    sink: {
      emit: (name: string, attrs?: Record<string, unknown>) => events.push({ name, attrs }),
      startSpan: () => ({ end: () => {}, recordError: () => {}, setAttribute: () => {} }),
      counter: () => {},
      histogram: () => {},
    } as unknown as WebMcpInvokeDeps['telemetry'],
    events,
    named: (n: string) => events.filter((e) => e.name === n),
  };
}

function deps(over: Partial<WebMcpInvokeDeps> = {}): { d: WebMcpInvokeDeps; tel: ReturnType<typeof recordingTelemetry> } {
  const tel = recordingTelemetry();
  const d: WebMcpInvokeDeps = {
    getTool: () => undefined,
    getApproval: () => undefined,
    enqueueApproval: () => 'appr-1',
    persona: () => 'webmcp',
    telemetry: tel.sink,
    ...over,
  };
  return { d, tel };
}

describe('invokeWebMcpTool — scope gate', () => {
  it('refuses a tool the scope policy hides (single reason, no leak)', async () => {
    const { d, tel } = deps({ getTool: () => undefined });
    const result = await invokeWebMcpTool(d, 'ghostOrHidden', {});
    expect(result.isError).toBe(true);
    expect(tel.named('agentic.webmcp.call_blocked')).toHaveLength(1);
    expect(tel.named('agentic.webmcp.call_blocked')[0]?.attrs?.['agentic.webmcp.block_reason'])
      .toBe('tool-not-found-or-scoped');
  });
});

describe('invokeWebMcpTool — arg validation', () => {
  it('returns an error result when args fail the Zod schema', async () => {
    const tool = makeTool('strict', z.object({ id: z.string() }));
    const { d } = deps({ getTool: () => tool });
    const result = await invokeWebMcpTool(d, 'strict', { id: 42 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments');
  });

  it('executes when args are valid and returns structuredContent', async () => {
    const handler = vi.fn(async (a: { x: number }) => ({ doubled: a.x * 2 }));
    const tool = makeTool('double', z.object({ x: z.number() }), handler);
    const { d, tel } = deps({ getTool: () => tool });
    const result = await invokeWebMcpTool(d, 'double', { x: 21 });
    expect(handler).toHaveBeenCalledWith({ x: 21 }, expect.objectContaining({ toolCallId: expect.any(String) }));
    expect(result.structuredContent).toEqual({ doubled: 42 });
    expect(tel.named('agentic.tool_call.start')).toHaveLength(1);
    expect(tel.named('agentic.tool_call.end')[0]?.attrs?.['agentic.tool.success']).toBe(true);
  });

  it('captures a thrown handler as an error result', async () => {
    const tool = makeTool('boom', z.object({}), vi.fn(async () => { throw new Error('kaboom'); }));
    const { d, tel } = deps({ getTool: () => tool });
    const result = await invokeWebMcpTool(d, 'boom', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('kaboom');
    expect(tel.named('agentic.tool_call.end')[0]?.attrs?.['agentic.tool.success']).toBe(false);
  });
});

describe('invokeWebMcpTool — approval gate', () => {
  const policy: ApprovalPolicy = {
    tool: 'release',
    required: (_args, ctx) => ctx.persona === 'paralegal',
    approverRoles: ['lead-counsel'],
    diffRenderer: 'noop',
    signoffMessage: () => 'Approve release?',
  };

  it('queues an approval (and does NOT execute) when required() is true', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const enqueueApproval = vi.fn(() => 'appr-xyz');
    const tool = makeTool('release', z.object({ id: z.string() }), handler);
    const { d, tel } = deps({
      getTool: () => tool,
      getApproval: () => policy,
      enqueueApproval,
      persona: () => 'paralegal',
    });
    const result = await invokeWebMcpTool(d, 'release', { id: 'HOLD-1' });
    expect(handler).not.toHaveBeenCalled();
    expect(enqueueApproval).toHaveBeenCalledOnce();
    expect((result.structuredContent as { status?: string })?.status).toBe('pending-approval');
    expect(tel.named('agentic.webmcp.call_queued_for_approval')).toHaveLength(1);
  });

  it('executes normally when required() is false (lead-counsel)', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const tool = makeTool('release', z.object({ id: z.string() }), handler);
    const { d } = deps({ getTool: () => tool, getApproval: () => policy, persona: () => 'lead-counsel' });
    await invokeWebMcpTool(d, 'release', { id: 'HOLD-1' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fails closed (queues) when the required() predicate throws', async () => {
    const throwingPolicy: ApprovalPolicy = { ...policy, required: () => { throw new Error('bad predicate'); } };
    const handler = vi.fn(async () => ({ ok: true }));
    const enqueueApproval = vi.fn(() => 'appr-fail-closed');
    const tool = makeTool('release', z.object({ id: z.string() }), handler);
    const { d } = deps({ getTool: () => tool, getApproval: () => throwingPolicy, enqueueApproval });
    const result = await invokeWebMcpTool(d, 'release', { id: 'X' });
    expect(handler).not.toHaveBeenCalled();
    expect(enqueueApproval).toHaveBeenCalledOnce();
    expect((result.structuredContent as { status?: string })?.status).toBe('pending-approval');
  });
});

describe('syncRegistrations', () => {
  function mockMc(): { mc: NavigatorModelContext; registered: Map<string, WebMcpToolRegistration> } {
    const registered = new Map<string, WebMcpToolRegistration>();
    const mc: NavigatorModelContext = {
      registerTool: (t): WebMcpToolHandle => {
        registered.set(t.name, t);
        return { unregister: () => registered.delete(t.name) };
      },
    };
    return { mc, registered };
  }

  it('registers newly-visible tools with a JSON-Schema inputSchema', () => {
    const { mc, registered } = mockMc();
    const handles = new Map<string, WebMcpToolHandle>();
    syncRegistrations(mc, [makeTool('searchDocs', z.object({ q: z.string() }))], handles, () => async () => ({ content: [] }));
    expect(registered.has('searchDocs')).toBe(true);
    expect(registered.get('searchDocs')?.inputSchema).toMatchObject({ type: 'object' });
    expect(handles.has('searchDocs')).toBe(true);
  });

  it('unregisters tools no longer visible', () => {
    const { mc, registered } = mockMc();
    const handles = new Map<string, WebMcpToolHandle>();
    const make = () => async () => ({ content: [] });
    syncRegistrations(mc, [makeTool('a'), makeTool('b')], handles, make);
    expect(registered.size).toBe(2);
    // 'b' vanishes from the visible set.
    syncRegistrations(mc, [makeTool('a')], handles, make);
    expect(registered.has('a')).toBe(true);
    expect(registered.has('b')).toBe(false);
    expect(handles.has('b')).toBe(false);
  });

  it('is idempotent — re-syncing the same set does not re-register', () => {
    const { mc, registered } = mockMc();
    const handles = new Map<string, WebMcpToolHandle>();
    const registerSpy = vi.spyOn(mc, 'registerTool');
    const make = () => async () => ({ content: [] });
    syncRegistrations(mc, [makeTool('a')], handles, make);
    syncRegistrations(mc, [makeTool('a')], handles, make);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registered.size).toBe(1);
  });
});
