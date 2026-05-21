import { describe, expect, it } from 'vitest';
import {
  mcpUiResourceSchema,
  mcpUiActionSchema,
  mcpUiMessageSchema,
  MCP_UI_HTML_MIME,
  MCP_UI_URI_LIST_MIME,
  MCP_UI_REMOTE_DOM_MIME,
} from './types';

describe('mcpUiResourceSchema', () => {
  it('accepts a text/html resource', () => {
    const r = mcpUiResourceSchema.safeParse({
      uri: 'ui://card/1', mimeType: MCP_UI_HTML_MIME, content: '<h1>hi</h1>',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a text/uri-list resource', () => {
    const r = mcpUiResourceSchema.safeParse({
      uri: 'ui://ext/1', mimeType: MCP_UI_URI_LIST_MIME, content: 'https://widgets.example.com/x',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a remote-dom resource (recognised, rendered later)', () => {
    const r = mcpUiResourceSchema.safeParse({
      uri: 'ui://rd/1', mimeType: MCP_UI_REMOTE_DOM_MIME, content: 'createElement(...)',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown mimeType', () => {
    const r = mcpUiResourceSchema.safeParse({
      uri: 'ui://x', mimeType: 'application/pdf', content: '…',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a resource missing uri', () => {
    const r = mcpUiResourceSchema.safeParse({ mimeType: MCP_UI_HTML_MIME, content: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('mcpUiActionSchema', () => {
  it('parses a tool action', () => {
    const r = mcpUiActionSchema.safeParse({ type: 'tool', payload: { toolName: 'doX', args: { a: 1 } } });
    expect(r.success).toBe(true);
  });

  it('parses a link action with target', () => {
    const r = mcpUiActionSchema.safeParse({ type: 'link', payload: { url: '/x', target: 'external' } });
    expect(r.success).toBe(true);
  });

  it('rejects a tool action missing toolName', () => {
    const r = mcpUiActionSchema.safeParse({ type: 'tool', payload: { args: {} } });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown action type', () => {
    const r = mcpUiActionSchema.safeParse({ type: 'exfiltrate', payload: {} });
    expect(r.success).toBe(false);
  });

  it('rejects a link with an invalid target enum', () => {
    const r = mcpUiActionSchema.safeParse({ type: 'link', payload: { url: '/x', target: 'top' } });
    expect(r.success).toBe(false);
  });
});

describe('mcpUiMessageSchema', () => {
  it('requires source: mcp-ui + a valid action', () => {
    expect(mcpUiMessageSchema.safeParse({
      source: 'mcp-ui', action: { type: 'tool', payload: { toolName: 'x' } },
    }).success).toBe(true);
  });

  it('rejects a message without the mcp-ui source marker', () => {
    expect(mcpUiMessageSchema.safeParse({
      source: 'other', action: { type: 'tool', payload: { toolName: 'x' } },
    }).success).toBe(false);
  });

  it('rejects a message with a malformed action', () => {
    expect(mcpUiMessageSchema.safeParse({
      source: 'mcp-ui', action: { type: 'tool', payload: {} },
    }).success).toBe(false);
  });
});
