import { describe, expect, it } from 'vitest';
import { formatToolResult } from './result-formatter.js';

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
    const out = formatToolResult({
      bookingId: 'BK-002',
      components: [{ name: 'flightCard', props: {} }],
      html: '<x/>',
      iframe_url: 'https://x',
    });
    const parsed = JSON.parse(out[0]?.text ?? '{}');
    expect(parsed).toEqual({ bookingId: 'BK-002' });
    expect(parsed.components).toBeUndefined();
    expect(parsed.html).toBeUndefined();
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
    expect(out[0]?.text).toBe(JSON.stringify([1, 2, 3], null, 2));
  });
});
