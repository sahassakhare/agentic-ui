import { z } from 'zod';

/**
 * MCP-UI inbound rendering types (Phase 1 of the MCP-UI + WebMCP plan,
 * docs/plans/mcp-ui-webmcp-support-plan.md).
 *
 * An MCP server (or a tool result carrying the existing `iframe_url` /
 * `html` render hints) can describe a UI resource the host renders in a
 * sandboxed surface. This file defines:
 *   - `McpUiResource` — the resource descriptor (3 payload shapes)
 *   - `McpUiAction` — the postMessage action protocol a UIResource emits
 *   - Zod schemas for both, so inbound payloads are validated before
 *     they reach a render surface or dispatch into a registry.
 *
 * Security: a UIResource runs in a sandboxed iframe; its actions cross
 * back via postMessage and are validated here before dispatch. The
 * `tool` action routes through the host's existing scope + approval
 * gating — an untrusted resource cannot call a tool the active persona
 * can't invoke. See ADR-049.
 */

/**
 * MIME types a UIResource payload can carry. `text/html` and
 * `text/uri-list` ship in Phase 1; `remote-dom` is reserved for Phase 3
 * (renders server-described UI as registered ComponentRegistry widgets).
 */
export const MCP_UI_HTML_MIME = 'text/html';
/**
 * MCP Apps (SEP-1865) HTML mime. Hosts that implement the SEP serve UI
 * templates with this profile and drive them over a JSON-RPC-over-postMessage
 * channel. The inbound renderer treats it like `text/html` for rendering
 * (sandboxed srcdoc) but additionally speaks the SEP `ui/*` protocol — see
 * `McpUiActionBridge.handleAppRpc`. Legacy `text/html` keeps the older
 * custom postMessage protocol for back-compat.
 */
export const MCP_UI_APP_MIME = 'text/html;profile=mcp-app';
export const MCP_UI_URI_LIST_MIME = 'text/uri-list';
export const MCP_UI_REMOTE_DOM_MIME = 'application/vnd.mcp-ui.remote-dom+javascript';
/**
 * Lib-native server-driven-UI payload (Phase 3). A JSON component tree
 * rendered as the host's OWN registered `ComponentRegistry` widgets —
 * not a sandboxed iframe. A server describes a UI composition by widget
 * name + props and it renders as native Angular components with full
 * styling + interactivity.
 *
 * Distinct from `remote-dom+javascript`: that MIME is the Shopify
 * remote-dom JS-mutation protocol (needs the @remote-dom/core worker
 * runtime, not bundled here). The component-tree+json format is the
 * JSON-serializable, fully-validated, dependency-light path the lib
 * ships natively.
 */
export const MCP_UI_COMPONENT_TREE_MIME = 'application/vnd.mcp-ui.component-tree+json';

/**
 * Recursive component-tree node. `component` is a `ComponentRegistry`
 * widget name; `props` are validated against the widget's propsSchema
 * at mount; `children` render recursively beneath the node.
 */
export interface ComponentTreeNode {
  readonly component: string;
  readonly props?: Record<string, unknown>;
  readonly children?: readonly ComponentTreeNode[];
}

export const componentTreeNodeSchema: z.ZodType<ComponentTreeNode> = z.lazy(() =>
  z.object({
    component: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(componentTreeNodeSchema).optional(),
  }),
);

export const mcpUiResourceSchema = z.object({
  /** Stable id for the resource — used as the iframe name + dedup key. */
  uri: z.string().min(1),
  /**
   * Payload MIME:
   *  - `text/html` → inline srcdoc iframe
   *  - `text/uri-list` → external-URL iframe (origin-allowlisted)
   *  - `application/vnd.mcp-ui.component-tree+json` → native widget tree
   *  - `application/vnd.mcp-ui.remote-dom+javascript` → recognised; not
   *    bundled (use component-tree+json for the lib-native path)
   */
  mimeType: z.enum([
    MCP_UI_HTML_MIME,
    MCP_UI_APP_MIME,
    MCP_UI_URI_LIST_MIME,
    MCP_UI_COMPONENT_TREE_MIME,
    MCP_UI_REMOTE_DOM_MIME,
  ]),
  /**
   * The payload. `text/html` (+ `;profile=mcp-app`) → HTML string;
   * `text/uri-list` → a single absolute URL; `component-tree+json` → a JSON
   * `ComponentTreeNode` (string-encoded); `remote-dom+javascript` → the
   * remote-dom script.
   */
  content: z.string(),
  /** Optional human label surfaced in the render chrome. */
  title: z.string().optional(),
  /**
   * Optional structured data for MCP Apps (SEP-1865) templates. When the
   * resource is rendered, the host pushes this to the iframe as the
   * `ui/notifications/tool-result` `structuredContent` so a predeclared
   * template renders from data (presentation/data separation). Ignored by
   * legacy `text/html` resources, which embed their data in `content`.
   */
  data: z.unknown().optional(),
});

export type McpUiResource = z.infer<typeof mcpUiResourceSchema>;

/**
 * The action protocol a sandboxed UIResource emits back to the host via
 * `postMessage`. Each variant maps onto an existing registry:
 *   tool   → ToolRegistry (scope + approval gated)
 *   intent → IntentRegistry
 *   link   → Angular Router
 *   notify → notification tray
 *   prompt → inject text into the active chat turn
 *
 * Phase 1 dispatches `tool` and `link`; the rest are validated + surfaced
 * to the host's optional handler so adopters can wire them before the
 * library ships first-class dispatch.
 */
export const mcpUiActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tool'),
    payload: z.object({
      toolName: z.string().min(1),
      args: z.unknown().optional(),
    }),
  }),
  z.object({
    type: z.literal('intent'),
    payload: z.object({
      intent: z.string().min(1),
      args: z.unknown().optional(),
    }),
  }),
  z.object({
    type: z.literal('link'),
    payload: z.object({
      url: z.string().min(1),
      /** 'router' = in-app navigation; 'external' = window.open. Default router. */
      target: z.enum(['router', 'external']).optional(),
    }),
  }),
  z.object({
    type: z.literal('notify'),
    payload: z.object({
      message: z.string(),
      level: z.enum(['info', 'warning', 'error']).optional(),
    }),
  }),
  z.object({
    type: z.literal('prompt'),
    payload: z.object({
      text: z.string().min(1),
    }),
  }),
]);

export type McpUiAction = z.infer<typeof mcpUiActionSchema>;

/** Envelope the iframe posts: `{ source: 'mcp-ui', action: {...} }`. */
export const mcpUiMessageSchema = z.object({
  source: z.literal('mcp-ui'),
  action: mcpUiActionSchema,
});

export type McpUiMessage = z.infer<typeof mcpUiMessageSchema>;

// ── MCP Apps (SEP-1865) JSON-RPC-over-postMessage channel ─────────────────
//
// MCP Apps templates (`text/html;profile=mcp-app`) don't use the legacy
// `{source:'mcp-ui', action}` envelope — they speak JSON-RPC 2.0. The iframe
// posts requests (`ui/initialize`, `tools/list`, `tools/call`, `ui/open-link`,
// `ui/update-model-context`); the host replies with a matching response and
// pushes notifications (`ui/notifications/tool-result`, `…/tool-input`). See
// `McpUiActionBridge.handleAppRpc`.

/**
 * A JSON-RPC 2.0 request/notification an MCP App iframe posts to the host.
 * Requests carry an `id` (host must reply); notifications omit it.
 */
export const mcpAppRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export type McpAppRpcRequest = z.infer<typeof mcpAppRpcRequestSchema>;

/** A JSON-RPC 2.0 response (or notification) the host posts into the iframe. */
export interface McpAppRpcResponse {
  readonly jsonrpc: '2.0';
  /** Matches the request `id`; omitted for host→iframe notifications. */
  readonly id?: string | number;
  /** Notification method (e.g. `ui/notifications/tool-result`); omitted for replies. */
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}
