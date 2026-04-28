import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolDef } from '@maverick/agentic-ui';
import { formatToolResult } from './result-formatter.js';
import { syntheticToolContext } from './synthetic-tool-context.js';
import type { CreateMcpServerOptions, McpServerHandle } from './types.js';
import { zodToMcpSchema } from './zod-to-mcp-schema.js';

/**
 * Wrap a list of `ToolDef`s as a Model Context Protocol server.
 *
 * @remarks
 * Once started, MCP-compatible hosts (Claude Desktop, Cursor, Continue,
 * Zed, Windsurf, the upcoming Copilot MCP support) can discover the
 * tools via `tools/list` and invoke them via `tools/call`. The same
 * `ToolDef` registered with `provideAgenticUi({ tools })` works in
 * `<mvk-chat-shell>` and here — one handler, two consumer surfaces.
 *
 * Pick a transport once configured:
 *
 *  - `startStdio()` — Claude Desktop's default. Reads stdin, writes stdout.
 *  - `startHttp({ port, cors })` — for remote MCP hosts.
 *  - `handleRequest(req)` — embed in an existing HTTP server (Hono / Express).
 *
 * @example
 * ```ts
 * import { createMcpServer } from '@maverick/agentic-ui-mcp';
 * import { bookFlightTool } from './tools/book-flight.tool';
 *
 * const handle = createMcpServer({
 *   name: 'maverick-bookings',
 *   version: '1.0.0',
 *   tools: [bookFlightTool],
 *   beforeCall: async ({ name, args }) => {
 *     // optional: auth / audit / rate-limit
 *   },
 * });
 *
 * await handle.startStdio();
 * // …or: await handle.startHttp({ port: 8765, cors: ['https://app.example.com'] });
 * ```
 *
 * @param opts See {@link CreateMcpServerOptions}.
 * @returns A {@link McpServerHandle} — pick a transport.
 * @throws Error when `tools` is empty or contains a tool whose schema
 *         can't be converted to a JSON Schema with `type: 'object'`.
 *
 * @see https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0006-mcp-server-side-adapter.md
 * @see https://github.com/sahassakhare/agentic-ui/blob/main/docs/cookbook/mcp-server.md
 */
export function createMcpServer(opts: CreateMcpServerOptions): McpServerHandle {
  if (opts.tools.length === 0) {
    throw new Error('createMcpServer: at least one tool is required.');
  }

  // Build the tool index up-front so list / call requests don't repeat
  // the schema conversion. This also surfaces schema problems at boot
  // rather than on the first call.
  const toolIndex = new Map<string, ToolDef>();
  const toolListCache: ListToolsResult['tools'] = opts.tools.map((tool) => {
    if (toolIndex.has(tool.name)) {
      throw new Error(`createMcpServer: duplicate tool name "${tool.name}".`);
    }
    toolIndex.set(tool.name, tool);
    // SDK's Tool.inputSchema expects a JSON-Schema-shaped object with
    // an index signature; our McpInputSchema type is the canonical
    // public-facing shape — cast to satisfy the SDK's wider runtime
    // type without polluting our exported interface.
    const inputSchema = zodToMcpSchema(tool.schema, tool.name) as ListToolsResult['tools'][number]['inputSchema'];
    return {
      name: tool.name,
      description: tool.description,
      inputSchema,
    };
  });

  const server = new Server(
    { name: opts.name, version: opts.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolListCache,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const callId = randomCallId();
    const { name, arguments: rawArgs } = req.params;

    const tool = toolIndex.get(name);
    if (!tool) {
      // MCP doesn't have a "method not found"-equivalent for unknown
      // tool names. The convention is to return an error CallToolResult
      // with `isError: true` so the host can surface it.
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: "${name}"` }],
      };
    }

    // beforeCall hook — auth / audit / rate-limit. Throws here surface
    // as MCP errors with the thrown message.
    if (opts.beforeCall) {
      try {
        await opts.beforeCall({ name, args: rawArgs, callId });
      } catch (err) {
        return errorResult(err, name, callId);
      }
    }

    // Schema-validate the args against the tool's Zod schema.
    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      const result = {
        isError: true as const,
        content: [{ type: 'text' as const, text: `Invalid arguments: ${message}` }],
      };
      await invokeAfterCall(opts.afterCall, {
        name, callId, result, durationMs: 0, ok: false, error: parsed.error,
      });
      return result;
    }

    // Invoke the handler. The synthetic context gives the handler the
    // shape it would receive from the chat shell; consumers that don't
    // read it (the common case) are unaffected.
    const ctx = syntheticToolContext({ serverName: opts.name, callId });
    const startedAt = Date.now();
    try {
      const handlerResult = await tool.handler(parsed.data, ctx);
      const durationMs = Date.now() - startedAt;
      const result: CallToolResult = {
        content: [...formatToolResult(handlerResult)],
      };
      await invokeAfterCall(opts.afterCall, {
        name, callId, result: handlerResult, durationMs, ok: true,
      });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const result = errorResult(err, name, callId);
      await invokeAfterCall(opts.afterCall, {
        name, callId, result, durationMs, ok: false, error: err,
      });
      return result;
    }
  });

  let stdioTransport: StdioServerTransport | undefined;
  // HTTP transport handle is created lazily so consumers who only use
  // stdio don't pay the import cost of the HTTP transport module.
  let httpClose: (() => Promise<void>) | undefined;

  return {
    async startStdio(): Promise<void> {
      stdioTransport = new StdioServerTransport();
      await server.connect(stdioTransport);
    },
    async startHttp(httpOpts): Promise<void> {
      const { startHttpTransport } = await import('./transports/http.js');
      httpClose = await startHttpTransport(server, httpOpts);
    },
    async handleRequest(request: unknown): Promise<unknown> {
      // For embedding into an existing HTTP server. The MCP SDK doesn't
      // expose a simple "process this single JSON-RPC envelope" path —
      // consumers can use the embeddable transport from the SDK
      // directly, but we surface a thin wrapper so they don't import
      // the SDK themselves.
      const { handleSingleRequest } = await import('./transports/embeddable.js');
      return handleSingleRequest(server, request);
    },
    async close(): Promise<void> {
      await Promise.all([
        stdioTransport ? server.close() : Promise.resolve(),
        httpClose ? httpClose() : Promise.resolve(),
      ]);
    },
  };
}

/** Stable random id for one MCP `tools/call` invocation. */
function randomCallId(): string {
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Build an MCP error CallToolResult from a thrown value. */
function errorResult(err: unknown, name: string, callId: string): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `Tool "${name}" failed (${callId}): ${message}`,
    }],
  };
}

/** Run the optional afterCall hook, swallowing errors so it can't break the MCP response. */
async function invokeAfterCall(
  hook: CreateMcpServerOptions['afterCall'],
  ctx: { name: string; callId: string; result: unknown; durationMs: number; ok: boolean; error?: unknown },
): Promise<void> {
  if (!hook) return;
  try {
    await hook(ctx);
  } catch (err) {
    // afterCall is observability — failures are logged but don't
    // change the response.
    console.warn(`[agentic-ui-mcp] afterCall hook threw for tool "${ctx.name}":`, err);
  }
}
