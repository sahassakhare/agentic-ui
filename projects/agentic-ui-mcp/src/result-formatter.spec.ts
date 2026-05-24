import { describe, expect, it } from 'vitest';
import { formatToolResult, MCP_UI_HTML_MIME } from './result-formatter.js';
// Cross-package conformance: validate this server's MCP-UI output against
// the INBOUND renderer's schema + mime constant in `@infra-tools/agentic-ui`.
// We import the schema's pure source directly because the published Angular
// bundle can't be loaded in a plain Node test (JIT). Both are pure Zod, so
// this is a faithful round-trip check that the two packages can't drift.
import {
  mcpUiResourceSchema,
  MCP_UI_HTML_MIME as INBOUND_MCP_UI_HTML_MIME,
} from '../../agentic-ui/src/lib/mcp-ui/types';

describe('formatToolResult precedence', () => {
  it('returns a single text block for a markdown-only result', () => {
    const out = formatToolResult({ markdown: '**hello**', other: 1 });
    expect(out).toEqual([{ type: 'text', text: '**hello**' }]);
  });

  it("emits markdown image syntax for an image_url-only result", () => {
    const out = formatToolResult({ image_url: 'https://example.com/x.png' });
    expect(out).toEqual([{ type: 'text', text: '![](https://example.com/x.png)' }]);
  });

  it('combines markdown + image_url with image appended at the end', () => {
    const out = formatToolResult({ markdown: 'See below.', image_url: 'https://x/y.png' });
    expect(out).toEqual([{ type: 'text', text: 'See below.\n\n![](https://x/y.png)' }]);
  });

  it('falls back to JSON-stringified domain data when no render hints are present', () => {
    const out = formatToolResult({ bookingId: 'BK-001', from: 'LAX', to: 'JFK' });
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('text');
    const parsed = JSON.parse(out[0]?.text ?? '{}');
    expect(parsed).toEqual({ bookingId: 'BK-001', from: 'LAX', to: 'JFK' });
  });

  it('strips render-hint fields from the JSON fallback so the LLM only sees domain data', () => {
    // Result has render hints (`components`, reserved `iframe_url`) but
    // no `html` / `markdown` / `image_url` — falls through to JSON.
    const out = formatToolResult({
      bookingId: 'BK-002',
      components: [{ name: 'flightCard', props: {} }],
      iframe_url: 'https://x',
    });
    const text = (out[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed).toEqual({ bookingId: 'BK-002' });
    expect(parsed.components).toBeUndefined();
    expect(parsed.iframe_url).toBeUndefined();
  });

  it('handles primitive results', () => {
    // Raw string returned as-is — tools returning 'OK' should render
    // 'OK' not '"OK"'.
    expect(formatToolResult('hello')).toEqual([{ type: 'text', text: 'hello' }]);
    // null/undefined edge cases
    expect(formatToolResult(null)).toEqual([{ type: 'text', text: 'null' }]);
    expect(formatToolResult(undefined)).toEqual([{ type: 'text', text: 'null' }]);
  });

  it('does not treat arrays as render-hint objects', () => {
    const out = formatToolResult([1, 2, 3]);
    expect(out[0]?.type).toBe('text');
    expect((out[0] as { text: string }).text).toBe(JSON.stringify([1, 2, 3], null, 2));
  });
});

function resourceOf(out: readonly unknown[]): { uri: string; mimeType: string; text: string } {
  const block = out.find((b): b is { type: 'resource'; resource: { uri: string; mimeType: string; text: string } } =>
    (b as { type?: string }).type === 'resource');
  if (!block) throw new Error('no resource block');
  return block.resource;
}

describe('formatToolResult MCP UI (html)', () => {
  it('emits a text fallback AND an MCP-UI resource block when html is present', () => {
    const html = '<article><h1>Booked</h1></article>';
    const out = formatToolResult({ html, markdown: '**Booked** BK-001', bookingId: 'BK-001' });
    // progressive enhancement: readable text first, rich resource second.
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('text');
    const res = resourceOf(out);
    expect(res.text).toBe(html);
    expect(res.mimeType).toBe(MCP_UI_HTML_MIME);
    expect(res.uri).toMatch(/^ui:\/\/result-/);
  });

  it('uses markdown as the text fallback when present (clean result on non-UI hosts)', () => {
    const out = formatToolResult({ html: '<div>rich</div>', markdown: '**fallback**' });
    expect(out[0]).toEqual({ type: 'text', text: '**fallback**' });
    expect(resourceOf(out).text).toBe('<div>rich</div>');
  });

  it('derives a stripped-JSON fallback when html is present without markdown', () => {
    const out = formatToolResult({ html: '<div/>', bookingId: 'BK-9' } as Record<string, unknown>);
    expect(out[0]?.type).toBe('text');
    // the fallback omits render-hint fields like `html`.
    expect((out[0] as { text: string }).text).not.toContain('<div');
  });

  it('falls through to markdown-only when html is missing', () => {
    const out = formatToolResult({ markdown: '**hi**' });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: 'text', text: '**hi**' });
  });

  it('produces a unique resource uri per call', () => {
    expect(resourceOf(formatToolResult({ html: '<x/>' })).uri)
      .not.toBe(resourceOf(formatToolResult({ html: '<x/>' })).uri);
  });
});

describe('formatToolResult ↔ inbound MCP-UI conformance', () => {
  it('the outbound mime equals the inbound renderer mime (no drift)', () => {
    expect(MCP_UI_HTML_MIME).toBe(INBOUND_MCP_UI_HTML_MIME);
    expect(MCP_UI_HTML_MIME).toBe('text/html');
  });

  it('an emitted html resource block parses through the inbound mcpUiResourceSchema', () => {
    const res = resourceOf(formatToolResult({ html: '<article><h1>Booked</h1></article>' }));
    // The inbound schema keys on `content`, not `text` — the renderer's
    // UIResource shape. The MCP resource block carries the HTML in `text`;
    // map it the way the host adapter does before handing to the renderer.
    const resource = {
      uri: res.uri,
      mimeType: res.mimeType,
      content: res.text,
    };
    const parsed = mcpUiResourceSchema.safeParse(resource);
    expect(parsed.success).toBe(true);
    // ui:// scheme + bare text/html is what the renderer's srcdoc path matches.
    expect(resource.uri).toMatch(/^ui:\/\//);
    expect(resource.mimeType).toBe(INBOUND_MCP_UI_HTML_MIME);
  });
});
