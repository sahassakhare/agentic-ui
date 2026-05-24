import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

/**
 * Streamable HTTP transport for the MCP server (MCP 2025-03-26 spec).
 *
 * @remarks
 * This replaces the deprecated HTTP+SSE two-endpoint transport with the
 * modern **Streamable HTTP** transport — a single `/mcp` endpoint that
 * multiplexes JSON-RPC over POST (with optional SSE upgrade) and GET
 * (server-initiated stream), plus DELETE for session teardown:
 *  - `POST /mcp` — client → server messages. An `initialize` request with
 *    no session header opens a new session; the server replies with an
 *    `mcp-session-id` header the client echoes on every subsequent request.
 *  - `GET /mcp` — opens the server → client SSE stream for an existing session.
 *  - `DELETE /mcp` — closes the session.
 *
 * Sessions are stateful and held in-memory (one transport per session).
 *
 * **CORS** — defaults to `'*'` (development mode). Always set explicit
 * origins for production deployments. The `mcp-session-id` header is
 * exposed so browsers can read it off the initialize response.
 *
 * **Auth** — this transport doesn't bake in a credential check. Use
 * the MCP server's `beforeCall` hook for tool-level auth, or wrap this
 * with reverse-proxy auth at the network layer.
 *
 * @returns A `close` callback that drains the HTTP listener + all sessions.
 */
export async function startHttpTransport(
  server: Server,
  opts: { readonly port: number; readonly cors?: readonly string[] },
): Promise<() => Promise<void>> {
  const allowedOrigins = opts.cors ? new Set(opts.cors) : null;

  // One transport per active session, keyed by the session id the SDK mints.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    setCors(res, req.headers.origin, allowedOrigins);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/mcp') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;

    try {
      if (existing) {
        // GET (open stream), POST (message), DELETE (close) for a live session.
        await existing.handleRequest(req, res);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (isInitializeRequest(body)) {
          // New session — mint a transport, register it, connect, handle.
          const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => {
              transports.set(id, transport);
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
          };
          await server.connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }
        // A non-initialize POST without a known session is a protocol error.
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: no valid session id, and not an initialize request.' },
          id: null,
        }));
        return;
      }

      // GET / DELETE without a session can't be served.
      res.writeHead(400);
      res.end('Missing or unknown mcp-session-id.');
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
          id: null,
        }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  return async () => {
    await Promise.all([...transports.values()].map((t) => t.close().catch(() => undefined)));
    transports.clear();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };
}

/** Read + JSON-parse a request body. Returns `undefined` for an empty body. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function setCors(res: ServerResponse, origin: string | undefined, allowed: ReadonlySet<string> | null): void {
  // No allowlist configured: dev mode, echo back the origin (or `*`).
  if (allowed === null) {
    res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  } else if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, mcp-session-id, last-event-id');
  // Browsers can only read the session id off the initialize response if it's exposed.
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
}
