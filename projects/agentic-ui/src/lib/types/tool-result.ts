/**
 * Optional render-hint fields a tool's handler may include in its return
 * value to control how different consumers display the result. Every
 * field is optional and consumers ignore unrecognised fields — so the
 * same tool result is portable across `<mvk-chat-shell>`, an MCP server
 * (via `@infra-tools/agentic-ui-mcp`), and any future UI surface.
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
   * Pre-rendered static HTML for hosts that support the **MCP UI**
   * extension (`io.modelcontextprotocol/ui` capability with
   * `text/html;profile=mcp-app`). Claude Desktop, Cursor, and other
   * MCP UI–aware hosts iframe-embed the HTML in a sandbox; hosts
   * without UI support fall back to the resource's text representation.
   *
   * @remarks
   * **Highest-precedence render hint** in `@infra-tools/agentic-ui-mcp`'s
   * formatter — when `html` is present, the MCP server emits an
   * `text/html;profile=mcp-app` resource block and ignores `markdown` /
   * `image_url`. Use it for rich tool results: styled cards, charts,
   * server-rendered Angular components.
   *
   * **Sandboxing**: the HTML runs in the host's iframe sandbox.
   * Standard `<style>`, inline CSS, and most JS work; cross-origin
   * iframe rules apply (no top-window access, no localStorage on the
   * host's origin). Keep payloads self-contained — link to external
   * stylesheets via absolute URLs.
   *
   * @example
   * ```ts
   * return {
   *   bookingId: 'BK-001',
   *   from, to, date,
   *   html: `
   *     <article style="font-family: system-ui; padding: 1rem; border: 1px solid #d1d5db; border-radius: 0.5rem;">
   *       <h2 style="margin: 0">${from} → ${to}</h2>
   *       <p>Booking confirmed: <code>${bookingId}</code></p>
   *     </article>
   *   `,
   * };
   * ```
   */
  readonly html?: string;

  /**
   * Reserved for a future patch — sandboxed live-widget URL the host
   * would iframe-embed for full Angular component interactivity inside
   * an isolated frame. Not yet activated.
   *
   * @experimental Reserved field — not yet processed.
   */
  readonly iframe_url?: string;

  /**
   * Adaptive Card 1.5+ schema (raw JSON). Consumed by the Teams
   * Bot Framework adapter (`@infra-tools/agentic-ui-teams-bot`) and
   * the future Microsoft Copilot Studio Connector. Both ecosystems
   * render Adaptive Cards natively in their chat surfaces; this
   * hint is the highest-fidelity render available there.
   *
   * @remarks
   * - The Angular `<mvk-chat-shell>` ignores this field — its
   *   canonical render path is `components`. Adaptive Cards
   *   coexist with the other hints without conflict.
   * - Each adapter pins its own supported AC schema version
   *   (ADR-041 D7). Hand-write to the version the target host
   *   ships; consult the adapter's README.
   * - Tools that omit this hint still render in Teams via a
   *   generic AC fallback the adapter builds from the
   *   `components` array — useful for prototyping.
   *
   * @see https://adaptivecards.io
   * @see ADR-041 §D2
   *
   * @example
   * ```ts
   * return {
   *   ...holdRecord,
   *   components: [{ name: 'legalHoldCard', props: holdRecord }],
   *   adaptiveCard: {
   *     type: 'AdaptiveCard',
   *     $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
   *     version: '1.5',
   *     body: [
   *       { type: 'TextBlock', text: `Hold issued: ${holdRecord.id}`,
   *         weight: 'Bolder', size: 'Medium' },
   *       { type: 'FactSet', facts: [
   *         { title: 'Scope', value: holdRecord.scope },
   *         { title: 'Custodians', value: `${custodianIds.length}` },
   *       ]},
   *     ],
   *     actions: [{ type: 'Action.OpenUrl', title: 'Open in app',
   *                 url: `https://app/holds/${holdRecord.id}` }],
   *   },
   * };
   * ```
   */
  readonly adaptiveCard?: object;
}
