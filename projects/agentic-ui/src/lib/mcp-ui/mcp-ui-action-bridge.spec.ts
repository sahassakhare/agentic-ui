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
