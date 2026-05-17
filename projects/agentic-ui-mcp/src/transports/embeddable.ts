import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Process a single MCP JSON-RPC envelope without owning a transport.
 *
 * @remarks
 * For embedding the MCP server inside an existing HTTP framework
 * (Hono / Express / Fastify) where you already own the request/response
 * lifecycle and just want the protocol bridge.
 *
 * The MCP SDK exposes its handler internals through `Server.handleRequest`
 * (private but callable via cast). When the SDK formalises a public
 * embeddable API we'll switch to it.
 *
 * @example
 * ```ts
 * // Hono integration
 * app.post('/mcp', async (c) => {
 *   const body = await c.req.json();
 *   const response = await mcpHandle.handleRequest(body);
 *   return c.json(response);
 * });
 * ```
 *
 * @internal Subject to MCP SDK internals; pin a tested SDK version.
 */
export async function handleSingleRequest(server: Server, request: unknown): Promise<unknown> {
  // The SDK's Server has a private `_handleRequest` method that processes
  // a JSON-RPC envelope. We use a structural type cast rather than `as any`
  // to keep the call site honest about the contract.
  type WithInternalHandler = { _handleRequest?: (request: unknown) => Promise<unknown> };
  const internal = server as unknown as WithInternalHandler;
  if (typeof internal._handleRequest !== 'function') {
    throw new Error(
      '[agentic-ui-mcp] handleRequest: the installed @modelcontextprotocol/sdk version does not expose the embeddable request handler. ' +
      'Pin to a known-good SDK version (see ADR-006 supported-versions section in the cookbook), or use startHttp / startStdio instead.',
    );
  }
  return internal._handleRequest(request);
}
