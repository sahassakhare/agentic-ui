import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

/**
 * HTTP/SSE transport for the MCP server.
 *
 * @remarks
 * MCP's HTTP transport uses two endpoints:
 *  - `GET /sse` — long-lived Server-Sent Events stream (server → client)
 *  - `POST /message` — client → server messages
 *
 * One MCP session per connected SSE client. The SDK's `SSEServerTransport`
 * handles the JSON-RPC envelope encoding; we just thread Node's HTTP
 * primitives in.
 *
 * **CORS** — defaults to `'*'` (development mode). Always set explicit
 * origins for production deployments.
 *
 * **Auth** — this transport doesn't bake in a credential check. Use
 * the MCP server's `beforeCall` hook for tool-level auth, or wrap this
 * with reverse-proxy auth at the network layer.
 *
 * @returns A `close` callback that drains the HTTP listener.
 */
export async function startHttpTransport(
  server: Server,
  opts: { readonly port: number; readonly cors?: readonly string[] },
): Promise<() => Promise<void>> {
  const allowedOrigins = opts.cors ? new Set(opts.cors) : null;

  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    setCors(res, req.headers.origin, allowedOrigins);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/sse') {
      const transport = new SSEServerTransport('/message', res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => transports.delete(transport.sessionId));
      await server.connect(transport);
      return;
    }

    if (req.method === 'POST' && req.url?.startsWith('/message')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const sessionId = url.searchParams.get('sessionId');
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.writeHead(400);
        res.end('Unknown sessionId');
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  return () =>
    new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
}

function setCors(res: ServerResponse, origin: string | undefined, allowed: ReadonlySet<string> | null): void {
  // No allowlist configured: dev mode, echo back the origin (or `*`).
  if (allowed === null) {
    res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  } else if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
}
