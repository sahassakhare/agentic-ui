/**
 * Demo MCP server. Exposes the bookings/loyalty/support tools — the
 * SAME tool definitions consumed by `demo-multi-agent`'s chat shell —
 * as a Model Context Protocol server.
 *
 * Mounts via stdio for Claude Desktop / Cursor / Zed:
 *
 * ```json
 * // ~/Library/Application Support/Claude/claude_desktop_config.json
 * {
 *   "mcpServers": {
 *     "maverick-demo": {
 *       "command": "node",
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
 */
import { agenticTool, type ToolDef } from '@maverick/agentic-ui';
import { createMcpServer } from '@maverick/agentic-ui-mcp';
import { z } from 'zod';

// ── Bookings ──────────────────────────────────────────────────────────────

const bookFlightTool = agenticTool({
  name: 'bookFlight',
  description: 'Book a flight from one airport to another on a given date.',
  schema: z.object({
    from: z.string().describe('Origin airport code (e.g., LAX)'),
    to: z.string().describe('Destination airport code (e.g., JFK)'),
    date: z.string().describe('Departure date in ISO 8601 (YYYY-MM-DD)'),
  }),
  handler: async ({ from, to, date }) => {
    const bookingId = `BK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    return {
      bookingId, from, to, date, status: 'confirmed' as const,
      // Render hints the host can pick up. <mvk-chat-shell> would render
      // the `components` entry; markdown-only hosts (Claude Desktop) get
      // the markdown table.
      components: [{ name: 'flightCard', props: { bookingId, from, to, date, status: 'confirmed' } }],
      markdown:
        `**Booking confirmed** — \`${bookingId}\`\n\n` +
        `| | |\n|---|---|\n| From | ${from} |\n| To | ${to} |\n| Date | ${date} |\n| Status | confirmed |`,
    };
  },
});

// ── Loyalty ───────────────────────────────────────────────────────────────

const checkPointsTool = agenticTool({
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
});

// ── Support ───────────────────────────────────────────────────────────────

const openTicketTool = agenticTool({
  name: 'openTicket',
  description: 'Open a support ticket for an account problem, refund request, or complaint.',
  schema: z.object({
    subject: z.string().describe('One-line summary of the issue'),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
  }),
  handler: async ({ subject, priority }) => {
    const ticketId = `TICK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    return {
      ticketId, subject, status: 'open' as const, priority,
      markdown:
        `**Ticket opened** — \`${ticketId}\`\n\n` +
        `- Subject: ${subject}\n- Priority: **${priority}**\n- Status: open`,
    };
  },
});

// ── Wire the MCP server ───────────────────────────────────────────────────

const handle = createMcpServer({
  name: 'maverick-demo',
  version: '0.1.0',
  tools: [
    bookFlightTool as ToolDef,
    checkPointsTool as ToolDef,
    openTicketTool as ToolDef,
  ],
  // Optional: log every call to stderr (stdout is reserved for MCP messages)
  beforeCall: ({ name, callId }) => {
    console.error(`[mcp] ${callId} → ${name}`);
  },
  afterCall: ({ name, callId, durationMs, ok }) => {
    console.error(`[mcp] ${callId} ← ${name} (${durationMs}ms, ${ok ? 'ok' : 'failed'})`);
  },
});

await handle.startStdio();
console.error('[mcp] maverick-demo MCP server connected over stdio');
