import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToMcpSchema } from './zod-to-mcp-schema.js';

describe('zodToMcpSchema', () => {
  it('converts a simple object schema', () => {
    const schema = z.object({
      from: z.string().describe('Origin'),
      date: z.string(),
    });
    const out = zodToMcpSchema(schema, 'bookFlight');
    expect(out.type).toBe('object');
    expect(Object.keys(out.properties)).toEqual(['from', 'date']);
    expect(out.required).toContain('from');
  });

  it('strips MCP-incompatible top-level fields ($schema, definitions, title, description)', () => {
    const schema = z.object({ x: z.string() }).describe('A description');
    const out = zodToMcpSchema(schema, 'tool') as Record<string, unknown>;
    expect(out['$schema']).toBeUndefined();
    expect(out['$defs']).toBeUndefined();
    expect(out['definitions']).toBeUndefined();
    expect(out['description']).toBeUndefined();
    expect(out['title']).toBeUndefined();
  });

  it('throws on a non-object schema', () => {
    expect(() => zodToMcpSchema(z.string(), 'badTool')).toThrow(/non-object input schema/);
  });

  it('preserves enums and optional fields', () => {
    const schema = z.object({
      level: z.enum(['low', 'normal', 'high']).default('normal'),
      note: z.string().optional(),
    });
    const out = zodToMcpSchema(schema, 'showToast');
    expect(out.properties['level']).toBeDefined();
    expect(out.properties['note']).toBeDefined();
    // `note` is optional → not in `required`.
    expect(out.required ?? []).not.toContain('note');
  });

  it('always emits a properties object even when there are no fields', () => {
    const schema = z.object({});
    const out = zodToMcpSchema(schema, 'checkPoints');
    expect(out.properties).toBeDefined();
    expect(out.properties).toEqual({});
  });
});
