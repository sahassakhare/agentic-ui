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
      // Render hints. <mvk-chat-shell> would render the `components`
      // entry; markdown-only hosts (Claude Desktop) get the markdown table.
      components: [{ name: 'flightCard', props: { bookingId, from, to, date, status: 'confirmed' } }],
      markdown:
        `**Booking confirmed** — \`${bookingId}\`\n\n` +
        `| | |\n|---|---|\n| From | ${from} |\n| To | ${to} |\n| Date | ${date} |\n| Status | confirmed |`,
    };
    return result;
  },
};

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
