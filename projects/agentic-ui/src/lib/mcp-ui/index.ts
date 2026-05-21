/**
 * MCP-UI inbound rendering (Phase 1 of docs/plans/mcp-ui-webmcp-support-plan.md).
 *
 * Renders MCP-UI `UIResource`s in sandboxed iframes and dispatches their
 * postMessage actions through the host's registries (tool calls go through
 * the active scope policy). The MCP *server* side (emitting MCP-UI) already
 * ships in `@infra-tools/agentic-ui-mcp`; this is the consumer side.
 *
 * See ADR-049 for the security model.
 */
export {
  MCP_UI_HTML_MIME,
  MCP_UI_URI_LIST_MIME,
  MCP_UI_REMOTE_DOM_MIME,
  mcpUiResourceSchema,
  mcpUiActionSchema,
  mcpUiMessageSchema,
  type McpUiResource,
  type McpUiAction,
  type McpUiMessage,
} from './types';
export { MCP_UI_CONFIG, MCP_UI_DEFAULT_CONFIG, type McpUiConfig } from './config';
export { McpUiActionBridge, type McpUiActionResult } from './mcp-ui-action-bridge';
export { McpUiResourceComponent } from './mcp-ui-resource.component';
export { provideMcpUi, type ProvideMcpUiOptions } from './provide-mcp-ui';
