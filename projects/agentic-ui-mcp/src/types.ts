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
   * Start with HTTP/SSE — for remote MCP hosts that connect over the
   * network rather than spawning a child process. Binds an HTTP server
   * on the given port; one MCP session per connected client.
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
   * Lower-level: process a single MCP request and return a response.
   * For embedding the MCP handler inside an existing HTTP server
   * (Hono / Express / Fastify) without spinning up a second listener.
   *
   * The request shape mirrors `@modelcontextprotocol/sdk`'s wire format
   * — typically a JSON-RPC envelope with `jsonrpc`, `id`, `method`,
   * `params`. Returns the matching response envelope.
   */
  handleRequest(request: unknown): Promise<unknown>;

  /** Drain in-flight calls, close the transport, free resources. */
  close(): Promise<void>;
}
