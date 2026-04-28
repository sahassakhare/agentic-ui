import type { ToolResultRenderHints } from '@maverick/agentic-ui';

/**
 * One element of an MCP `tools/call` response's `content` array.
 * Two block types are emitted today:
 *
 * - **`text`** — markdown / plain text / JSON-stringified domain data.
 *   Renders in every MCP host (Claude Desktop, Cursor, Continue, etc.).
 * - **`resource`** with `mimeType: 'text/html;profile=mcp-app'` — the
 *   MCP UI standard (announced by Claude Desktop's
 *   `io.modelcontextprotocol/ui` capability). Hosts that recognise it
 *   render the HTML in a sandboxed iframe; hosts that don't fall back
 *   to the resource's `text` field as plain text.
 *
 * @remarks
 * The `image` block is intentionally not used — converting an
 * `image_url` to a base64 blob means a server-side fetch with memory
 * cost. Hosts that render markdown render image URLs natively via
 * `![](url)` syntax inside a `text` block.
 */
export type McpContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'resource';
      readonly resource: {
        readonly uri: string;
        readonly mimeType: string;
        readonly text: string;
      };
    };

/**
 * The MCP UI mime type, as announced by Claude Desktop's
 * `io.modelcontextprotocol/ui` capability and emitted as a `resource`
 * block when a tool result includes an `html` render hint. Hosts that
 * recognise it render the HTML in a sandboxed iframe; hosts that don't
 * fall back to the resource's `text` field as plain text.
 *
 * @see https://modelcontextprotocol.io/specification (MCP UI extension)
 */
export const MCP_UI_HTML_MIME = 'text/html;profile=mcp-app';

/**
 * Format a tool handler's return value into MCP `content` blocks.
 *
 * @remarks
 * Precedence — the *first* matching condition wins so callers know
 * exactly which surface they're targeting:
 *
 *   1. **`html`** present  → MCP UI `resource` block (`text/html;profile=mcp-app`).
 *      Highest fidelity — Claude Desktop / Cursor / any MCP UI–aware
 *      host renders the HTML in a sandboxed iframe.
 *   2. **`markdown`** present  → single text block; `image_url`
 *      appended as markdown image syntax if also present.
 *   3. **`image_url`** alone  → markdown image embed (`![](url)`).
 *   4. Otherwise  → JSON-stringified domain data as text.
 *
 * The `components` field is **not** rendered — it's the
 * `<mvk-widget-container>` channel and means nothing to an MCP host.
 * The MCP server adapter ignores it.
 *
 * The `iframe_url` field is reserved for a future patch (sandboxed
 * live-widget URL); it isn't processed yet.
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

  // 1. MCP UI — sandboxed HTML.
  if (hints?.html && typeof hints.html === 'string') {
    return [{
      type: 'resource',
      resource: {
        // The `uri` is the host's display id for this resource — must be
        // unique per result. We mint one tied to the tool's render so the
        // host can cache or replay if it wants. Using the `mcp-ui:` scheme
        // makes it self-describing in logs.
        uri: `mcp-ui://result-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        mimeType: MCP_UI_HTML_MIME,
        text: hints.html,
      },
    }];
  }

  // 2. Markdown (with optional inline image).
  if (hints?.markdown && typeof hints.markdown === 'string') {
    // If both markdown and image_url are present, append the image at
    // the end so the markdown narrative comes first.
    if (hints.image_url && typeof hints.image_url === 'string') {
      return [{ type: 'text', text: `${hints.markdown}\n\n![](${hints.image_url})` }];
    }
    return [{ type: 'text', text: hints.markdown }];
  }

  // 3. Image URL alone — embed via standard markdown image syntax.
  if (hints?.image_url && typeof hints.image_url === 'string') {
    return [{ type: 'text', text: `![](${hints.image_url})` }];
  }

  // 4. Default: stringified JSON. Strip render-hint fields the LLM
  //    doesn't need — `components`, `html`, `iframe_url` are rendering
  //    concerns, not domain data.
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
