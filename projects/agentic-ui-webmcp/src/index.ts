/**
 * @infra-tools/agentic-ui-webmcp
 *
 * Exposes the host app's `ToolRegistry` to an in-browser agent via the
 * WebMCP (`navigator.modelContext`) proposal. The mirror image of
 * `@infra-tools/agentic-ui-mcp` (a Node MCP server) — same ToolRegistry
 * source, different (browser) transport.
 *
 * Optional plugin; stays outside the core lib per ADR-010 D4. Feature-
 * detects `navigator.modelContext` and degrades to a no-op when the
 * browser doesn't implement the proposal.
 *
 * Phase 2 of docs/plans/mcp-ui-webmcp-support-plan.md. Security model
 * in ADR-050.
 */
export { provideWebMcp, WebMcpService, type WebMcpOptions } from './provide-web-mcp';
export { zodToWebMcpSchema, type WebMcpInputSchema } from './zod-bridge';
export { syntheticToolContext } from './synthetic-context';
export {
  getModelContext,
  type NavigatorModelContext,
  type WebMcpToolRegistration,
  type WebMcpToolHandle,
  type WebMcpToolResult,
} from './types';
