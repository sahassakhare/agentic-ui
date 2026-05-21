/**
 * Types for the WebMCP (`navigator.modelContext`) proposal.
 *
 * WebMCP is a draft browser API that lets a page expose tools to an
 * in-browser agent. The API surface is not yet stable; this adapter
 * feature-detects it at runtime and no-ops when absent. The interfaces
 * below model the commonly-cited proposal shape — adjust the single
 * `NavigatorModelContext` interface if the upstream proposal shifts.
 *
 * See docs/plans/mcp-ui-webmcp-support-plan.md (Phase 2) + ADR-050.
 */

/** Result a WebMCP tool returns to the in-browser agent. */
export interface WebMcpToolResult {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  /** Optional structured payload mirrored alongside the text content. */
  readonly structuredContent?: unknown;
  /** True when the tool ended in an error the agent should see. */
  readonly isError?: boolean;
}

/** A tool registration the adapter hands to `navigator.modelContext`. */
export interface WebMcpToolRegistration {
  readonly name: string;
  readonly description: string;
  /** JSON Schema (object) describing the call arguments. */
  readonly inputSchema: object;
  execute(args: unknown): Promise<WebMcpToolResult>;
}

/** Handle returned by `registerTool`; `unregister` reaps it. */
export interface WebMcpToolHandle {
  unregister(): void;
}

/**
 * The `navigator.modelContext` surface this adapter consumes. Only the
 * members the adapter touches are modelled. Feature-detected via
 * {@link getModelContext}.
 */
export interface NavigatorModelContext {
  registerTool(tool: WebMcpToolRegistration): WebMcpToolHandle;
}

/**
 * Feature-detect `navigator.modelContext`. Returns null in any
 * environment that doesn't implement the proposal (every browser
 * today unless behind a flag / polyfill, plus SSR / tests). The
 * adapter degrades to a no-op when this returns null.
 */
export function getModelContext(nav: unknown = (globalThis as { navigator?: unknown }).navigator): NavigatorModelContext | null {
  if (!nav || typeof nav !== 'object') return null;
  const mc = (nav as { modelContext?: unknown }).modelContext;
  if (!mc || typeof mc !== 'object') return null;
  if (typeof (mc as { registerTool?: unknown }).registerTool !== 'function') return null;
  return mc as NavigatorModelContext;
}
