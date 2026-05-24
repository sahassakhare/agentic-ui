import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Process a single MCP request through a stateless Streamable HTTP transport.
 *
 * @remarks
 * For embedding the MCP server inside an existing HTTP framework
 * (Hono / Express / Fastify) where you already own the request/response
 * lifecycle. Unlike {@link startHttpTransport}, this owns no listener and
 * keeps no session state — each call spins up a throwaway
 * `StreamableHTTPServerTransport` in **stateless** mode
 * (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), connects
 * the shared server, dispatches the request, and tears the transport down
 * when the response finishes.
 *
 * This replaces the previous reliance on the SDK's private
 * `Server._handleRequest` with the SDK's public transport API, so it no
 * longer breaks across SDK releases.
 *
 * @param server the MCP server (built by {@link createMcpServer})
 * @param req the framework's Node-compatible request
 * @param res the framework's Node-compatible response
 * @param parsedBody optional pre-parsed JSON body (from body-parser middleware);
 *   omit to let the transport read + parse the request stream itself
 *
 * @example
 * ```ts
 * // Express integration
 * app.post('/mcp', express.json(), (req, res) => {
 *   void mcpHandle.handleRequest(req, res, req.body);
 * });
 * ```
 */
export async function handleSingleRequest(
  server: Server,
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    // Stateless: no session id, JSON response (no SSE upgrade) — the
    // simplest request/response shape for an embedded handler.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  // Tear the transport (and its connection) down once the response is done
  // so a long-lived host process doesn't accumulate connections.
  res.on('close', () => {
    void transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
