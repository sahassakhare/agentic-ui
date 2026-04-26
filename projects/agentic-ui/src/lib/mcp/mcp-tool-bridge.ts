import { inject, type EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { ToolRegistry } from '../registries/tool-registry';
import { jsonSchemaToZod } from '../registries/schema-transformer-registry';
import type { ToolDef, ToolContext } from '../types/registry-defs';

/**
 * Shape of an MCP-style tool descriptor — matches the Model Context Protocol's
 * tool listing JSON. Apps that already speak MCP can pass these directly.
 */
export interface McpTool {
  readonly name: string;
  readonly description?: string;
  /** JSON Schema describing the call's arguments. */
  readonly inputSchema?: Record<string, unknown>;
}

/**
 * Transport for invoking MCP tool calls. Apps wire this against an MCP client
 * (HTTP, stdio, WebSocket); the lib stays transport-agnostic.
 */
export interface McpClient {
  readonly serverName: string;
  /** Returns the catalog of tools the MCP server exposes. */
  listTools(): Promise<readonly McpTool[]>;
  /** Invokes a tool on the MCP server with the given arguments. */
  callTool(name: string, args: unknown, signal: AbortSignal): Promise<unknown>;
}

export interface McpBridgeOptions {
  readonly client: McpClient;
  /**
   * Source tag stamped on every imported tool. Defaults to `mcp:<serverName>`.
   * Use a custom value when you want the chat shell to display a friendlier label.
   */
  readonly source?: string;
}

/**
 * Imports an MCP server's tool catalog into the host's `ToolRegistry`. Each
 * MCP tool becomes a regular `ToolDef` whose handler delegates back to
 * `client.callTool(...)`. JSON Schema arg shapes are converted to Zod for
 * validation symmetry with the rest of the lib.
 *
 * Returns a disposer that removes all imported tools (typically called when
 * the MCP server disconnects or the app tears down).
 */
export async function mcpToolBridge(opts: McpBridgeOptions, hostInjector: EnvironmentInjector): Promise<() => void> {
  const tools = await opts.client.listTools();
  const source: `mcp:${string}` | `external:${string}` = (opts.source as `mcp:${string}` | `external:${string}` | undefined) ?? `mcp:${opts.client.serverName}`;

  return runInInjectionContext(hostInjector, () => {
    const registry = inject(ToolRegistry);
    const defs: ToolDef[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? t.name,
      schema: t.inputSchema ? jsonSchemaToZod(t.inputSchema) : (jsonSchemaToZod({ type: 'object' })),
      source,
      handler: async (args: unknown, ctx: ToolContext) => opts.client.callTool(t.name, args, ctx.signal),
    }));
    return registry.registerAll(defs);
  });
}
