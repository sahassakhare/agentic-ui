import type { ToolDef } from '@infra-tools/agentic-ui';

/**
 * Per-call hook context passed to {@link CreateMcpServerOptions.beforeCall}
 * and {@link CreateMcpServerOptions.afterCall}.
 */
export interface McpCallContext {
  /** Tool name (matches `ToolDef.name`). */
  readonly name: string;
  /** Stable id minted for this MCP `tools/call` invocation. */
  readonly callId: string;
}

/** Hook signature for `beforeCall` — runs before schema validation. */
export type BeforeCallHook = (
  ctx: McpCallContext & { readonly args: unknown },
) => void | Promise<void>;

/** Hook signature for `afterCall` — runs after the handler resolves (or throws). */
export type AfterCallHook = (
  ctx: McpCallContext & {
    readonly result: unknown;
    readonly durationMs: number;
    readonly ok: boolean;
    readonly error?: unknown;
  },
) => void | Promise<void>;

/**
 * Configuration for {@link createMcpServer}.
 *
 * @remarks
 * Every property except `name`, `version`, and `tools` is optional. The
 * default behaviour is to expose every supplied tool, validate args
 * against each tool's Zod schema, and forward results through the
 * standard MCP `tools/call` response shape.
 */
export interface CreateMcpServerOptions {
  /**
   * Server name advertised to MCP hosts. This is the key consumers
   * write into their `claude_desktop_config.json` / Cursor MCP config
   * to mount the server.
   */
  readonly name: string;

  /** Semver string. Surfaced in MCP `initialize` responses. */
  readonly version: string;

  /**
   * Tools to expose. Reuses `ToolDef` from `@infra-tools/agentic-ui` so the
   * same tool registered with `provideAgenticUi({ tools })` can be
   * passed straight in here.
   */
  readonly tools: readonly ToolDef[];

  /**
   * Optional pre-call hook. Runs once per `tools/call` request, BEFORE
   * schema validation. Use it for:
   *  - **Auth** — throw to reject unauthorised callers.
   *  - **Audit logging** — record who called what.
   *  - **Rate limiting** — throw to short-circuit when over budget.
   *
   * Throwing or rejecting from `beforeCall` cancels the request and
   * returns an MCP `InternalError` to the host. The thrown error's
   * message is the user-visible reason.
   */
  readonly beforeCall?: BeforeCallHook;

  /**
   * Optional post-call hook. Runs after the handler resolves OR throws.
   * Use it for telemetry emission, response redaction, or shaping the
   * audit trail. Errors thrown from `afterCall` are caught and logged
   * (`console.warn`) — they do NOT change the response sent to the host.
   */
  readonly afterCall?: AfterCallHook;

  /**
   * **MCP Apps (SEP-1865)** — predeclared interactive UI templates that
   * MCP-Apps hosts (Claude Desktop, VS Code Copilot, …) render in a
   * sandboxed iframe. Each is served via `resources/list` + `resources/read`
   * with mime `text/html;profile=mcp-app`. Link a tool to one via
   * {@link toolUi}; the host fetches the template, renders it, and pushes
   * the tool's `structuredContent` to the iframe as a
   * `ui/notifications/tool-result` JSON-RPC message.
   *
   * Optional + backwards-compatible: omit and the server behaves exactly
   * as before (legacy MCP-UI resource blocks via the formatter).
   */
  readonly uiResources?: readonly McpUiResourceTemplate[];

  /**
   * Map of tool name → the `ui://` resource it renders. Adds
   * `_meta.ui.resourceUri` to that tool in `tools/list` so MCP-Apps hosts
   * know to render the linked template, and includes the handler's return
   * value as `structuredContent` on the tool result so the iframe receives
   * the data.
   */
  readonly toolUi?: Readonly<Record<string, { readonly resourceUri: string }>>;
}

/** A predeclared MCP Apps UI template (SEP-1865). */
export interface McpUiResourceTemplate {
  /** `ui://`-scheme URI uniquely identifying the template. */
  readonly uri: string;
  /** The HTML document (a self-contained MCP App that speaks `ui/*` JSON-RPC over postMessage). */
  readonly html: string;
  /** Optional human label surfaced in `resources/list`. */
  readonly name?: string;
  /** Optional Content-Security-Policy hints surfaced in the resource `_meta.ui.csp`. */
  readonly csp?: { readonly connectDomains?: readonly string[]; readonly resourceDomains?: readonly string[] };
}

/**
 * Handle returned by {@link createMcpServer}. Pick a transport
 * (`startStdio` / `startHttp`) or embed via `handleRequest`. Always
 * `await close()` during shutdown to drain in-flight calls and free
 * the transport.
 */
export interface McpServerHandle {
  /**
   * Start with the stdio transport — the default for Claude Desktop,
   * Cursor's local MCP, Zed, Continue, Windsurf. Reads MCP messages from
   * `process.stdin`, writes to `process.stdout`. Resolves when the
   * transport is connected.
   */
  startStdio(): Promise<void>;

  /**
   * Start with **Streamable HTTP** (MCP 2025-03-26) — for remote MCP hosts
   * that connect over the network rather than spawning a child process.
   * Binds an HTTP server exposing a single `/mcp` endpoint (POST/GET/DELETE)
   * with stateful, in-memory MCP sessions (one per connected client).
   *
   * @param opts.port Listening port.
   * @param opts.cors Optional CORS allowlist; defaults to `'*'` for dev.
   *                  ALWAYS set explicit origins for production.
   */
  startHttp(opts: {
    readonly port: number;
    readonly cors?: readonly string[];
  }): Promise<void>;

  /**
   * Lower-level: handle a single MCP request against the framework's own
   * `req`/`res`. For embedding the MCP handler inside an existing HTTP
   * server (Hono / Express / Fastify) without spinning up a second listener.
   *
   * Delegates to a stateless Streamable HTTP transport (JSON responses,
   * no session) via the SDK's public transport API. Pass `parsedBody` when
   * your framework already parsed the JSON body (e.g. `express.json()`);
   * omit it to let the transport read the request stream.
   *
   * @example
   * ```ts
   * app.post('/mcp', express.json(), (req, res) => {
   *   void handle.handleRequest(req, res, req.body);
   * });
   * ```
   */
  handleRequest(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    parsedBody?: unknown,
  ): Promise<void>;

  /** Drain in-flight calls, close the transport, free resources. */
  close(): Promise<void>;
}
