/**
 * Optional render-hint fields a tool's handler may include in its return
 * value to control how different consumers display the result. Every
 * field is optional and consumers ignore unrecognised fields — so the
 * same tool result is portable across `<mvk-chat-shell>`, an MCP server
 * (via `@maverick/agentic-ui-mcp`), and any future UI surface.
 *
 * @remarks
 * Tools don't have to extend this interface — `ToolDef`'s `TResult`
 * generic is consumer-defined. This shape is the canonical *building
 * block* a consumer assembles their domain result from.
 *
 * @example
 * ```ts
 * agenticTool({
 *   name: 'bookFlight',
 *   schema: z.object({ from: z.string(), to: z.string(), date: z.string() }),
 *   handler: async ({ from, to, date }, ctx) => {
 *     const booking = await yourBookingService.book({ from, to, date });
 *     return {
 *       // typed domain fields the LLM consumes
 *       ...booking,
 *
 *       // rendering hints — every field optional, consumer-by-consumer
 *       components: [{ name: 'flightCard', props: booking }],   // <mvk-chat-shell>
 *       markdown:                                                // markdown-only hosts
 *         `**Booked** ${booking.bookingId}\n\n` +
 *         `| From | To | Date |\n|---|---|---|\n` +
 *         `| ${from} | ${to} | ${date} |`,
 *       image_url: undefined,                                    // optional fallback
 *     } satisfies ToolResultRenderHints & typeof booking;
 *   },
 * });
 * ```
 *
 * @see https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0006-mcp-server-side-adapter.md
 */
export interface ToolResultRenderHints {
  /**
   * Generative-UI hint consumed by `<mvk-widget-container>` via
   * `*ngComponentOutlet`. Each `{ name, props }` resolves a registered
   * component from `ComponentRegistry` and renders it under the tool
   * result. Validated against the widget's `propsSchema` before bind.
   */
  readonly components?: ReadonlyArray<{
    readonly name: string;
    readonly props: unknown;
  }>;

  /**
   * Markdown rendering for hosts that don't render Angular widgets —
   * Claude Desktop, Cursor, Continue, Zed, the upcoming Copilot MCP
   * support, and any other text-stream chat surface. Ignored by
   * `<mvk-chat-shell>` (which prefers `components`).
   */
  readonly markdown?: string;

  /**
   * Image URL inline-renderable in markdown chats. Useful when a
   * server-rendered image of the typed result is the highest fidelity
   * a non-Angular host can reach (e.g., a flight card screenshot).
   */
  readonly image_url?: string;

  /**
   * Reserved for ADR-007 (MCP UI integration). Pre-rendered static
   * HTML that compatible hosts iframe-embed for visual fidelity
   * without interactivity. Not yet activated by any consumer in the
   * library; declaring it here lets forward-looking tool authors
   * include the field today without a future breaking change.
   *
   * @experimental Reserved field — not yet processed.
   */
  readonly html?: string;

  /**
   * Reserved for ADR-007 (MCP UI integration). Sandboxed live-widget
   * URL — the host iframe-embeds this URL for full Angular
   * component fidelity inside an isolated frame. Not yet activated.
   *
   * @experimental Reserved field — not yet processed.
   */
  readonly iframe_url?: string;
}
