/**
 * Demo MCP server. Exposes the bookings/loyalty/support tools — the
 * SAME tool definitions consumed by `demo-multi-agent`'s chat shell —
 * as a Model Context Protocol server.
 *
 * Mounts via stdio for Claude Desktop / Cursor / Zed:
 *
 * ```jsonc
 * // ~/Library/Application Support/Claude/claude_desktop_config.json
 * {
 *   "mcpServers": {
 *     "maverick-demo": {
 *       "command": "/abs/path/to/node",
 *       "args": ["/abs/path/to/agentic-ui/examples/demo-mcp-server/dist/index.js"]
 *     }
 *   }
 * }
 * ```
 *
 * After restarting Claude Desktop, type "Book a flight from LAX to JFK
 * on May 5" and the bookFlight handler runs against the demo's mock
 * data, with the result rendered as a markdown table (because the
 * tool returns the optional `markdown` render-hint field).
 *
 * @remarks
 * **Why we don't use `agenticTool({...})` here.**
 * `agenticTool` is a typed factory re-exported from
 * `@maverick/agentic-ui`'s public-api barrel. Importing anything from
 * that barrel pulls in Angular's static initializers
 * (`ɵɵngDeclareFactory`, `PlatformLocation`, etc.) which require
 * `@angular/compiler` at runtime — fine inside an Angular app, fatal
 * in pure Node like Claude Desktop's MCP server host. The factory
 * adds **zero runtime behaviour** beyond returning the object literal
 * with type inference, so we build `ToolDef` literals directly. See
 * the cookbook entry's "authoring tools for Node-only consumption"
 * section.
 *
 * Type-only imports from `@maverick/agentic-ui` (e.g. `ToolDef`,
 * `ToolResultRenderHints`) are erased at compile time and DO NOT
 * pull Angular into the runtime — those are safe.
 */
import { createMcpServer } from '@maverick/agentic-ui-mcp';
import type { ToolDef, ToolResultRenderHints } from '@maverick/agentic-ui';
import { z } from 'zod';

// ── Bookings ──────────────────────────────────────────────────────────────

const bookFlightTool: ToolDef = {
  name: 'bookFlight',
  description: 'Book a flight from one airport to another on a given date.',
  schema: z.object({
    from: z.string().describe('Origin airport code (e.g., LAX)'),
    to: z.string().describe('Destination airport code (e.g., JFK)'),
    date: z.string().describe('Departure date in ISO 8601 (YYYY-MM-DD)'),
  }),
  handler: async (args) => {
    const { from, to, date } = args as { from: string; to: string; date: string };
    const bookingId = `BK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const result: ToolResultRenderHints & {
      bookingId: string; from: string; to: string; date: string; status: string;
    } = {
      bookingId, from, to, date, status: 'confirmed',

      // ── Render hints, in precedence order ────────────────────────
      //
      // <mvk-chat-shell> renders `components` (Angular component);
      // MCP UI hosts (Claude Desktop, Cursor) render `html`;
      // markdown-only hosts render `markdown`.
      components: [{ name: 'flightCard', props: { bookingId, from, to, date, status: 'confirmed' } }],
      html: renderFlightCardHtml({ bookingId, from, to, date }),
      markdown:
        `**Booking confirmed** — \`${bookingId}\`\n\n` +
        `| | |\n|---|---|\n| From | ${from} |\n| To | ${to} |\n| Date | ${date} |\n| Status | confirmed |`,
    };
    return result;
  },
};

/**
 * Server-render a self-contained HTML flight card. Mirrors the
 * styling of `FlightCardComponent` from the Angular demos so the
 * MCP UI rendering is visually consistent with what the chat shell
 * shows. All CSS inlined; no external assets.
 */
function renderFlightCardHtml(p: { bookingId: string; from: string; to: string; date: string }): string {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:1rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;background:#f8fafc;">
  <article style="padding:1rem 1.2rem;border:1px solid #d1d5db;border-radius:0.6rem;background:#fff;border-left:4px solid #2563eb;max-width:480px;">
    <header style="display:flex;gap:0.6rem;align-items:center;margin-bottom:0.5rem;">
      <span style="font-size:0.7em;padding:2px 6px;border-radius:4px;background:#dbeafe;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">flight</span>
      <span style="font-weight:600;font-size:1.05rem;">${escapeHtml(p.from)} → ${escapeHtml(p.to)}</span>
      <span style="margin-left:auto;font-size:0.75em;padding:2px 8px;border-radius:999px;background:#d1fae5;color:#065f46;">confirmed</span>
    </header>
    <p style="margin:0.4rem 0 0.2rem;color:#4b5563;">${escapeHtml(p.date)}</p>
    <p style="margin:0;color:#6b7280;font-size:0.85em;">Booking: <code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;">${escapeHtml(p.bookingId)}</code></p>
  </article>
</body></html>`.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

// ── Loyalty ───────────────────────────────────────────────────────────────

const checkPointsTool: ToolDef = {
  name: 'checkPoints',
  description: 'Check the current loyalty points balance and tier status.',
  schema: z.object({}),
  handler: async () => {
    const balance = Math.round(15_000 + Math.random() * 35_000);
    const tier = balance > 40_000 ? 'platinum' : balance > 25_000 ? 'gold' : 'silver';
    return {
      balance, tier,
      markdown: `**Loyalty status**\n\n- Balance: **${balance.toLocaleString()} pts**\n- Tier: **${tier}**`,
    };
  },
};

// ── Support ───────────────────────────────────────────────────────────────

const openTicketTool: ToolDef = {
  name: 'openTicket',
  description: 'Open a support ticket for an account problem, refund request, or complaint.',
  schema: z.object({
    subject: z.string().describe('One-line summary of the issue'),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
  }),
  handler: async (args) => {
    const { subject, priority } = args as { subject: string; priority: 'low' | 'normal' | 'high' };
    const ticketId = `TICK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    return {
      ticketId, subject, status: 'open', priority,
      markdown:
        `**Ticket opened** — \`${ticketId}\`\n\n` +
        `- Subject: ${subject}\n- Priority: **${priority}**\n- Status: open`,
    };
  },
};

// ── Wire the MCP server ───────────────────────────────────────────────────

const handle = createMcpServer({
  name: 'maverick-demo',
  version: '0.1.0',
  tools: [bookFlightTool, checkPointsTool, openTicketTool],
  // Optional: log every call to stderr (stdout is reserved for MCP messages).
  // Visible in Claude Desktop's logs at
  //   ~/Library/Logs/Claude/mcp-server-maverick-demo.log
  beforeCall: ({ name, callId }) => {
    console.error(`[mcp] ${callId} → ${name}`);
  },
  afterCall: ({ name, callId, durationMs, ok }) => {
    console.error(`[mcp] ${callId} ← ${name} (${durationMs}ms, ${ok ? 'ok' : 'failed'})`);
  },
});

await handle.startStdio();
console.error('[mcp] maverick-demo MCP server connected over stdio');
