import { describe, expect, it, vi } from 'vitest';
import { getModelContext } from './types';
import { zodToWebMcpSchema } from './zod-bridge';
import { syntheticToolContext } from './synthetic-context';
import { z } from 'zod';

/**
 * Phase 2 — WebMCP adapter unit tests. The DI-driven `provideWebMcp`
 * registration loop is exercised by the integration spec
 * (web-mcp-service.spec.ts) with a TestBed harness; this file covers
 * the pure helpers + feature detection.
 */

describe('getModelContext — feature detection', () => {
  it('returns null when navigator is absent', () => {
    expect(getModelContext(undefined)).toBeNull();
  });

  it('returns null when navigator.modelContext is absent', () => {
    expect(getModelContext({})).toBeNull();
  });

  it('returns null when registerTool is not a function', () => {
    expect(getModelContext({ modelContext: { registerTool: 'nope' } })).toBeNull();
  });

  it('returns the modelContext when registerTool is present', () => {
    const mc = { registerTool: vi.fn() };
    expect(getModelContext({ modelContext: mc })).toBe(mc);
  });
});

describe('zodToWebMcpSchema', () => {
  it('produces an object schema with properties + required', () => {
    const schema = zodToWebMcpSchema(z.object({ q: z.string(), limit: z.number().optional() }));
    expect(schema.type).toBe('object');
    expect(schema.properties['q']).toBeDefined();
    expect(schema.properties['limit']).toBeDefined();
    expect(schema.required).toContain('q');
    expect(schema.required ?? []).not.toContain('limit');
  });

  it('strips $schema / definitions / description', () => {
    const raw = zodToWebMcpSchema(z.object({ a: z.string() })) as unknown as Record<string, unknown>;
    expect(raw['$schema']).toBeUndefined();
    expect(raw['definitions']).toBeUndefined();
    expect(raw['description']).toBeUndefined();
  });

  it('falls back to a permissive object schema for a non-object Zod type', () => {
    const schema = zodToWebMcpSchema(z.string());
    expect(schema.type).toBe('object');
    expect(schema.properties).toEqual({});
    expect(schema.additionalProperties).toBe(true);
  });
});

describe('syntheticToolContext', () => {
  it('builds a ToolContext with no-op LRO methods', () => {
    const ctx = syntheticToolContext({
      threadId: 't', runId: 'r', toolCallId: 'tc', signal: new AbortController().signal,
    });
    expect(ctx.threadId).toBe('t');
    expect(ctx.runId).toBe('r');
    expect(ctx.toolCallId).toBe('tc');
    expect(typeof ctx.startOperation).toBe('function');
    // LRO methods don't throw.
    expect(() => {
      const op = ctx.startOperation({ description: 'x' });
      ctx.reportProgress(op, { pct: 50 });
      ctx.completeOperation(op, {});
      ctx.failOperation(op, { code: 'x', message: 'y' });
    }).not.toThrow();
  });
});
