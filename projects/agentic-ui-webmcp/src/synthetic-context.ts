import type { ToolContext } from '@infra-tools/agentic-ui';

/**
 * Build a synthetic `ToolContext` for invoking a `ToolDef.handler`
 * outside the chat shell — here, in response to a WebMCP
 * `navigator.modelContext` tool call.
 *
 * The LRO methods (`startOperation` / `reportProgress` / …) are no-ops:
 * a WebMCP caller is an in-browser agent, not the chat shell, so there's
 * no `<mvk-operation-progress>` surface to drive. Tools that depend on
 * observable progress should require a chat-shell context.
 *
 * Mirrors `syntheticToolContext` in `@infra-tools/agentic-ui-mcp`.
 */
export function syntheticToolContext(opts: {
  readonly threadId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly signal: AbortSignal;
}): ToolContext {
  return {
    threadId: opts.threadId,
    runId: opts.runId,
    toolCallId: opts.toolCallId,
    signal: opts.signal,
    startOperation: () => `op-webmcp-${Date.now()}`,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  };
}
