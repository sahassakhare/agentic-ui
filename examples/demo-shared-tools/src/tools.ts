import type { ToolDef, ToolResultRenderHints } from '@infra-tools/agentic-ui';
import { z } from 'zod';

/**
 * The SINGLE source of truth for the demo tools, shared by:
 *   - `demo-monolith` (Angular app — chat shell renders `components`)
 *   - `demo-mcp-server` (Node MCP server — hosts render `html` / `markdown`)
 *
 * **Zero Angular imports.** `ToolDef` / `ToolResultRenderHints` are
 * type-only (erased at compile), so this module is safe to import in pure
 * Node (Claude Desktop's MCP host) AND in the browser. The tool
 * *contract* (name + Zod schema) is serializable and framework-agnostic;
 * the *handler* travels with it here because the demo runs the same logic
 * on both sides. This is the schema-first posture from
 * docs/plans/unified-agentic-protocol-interface-plan.md (§2).
 *
 * Each tool carries the full set of render hints. Each surface picks what
 * it understands: the chat shell renders `components` (an Angular widget),
 * MCP-UI hosts render `html` (sandboxed iframe), markdown-only hosts
 * render `markdown`. One definition, no drift.
 */

// ── Bookings ────────────────────────────────────────────────────────────────

export const bookFlightTool: ToolDef = {
  name: 'bookFlight',
  description:
    'Book a flight from one airport to another on a given date. Returns booking ' +
    'confirmation and renders a flight card.',
  schema: z.object({
    from: z.string().describe('Origin airport code (e.g., LAX)'),
    to: z.string().describe('Destination airport code (e.g., JFK)'),
    date: z.string().describe('Departure date in ISO 8601 (YYYY-MM-DD)'),
  }),
  handler: async (args) => {
    const { from, to, date } = args as { from: string; to: string; date: string };
    const bookingId = `BK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const booking = { bookingId, from, to, date, status: 'confirmed' };
    const result: ToolResultRenderHints & typeof booking = {
      ...booking,
      // Render hints in precedence order. <mvk-chat-shell> renders the
      // Angular `components` widget; MCP-UI hosts render `html`;
      // markdown-only hosts render `markdown`.
      components: [{ name: 'flightCard', props: booking }],
      html: renderFlightCardHtml(booking),
      markdown:
        `**Booking confirmed** — \`${bookingId}\`\n\n` +
        `| | |\n|---|---|\n| From | ${from} |\n| To | ${to} |\n| Date | ${date} |\n| Status | confirmed |`,
    };
    return result;
  },
};

// ── Loyalty ─────────────────────────────────────────────────────────────────

export const checkPointsTool: ToolDef = {
  name: 'checkPoints',
  description: 'Check the current loyalty points balance and tier status.',
  schema: z.object({}),
  handler: async () => {
    const balance = Math.round(15_000 + Math.random() * 35_000);
    const tier = balance > 40_000 ? 'platinum' : balance > 25_000 ? 'gold' : 'silver';
    const result: ToolResultRenderHints & { balance: number; tier: string } = {
      balance,
      tier,
      components: [{ name: 'pointsCard', props: { balance, tier } }],
      markdown: `**Loyalty status**\n\n- Balance: **${balance.toLocaleString()} pts**\n- Tier: **${tier}**`,
    };
    return result;
  },
};

// ── Support ───────────────────────────────────────────────────────────────

export const openTicketTool: ToolDef = {
  name: 'openTicket',
  description: 'Open a support ticket for an account problem, refund request, or complaint.',
  schema: z.object({
    subject: z.string().describe('One-line summary of the issue'),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
  }),
  handler: async (args) => {
    const { subject, priority } = args as { subject: string; priority: 'low' | 'normal' | 'high' };
    const ticketId = `TICK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const result: ToolResultRenderHints & { ticketId: string; subject: string; status: string; priority: string } = {
      ticketId,
      subject,
      status: 'open',
      priority,
      components: [{ name: 'ticketCard', props: { ticketId, subject, status: 'open', priority } }],
      markdown:
        `**Ticket opened** — \`${ticketId}\`\n\n` +
        `- Subject: ${subject}\n- Priority: **${priority}**\n- Status: open`,
    };
    return result;
  },
};

/** The shared tool set. Both the Angular app and the MCP server register this. */
export const sharedTools: ToolDef[] = [bookFlightTool, checkPointsTool, openTicketTool];

// ── HTML render-hint helper (server-side card; mirrors FlightCardComponent) ──

/**
 * Self-contained HTML flight card for MCP-UI hosts. All CSS inlined; no
 * external assets. Mirrors the Angular `FlightCardComponent` styling so
 * the MCP rendering is visually consistent with the chat shell.
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
