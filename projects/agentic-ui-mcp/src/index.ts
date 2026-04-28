/**
 * `@maverick/agentic-ui-mcp` — expose `@maverick/agentic-ui` `ToolDef`s
 * as a Model Context Protocol server. Lets Claude Desktop, Cursor, Zed,
 * Continue, Windsurf, and any other MCP-compatible host invoke the same
 * tools your `<mvk-chat-shell>` consumes.
 *
 * @see https://github.com/sahassakhare/agentic-ui/blob/main/docs/cookbook/mcp-server.md
 * @see https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0006-mcp-server-side-adapter.md
 */
export * from './types.js';
export * from './create-mcp-server.js';
export { formatToolResult, type McpContentBlock } from './result-formatter.js';
export { zodToMcpSchema, type McpInputSchema } from './zod-to-mcp-schema.js';
export { syntheticToolContext } from './synthetic-tool-context.js';
