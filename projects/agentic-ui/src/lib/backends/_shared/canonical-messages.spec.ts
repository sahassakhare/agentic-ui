import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { agenticTool } from '../../factories/agentic-tool';
import type { ToolDef } from '../../internal';
import {
  flattenContentToString,
  serializeToolsForWire,
} from './canonical-messages';

describe('flattenContentToString', () => {
  it('passes through a string verbatim', () => {
    expect(flattenContentToString('hello')).toBe('hello');
  });

  it('concatenates text parts with newlines', () => {
    expect(flattenContentToString([
      { kind: 'text', text: 'one' },
      { kind: 'text', text: 'two' },
    ])).toBe('one\ntwo');
  });

  it('markers images with alt + mimeType', () => {
    expect(flattenContentToString([
      { kind: 'image', mimeType: 'image/png', data: 'data:...', alt: 'logo' },
    ])).toBe('[image: logo (image/png)]');
  });

  it('markers files with filename + size', () => {
    expect(flattenContentToString([
      { kind: 'file', mimeType: 'application/pdf', filename: 'doc.pdf', uri: 'x', sizeBytes: 12345 },
    ])).toBe('[file: doc.pdf · 12345B]');
  });

  it('omits the size marker when sizeBytes is absent', () => {
    expect(flattenContentToString([
      { kind: 'file', mimeType: 'application/pdf', filename: 'doc.pdf', uri: 'x' },
    ])).toBe('[file: doc.pdf]');
  });

  it('mixes text + image + file in order', () => {
    expect(flattenContentToString([
      { kind: 'text', text: 'look at this' },
      { kind: 'image', mimeType: 'image/jpeg', data: 'x' },
      { kind: 'file', mimeType: 'text/plain', filename: 'notes.txt', uri: 'x' },
    ])).toBe('look at this\n[image (image/jpeg)]\n[file: notes.txt]');
  });
});

describe('serializeToolsForWire', () => {
  it('emits the full JSON-Schema for each tool', () => {
    const t1 = agenticTool({
      name: 'searchDocs',
      description: 'free-text search',
      schema: z.object({
        q: z.string(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      handler: async () => ({ ok: true }),
    });
    const [wire] = serializeToolsForWire([t1 as unknown as ToolDef]);
    expect(wire?.name).toBe('searchDocs');
    expect(wire?.description).toBe('free-text search');
    // Closes the L1 bug — pre-L1 Hashbrown + A2UI dropped this.
    const params = wire?.parameters as { properties?: Record<string, unknown> };
    expect(params.properties?.['q']).toBeDefined();
    expect(params.properties?.['limit']).toBeDefined();
  });

  it('preserves Zod refinements in the schema (min/max/optional)', () => {
    const t = agenticTool({
      name: 'tagDocument',
      description: 'tag a doc',
      schema: z.object({
        documentId: z.string(),
        tags: z.array(z.string()).min(1),
      }),
      handler: async () => ({ ok: true }),
    });
    const [wire] = serializeToolsForWire([t as unknown as ToolDef]);
    const params = wire?.parameters as {
      properties?: { tags?: { minItems?: number } };
      required?: string[];
    };
    expect(params.required).toContain('documentId');
    expect(params.required).toContain('tags');
    expect(params.properties?.tags?.minItems).toBe(1);
  });

  it('returns an empty array for empty input', () => {
    expect(serializeToolsForWire([])).toEqual([]);
  });
});
