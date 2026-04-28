import type { ToolResultRenderHints } from '@maverick/agentic-ui';

/**
 * One element of an MCP `tools/call` response's `content` array.
 * Mirrors the MCP SDK's text-block shape — we deliberately constrain
 * to text-only output so every block is portable across every MCP host.
 *
 * @remarks
 * Why text-only:
 *  - The MCP `image` block requires a base64 `data` blob; converting an
 *    `image_url` to base64 means a server-side fetch + memory cost.
 *  - The MCP `resource` block requires either inline `text` or `blob`;
 *    a bare URL doesn't fit. Hosts that render markdown render image
 *    URLs natively via standard `![alt](url)` syntax — so the simpler
 *    portable choice is to embed image URLs INTO a markdown text block.
 *
 * Future block types (image-by-base64, resource references) are easy
 * to add when a consumer needs them; for now text covers every host
 * the library targets.
 */
export type McpContentBlock = { readonly type: 'text'; readonly text: string };

/**
 * Format a tool handler's return value into MCP `content` blocks.
 *
 * @remarks
 * Precedence — the *first* matching condition wins so callers know
 * exactly which surface they're targeting:
 *
 *   1. **`markdown`** present  → single `text/markdown` content block.
 *   2. **`image_url`** present → `image` resource block.
 *   3. Otherwise               → JSON-stringified domain result as `text`.
 *
 * The `components` field is **not** rendered — it's the
 * `<mvk-widget-container>` channel and means nothing to a markdown-only
 * MCP host. The MCP server adapter ignores it.
 *
 * The reserved `html` / `iframe_url` fields (declared in
 * `ToolResultRenderHints` for forward compatibility but not yet
 * activated under ADR-006) are also ignored here. They become
 * supported when ADR-007 (MCP UI integration) lands.
 *
 * @param result Whatever the tool's `handler(args, ctx)` returned.
 * @returns Array of MCP content blocks; never empty.
 */
export function formatToolResult(result: unknown): readonly McpContentBlock[] {
  if (result === null || result === undefined) {
    return [{ type: 'text', text: 'null' }];
  }

  // Narrow to the render-hints shape if present; treat as an opaque
  // record otherwise.
  const hints = isObject(result) ? (result as ToolResultRenderHints & Record<string, unknown>) : undefined;

  if (hints?.markdown && typeof hints.markdown === 'string') {
    // If both markdown and image_url are present, append the image at
    // the end so the markdown narrative comes first.
    if (hints.image_url && typeof hints.image_url === 'string') {
      return [{ type: 'text', text: `${hints.markdown}\n\n![](${hints.image_url})` }];
    }
    return [{ type: 'text', text: hints.markdown }];
  }

  if (hints?.image_url && typeof hints.image_url === 'string') {
    // Embed the image URL via standard markdown image syntax — this
    // renders inline in Claude Desktop, Cursor, Continue, and any
    // markdown-aware MCP host.
    return [{ type: 'text', text: `![](${hints.image_url})` }];
  }

  // Default: stringified JSON. Strip render-hint fields the LLM doesn't
  // need — `components`, `html`, `iframe_url` are rendering concerns,
  // not domain data.
  const filtered = isObject(result) ? stripRenderHints(result as Record<string, unknown>) : result;
  return [{
    type: 'text',
    text: typeof filtered === 'string' ? filtered : JSON.stringify(filtered, null, 2),
  }];
}

/** Remove render-hint fields so the LLM sees only domain data. */
function stripRenderHints<T extends Record<string, unknown>>(result: T): Record<string, unknown> {
  const {
    components: _c,
    markdown: _m,
    image_url: _i,
    html: _h,
    iframe_url: _f,
    ...rest
  } = result as T & Partial<ToolResultRenderHints>;
  return rest;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
