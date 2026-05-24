import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import {
  AGENTIC_TELEMETRY_SINK,
  ToolRegistry,
  permissiveScopePolicy,
} from '../internal';
import { agenticTool } from '../factories/agentic-tool';
import { InMemoryTelemetrySink } from '../testing/in-memory-telemetry-sink';
import { McpUiActionBridge } from './mcp-ui-action-bridge';
import { MCP_UI_CONFIG, type McpUiConfig } from './config';
import type { McpAppRpcResponse } from './types';
import type { ToolDef } from '../types/registry-defs';

/**
 * Phase 1 — MCP-UI action-bridge spec. Asserts the security boundary:
 * origin allowlist, Zod validation, scope-gated tool dispatch, and the
 * delegate-to-host path for not-yet-first-class actions.
 */

function setup(config: Partial<McpUiConfig> = {}): {
  bridge: McpUiActionBridge;
  tools: ToolRegistry;
  sink: InMemoryTelemetrySink;
} {
  const sink = new InMemoryTelemetrySink();
  const fullConfig: McpUiConfig = {
    allowedOrigins: [],
    iframeSandbox: 'allow-scripts',
    ...config,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: AGENTIC_TELEMETRY_SINK, useValue: sink },
      { provide: MCP_UI_CONFIG, useValue: fullConfig },
    ],
  });
  let bridge!: McpUiActionBridge;
  let tools!: ToolRegistry;
  TestBed.runInInjectionContext(() => {
    bridge = TestBed.inject(McpUiActionBridge);
    tools = TestBed.inject(ToolRegistry);
  });
  return { bridge, tools, sink };
}

describe('McpUiActionBridge — tool dispatch + scope', () => {
  beforeEach(() => { /* fresh TestBed per setup() */ });

  it('dispatches a tool action when the tool is registered + in scope', async () => {
    const { bridge, tools } = setup();
    const handler = vi.fn(async () => ({ ok: true }));
    tools.register(agenticTool({
      name: 'doThing',
      description: 'does a thing',
      schema: z.object({ x: z.number() }),
      handler,
    }) as ToolDef);

    const result = bridge.dispatch({ type: 'tool', payload: { toolName: 'doThing', args: { x: 1 } } });
    expect(result.handled).toBe(true);
    expect(result.reason).toBe('dispatched');
    // Handler runs async; flush a microtask.
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith({ x: 1 }, expect.objectContaining({ toolCallId: expect.any(String) }));
  });

  it('refuses a tool the scope policy hides — no leak of existence', () => {
    const { bridge, tools, sink } = setup();
    tools.register({
      ...(agenticTool({
        name: 'adminOnly',
        description: 'privileged',
        schema: z.object({}),
        handler: async () => ({ ok: true }),
      }) as ToolDef),
      scopes: ['admin'],
    });
    // Scope policy that only surfaces tools scoped to 'paralegal'.
    tools.setScopePolicy((entry) => (entry.scopes ?? []).includes('paralegal'));

    const result = bridge.dispatch({ type: 'tool', payload: { toolName: 'adminOnly', args: {} } });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('tool-not-found');     // single reason — doesn't leak that it exists
    expect(sink.eventsByName('agentic.mcp_ui.action_blocked')).toHaveLength(1);
  });

  it('refuses a tool that does not exist', () => {
    const { bridge } = setup();
    const result = bridge.dispatch({ type: 'tool', payload: { toolName: 'ghost', args: {} } });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('tool-not-found');
  });

  it('restores the default permissive scope so unrelated tests are unaffected', () => {
    const { tools } = setup();
    tools.setScopePolicy(permissiveScopePolicy);
    expect(tools.list()).toEqual([]);
  });
});

describe('McpUiActionBridge — origin validation', () => {
  it('accepts inline-srcdoc messages (expectedOrigin = null)', () => {
    const { bridge, tools } = setup();
    tools.register(agenticTool({
      name: 'noop', description: 'x', schema: z.object({}), handler: async () => ({}),
    }) as ToolDef);
    const result = bridge.handleMessage(
      { data: { source: 'mcp-ui', action: { type: 'tool', payload: { toolName: 'noop' } } }, origin: 'null' },
      null,
    );
    expect(result.handled).toBe(true);
  });

  it('rejects a message whose origin does not match the expected origin', () => {
    const { bridge, sink } = setup({ allowedOrigins: ['https://widgets.example.com'] });
    const result = bridge.handleMessage(
      { data: { source: 'mcp-ui', action: { type: 'link', payload: { url: '/x' } } }, origin: 'https://evil.example.com' },
      'https://widgets.example.com',
    );
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('bad-origin');
    expect(sink.eventsByName('agentic.mcp_ui.action_blocked')).toHaveLength(1);
  });

  it('rejects an allowed-origin message when the origin is not on the allowlist', () => {
    const { bridge } = setup({ allowedOrigins: [] });   // empty allowlist
    const result = bridge.handleMessage(
      { data: { source: 'mcp-ui', action: { type: 'link', payload: { url: '/x' } } }, origin: 'https://widgets.example.com' },
      'https://widgets.example.com',
    );
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('bad-origin');
  });

  it('accepts an allowlisted external origin', () => {
    const { bridge } = setup({ allowedOrigins: ['https://widgets.example.com'] });
    bridge.setNavigator(() => undefined);
    const result = bridge.handleMessage(
      { data: { source: 'mcp-ui', action: { type: 'link', payload: { url: '/dash', target: 'router' } } }, origin: 'https://widgets.example.com' },
      'https://widgets.example.com',
    );
    expect(result.handled).toBe(true);
  });
});

describe('McpUiActionBridge — malformed payloads', () => {
  it('drops a non-mcp-ui message silently (no telemetry)', () => {
    const { bridge, sink } = setup();
    const result = bridge.handleMessage({ data: { hello: 'world' }, origin: 'null' }, null);
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('malformed-message');
    expect(sink.eventsByName('agentic.mcp_ui.action_blocked')).toHaveLength(0);
  });

  it('telemetries a malformed message that CLAIMS to be mcp-ui', () => {
    const { bridge, sink } = setup();
    const result = bridge.handleMessage({ data: { source: 'mcp-ui', action: { type: 'bogus' } }, origin: 'null' }, null);
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('malformed-message');
    expect(sink.eventsByName('agentic.mcp_ui.action_blocked')).toHaveLength(1);
  });
});

describe('McpUiActionBridge — MCP Apps (SEP-1865) JSON-RPC channel', () => {
  it('replies to ui/initialize with host capabilities + reports initialized', async () => {
    const { bridge } = setup();
    const replies: unknown[] = [];
    const result = await bridge.handleAppRpc(
      { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} },
      (r) => replies.push(r),
    );
    expect(result).toEqual({ handled: true, reason: 'initialized' });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: expect.objectContaining({ tools: expect.anything() }) },
    });
  });

  it('lists only scope-visible tools', async () => {
    const { bridge, tools } = setup();
    tools.register(agenticTool({ name: 'visible', description: 'd', schema: z.object({}), handler: async () => ({}) }) as ToolDef);
    tools.register({ ...(agenticTool({ name: 'hidden', description: 'd', schema: z.object({}), handler: async () => ({}) }) as ToolDef), scopes: ['admin'] });
    tools.setScopePolicy((e) => (e.scopes ?? []).length === 0);

    let listed: Array<{ name: string }> = [];
    await bridge.handleAppRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, (r) => {
      listed = (r.result as { tools: Array<{ name: string }> }).tools;
    });
    expect(listed.map((t) => t.name)).toEqual(['visible']);
  });

  it('invokes a scoped tool via tools/call and returns structuredContent', async () => {
    const { bridge, tools } = setup();
    const handler = vi.fn(async () => ({ bookingId: 'BK1', from: 'LAX' }));
    tools.register(agenticTool({ name: 'bookFlight', description: 'd', schema: z.object({ to: z.string() }), handler }) as ToolDef);

    let reply: McpAppRpcResponse | undefined;
    const result = await bridge.handleAppRpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bookFlight', arguments: { to: 'JFK' } } },
      (r) => { reply = r; },
    );
    expect(result.handled).toBe(true);
    expect(handler).toHaveBeenCalledWith({ to: 'JFK' }, expect.objectContaining({ toolCallId: expect.any(String) }));
    expect(reply?.result).toMatchObject({ structuredContent: { bookingId: 'BK1', from: 'LAX' } });
  });

  it('returns an isError result (not a leak) for an unknown/forbidden tool', async () => {
    const { bridge } = setup();
    let reply: McpAppRpcResponse | undefined;
    const result = await bridge.handleAppRpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ghost' } },
      (r) => { reply = r; },
    );
    expect(result.reason).toBe('tool-not-found');
    expect(reply?.result).toMatchObject({ isError: true });
  });

  it('routes ui/open-link through the navigator', async () => {
    const { bridge } = setup();
    const nav = vi.fn();
    bridge.setNavigator(nav);
    let reply: McpAppRpcResponse | undefined;
    await bridge.handleAppRpc(
      { jsonrpc: '2.0', id: 5, method: 'ui/open-link', params: { url: '/dash', target: 'router' } },
      (r) => { reply = r; },
    );
    expect(nav).toHaveBeenCalledWith('/dash');
    expect(reply?.result).toEqual({});
  });

  it('returns -32601 for an unknown method', async () => {
    const { bridge } = setup();
    let reply: McpAppRpcResponse | undefined;
    const result = await bridge.handleAppRpc(
      { jsonrpc: '2.0', id: 6, method: 'ui/bogus' },
      (r) => { reply = r; },
    );
    expect(result.reason).toBe('method-not-found');
    expect(reply?.error?.code).toBe(-32601);
  });

  it('does not reply to a notification (no id)', async () => {
    const { bridge } = setup();
    const replies: unknown[] = [];
    await bridge.handleAppRpc({ jsonrpc: '2.0', method: 'ui/initialize', params: {} }, (r) => replies.push(r));
    expect(replies).toHaveLength(0);
  });

  it('drops a non-JSON-RPC message', async () => {
    const { bridge } = setup();
    const result = await bridge.handleAppRpc({ hello: 'world' }, () => undefined);
    expect(result).toEqual({ handled: false, reason: 'malformed-message' });
  });
});

describe('McpUiActionBridge — link + delegated actions', () => {
  it('routes a link action through the navigator when wired', () => {
    const { bridge } = setup();
    const nav = vi.fn();
    bridge.setNavigator(nav);
    const result = bridge.dispatch({ type: 'link', payload: { url: '/dashboard', target: 'router' } });
    expect(result.handled).toBe(true);
    expect(nav).toHaveBeenCalledWith('/dashboard');
  });

  it('no-ops a router link when no navigator is wired', () => {
    const { bridge } = setup();
    const result = bridge.dispatch({ type: 'link', payload: { url: '/dashboard', target: 'router' } });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('no-router');
  });

  it('delegates intent / notify / prompt to the host handler', () => {
    const seen: string[] = [];
    const { bridge } = setup({ onUnhandledAction: (a) => seen.push(a.type) });
    expect(bridge.dispatch({ type: 'intent', payload: { intent: 'search' } }).reason).toBe('delegated-to-host');
    expect(bridge.dispatch({ type: 'notify', payload: { message: 'hi' } }).reason).toBe('delegated-to-host');
    expect(bridge.dispatch({ type: 'prompt', payload: { text: 'do x' } }).reason).toBe('delegated-to-host');
    expect(seen).toEqual(['intent', 'notify', 'prompt']);
  });
});
