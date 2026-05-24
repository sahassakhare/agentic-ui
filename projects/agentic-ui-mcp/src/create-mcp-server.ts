import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolDef } from '@infra-tools/agentic-ui';
import { formatToolResult } from './result-formatter.js';
import { syntheticToolContext } from './synthetic-tool-context.js';
import type { CreateMcpServerOptions, McpServerHandle } from './types.js';
import { zodToMcpSchema } from './zod-to-mcp-schema.js';

/** MCP Apps (SEP-1865) UI resource MIME type. */
const MCP_APP_MIME = 'text/html;profile=mcp-app';

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
 *  - `startHttp({ port, cors })` — Streamable HTTP for remote MCP hosts.
 *  - `handleRequest(req, res, body?)` — embed in an existing HTTP server (Hono / Express).
 *
 * @example
 * ```ts
 * import { createMcpServer } from '@infra-tools/agentic-ui-mcp';
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
  // MCP Apps (SEP-1865) wiring — only active when uiResources are supplied.
  const uiResources = opts.uiResources ?? [];
  const toolUi = opts.toolUi ?? {};
  const hasApps = uiResources.length > 0;
  const uiByUri = new Map(uiResources.map((r) => [r.uri, r]));

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
    const ui = toolUi[tool.name];
    return {
      name: tool.name,
      description: tool.description,
      inputSchema,
      // SEP-1865: link the tool to its predeclared UI template so MCP-Apps
      // hosts know to render it. `visibility` exposes the UI to both the
      // model and the app surface.
      ...(ui ? { _meta: { ui: { resourceUri: ui.resourceUri, visibility: ['model', 'app'] } } } : {}),
    };
  });

  // SEP-1865 requires the UI extension to be negotiated. Declare it (plus the
  // `resources` capability the templates are served through) so MCP-Apps hosts
  // know this server provides interactive UI and will render the linked
  // templates. Cast: the SDK's ServerCapabilities type predates the
  // `extensions` field, but it's forwarded verbatim in the initialize result.
  const capabilities = (hasApps
    ? {
        tools: {},
        resources: {},
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [MCP_APP_MIME] } },
      }
    : { tools: {} }) as NonNullable<ConstructorParameters<typeof Server>[1]>['capabilities'];

  const server = new Server({ name: opts.name, version: opts.version }, { capabilities });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolListCache,
  }));

  // SEP-1865 resource surface: serve the predeclared `ui://` templates so
  // hosts can prefetch + render them in a sandboxed iframe.
  if (hasApps) {
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: uiResources.map((r) => ({
        uri: r.uri,
        name: r.name ?? r.uri,
        mimeType: MCP_APP_MIME,
      })),
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      const r = uiByUri.get(req.params.uri);
      if (!r) throw new Error(`Unknown resource: ${req.params.uri}`);
      return {
        contents: [{
          uri: r.uri,
          mimeType: MCP_APP_MIME,
          text: r.html,
          ...(r.csp ? { _meta: { ui: { csp: r.csp } } } : {}),
        }],
      };
    });
  }

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
      const isApp = Boolean(toolUi[name]) && isPlainObject(handlerResult);
      // For MCP-App tools, drop the legacy `html` render-hint so the
      // formatter does NOT also emit a `text/html` resource block — the
      // MCP App template owns the UI. Non-UI hosts still get the markdown
      // text fallback; the booking data rides in `structuredContent`.
      const forFormat = isApp
        ? { ...(handlerResult as Record<string, unknown>), html: undefined }
        : handlerResult;
      const result: CallToolResult = {
        content: [...formatToolResult(forFormat)],
        // SEP-1865: surface the (render-hint-free) domain data as
        // `structuredContent` so the host forwards it to the iframe
        // (`ui/notifications/tool-result`) for rendering.
        ...(isApp ? { structuredContent: stripRenderHints(handlerResult as Record<string, unknown>) } : {}),
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
    async handleRequest(req, res, parsedBody): Promise<void> {
      // For embedding into an existing HTTP server (Hono / Express /
      // Fastify). Delegates to a stateless Streamable HTTP transport — the
      // SDK's public transport API — so we no longer depend on the SDK's
      // private request handler.
      const { handleSingleRequest } = await import('./transports/embeddable.js');
      await handleSingleRequest(server, req, res, parsedBody);
    },
    async close(): Promise<void> {
      await Promise.all([
        stdioTransport ? server.close() : Promise.resolve(),
        httpClose ? httpClose() : Promise.resolve(),
      ]);
    },
  };
}

/** True for a non-null, non-array object (valid `structuredContent`). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Strip render-hint fields so `structuredContent` carries only domain data. */
const RENDER_HINT_KEYS = new Set(['components', 'html', 'markdown', 'image_url', 'iframe_url']);
function stripRenderHints(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (!RENDER_HINT_KEYS.has(k)) out[k] = o[k];
  }
  return out;
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
