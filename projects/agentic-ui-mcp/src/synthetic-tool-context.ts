import type { ToolContext } from '@maverick/agentic-ui';

/**
 * Build a minimal `ToolContext` for a tool handler invoked from an
 * MCP server. MCP hosts don't have AG-UI's per-thread / per-run
 * lifecycle — there's no `threadId` or `runId` from a chat shell — so
 * we mint synthetic, stable identifiers tied to the MCP `callId`.
 *
 * @remarks
 * Most demo handlers don't read the context, but for handlers that do
 * (e.g., to attach telemetry tags or honour `signal.aborted`), the
 * synthetic context behaves correctly:
 *
 * - `threadId` is `'mcp:<serverName>'` — stable per server instance,
 *   so cross-call telemetry can be aggregated by MCP server identity.
 * - `runId` and `toolCallId` mirror the MCP `callId` so a single
 *   span/trace covers the whole call.
 * - `signal` defaults to a never-aborting signal; when an MCP request
 *   arrives with an associated cancellation primitive (a future MCP
 *   feature), this is where it threads through.
 *
 * @param params Server name, MCP call id, and an optional abort signal
 *               from the transport layer (when MCP gains cancellation).
 * @returns A frozen `ToolContext` matching the AG-UI shape exactly.
 */
export function syntheticToolContext(params: {
  readonly serverName: string;
  readonly callId: string;
  readonly signal?: AbortSignal;
}): ToolContext {
  return Object.freeze({
    threadId: `mcp:${params.serverName}`,
    runId: params.callId,
    toolCallId: params.callId,
    signal: params.signal ?? new AbortController().signal,
    // Capability F5 LRO surface — MCP hosts don't currently consume
    // operation-* events; provide typed-stub no-ops to satisfy the
    // ToolContext contract. Long-running tools invoked through MCP
    // see successful method calls but no progress is surfaced. A
    // future slice extends MCP transport to forward operation events.
    startOperation: () => `mcp-op-${params.callId}-${Date.now()}`,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  });
}
