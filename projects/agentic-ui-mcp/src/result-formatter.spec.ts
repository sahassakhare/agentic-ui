import { describe, expect, it } from 'vitest';
import { formatToolResult, MCP_UI_HTML_MIME } from './result-formatter.js';

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

describe('formatToolResult MCP UI (html)', () => {
  it('emits an MCP UI resource block when html is present', () => {
    const html = '<article><h1>Booked</h1></article>';
    const out = formatToolResult({ html, bookingId: 'BK-001' });
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('resource');
    const block = out[0] as { type: 'resource'; resource: { uri: string; mimeType: string; text: string } };
    expect(block.resource.text).toBe(html);
    expect(block.resource.mimeType).toBe(MCP_UI_HTML_MIME);
    expect(block.resource.uri).toMatch(/^mcp-ui:\/\/result-/);
  });

  it('html takes precedence over markdown', () => {
    const out = formatToolResult({
      html: '<div>rich</div>',
      markdown: '**fallback**',
    });
    expect(out[0]?.type).toBe('resource');
  });

  it('html takes precedence over image_url', () => {
    const out = formatToolResult({
      html: '<div>rich</div>',
      image_url: 'https://x/y.png',
    });
    expect(out[0]?.type).toBe('resource');
  });

  it('falls through to markdown when html is missing', () => {
    const out = formatToolResult({ markdown: '**hi**' });
    expect(out[0]?.type).toBe('text');
    expect((out[0] as { text: string }).text).toBe('**hi**');
  });

  it('produces a unique uri per call', () => {
    const a = formatToolResult({ html: '<x/>' })[0] as { resource: { uri: string } };
    const b = formatToolResult({ html: '<x/>' })[0] as { resource: { uri: string } };
    expect(a.resource.uri).not.toBe(b.resource.uri);
  });
});
