import { agenticTool, agenticWidget, type ComponentDef, type ToolDef } from '@maverick/agentic-ui';
import { z } from 'zod';
import { FlightCardComponent } from './flight-card.component';
import { PointsCardComponent } from './points-card.component';
import { TicketCardComponent } from './ticket-card.component';

/**
 * Multi-agent demo. The host registers tools + widgets for THREE domains
 * (bookings, loyalty, support). The orchestrator agent on the server picks
 * which specialist handles each turn and forwards its event stream — so the
 * specialist sees the full registry and can call any of these tools.
 *
 * In a real federated deployment, each domain's tool/widget set would live
 * in its own MFE remote and be loaded via `loadRemoteCapabilities`. We
 * register them inline here so the example runs without federation moving
 * parts.
 */

// ── Bookings ───────────────────────────────────────────────────────────────

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
    const booking = { bookingId, from, to, date, status: 'confirmed' };
    return { ...booking, components: [{ name: 'flightCard', props: booking }] };
  },
});

const cancelFlightTool = agenticTool({
  name: 'cancelFlight',
  description: 'Cancel an existing flight booking by booking id.',
  schema: z.object({ bookingId: z.string().describe('Booking id, e.g. BK-AB12CD') }),
  handler: async ({ bookingId }) => ({
    bookingId,
    status: 'cancelled',
    refundUsd: Math.round(100 + Math.random() * 400),
  }),
});

const flightCardWidget = agenticWidget({
  name: 'flightCard',
  component: FlightCardComponent,
  propsSchema: z.object({
    bookingId: z.string(),
    from: z.string(),
    to: z.string(),
    date: z.string(),
    status: z.string(),
  }),
});

// ── Loyalty ────────────────────────────────────────────────────────────────

const checkPointsTool = agenticTool({
  name: 'checkPoints',
  description: 'Check the current loyalty points balance and tier status.',
  schema: z.object({}),
  handler: async () => {
    const balance = Math.round(15_000 + Math.random() * 35_000);
    const tier = balance > 40_000 ? 'platinum' : balance > 25_000 ? 'gold' : 'silver';
    const nextTier = tier === 'silver' ? 'gold' : tier === 'gold' ? 'platinum' : null;
    const nextTierAt = nextTier === 'gold' ? 25_000 : nextTier === 'platinum' ? 40_000 : null;
    return {
      balance,
      tier,
      nextTier: nextTier ?? '',
      nextTierAt,
      components: [{ name: 'pointsCard', props: { balance, tier, nextTier: nextTier ?? '', nextTierAt } }],
    };
  },
});

const redeemPointsTool = agenticTool({
  name: 'redeemPoints',
  description: 'Redeem loyalty points for a reward (flight, upgrade, gift card).',
  schema: z.object({
    points: z.number().int().positive().describe('Number of points to redeem'),
    reward: z.enum(['flight', 'upgrade', 'gift-card']).describe('Reward type'),
  }),
  handler: async ({ points, reward }) => ({
    redemptionId: `RD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    points,
    reward,
    status: 'completed',
  }),
});

const pointsCardWidget = agenticWidget({
  name: 'pointsCard',
  component: PointsCardComponent,
  propsSchema: z.object({
    balance: z.number(),
    tier: z.string(),
    nextTier: z.string().optional(),
    nextTierAt: z.number().nullable().optional(),
  }),
});

// ── Support ────────────────────────────────────────────────────────────────

const openTicketTool = agenticTool({
  name: 'openTicket',
  description: 'Open a support ticket for an account problem, refund request, or complaint.',
  schema: z.object({
    subject: z.string().describe('One-line summary of the issue'),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
  }),
  handler: async ({ subject, priority }) => {
    const ticketId = `TICK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const ticket = { ticketId, subject, status: 'open', priority };
    return { ...ticket, components: [{ name: 'ticketCard', props: ticket }] };
  },
});

const checkTicketTool = agenticTool({
  name: 'checkTicket',
  description: 'Check the status of an existing support ticket.',
  schema: z.object({ ticketId: z.string().describe('Ticket id, e.g. TICK-AB12CD') }),
  handler: async ({ ticketId }) => {
    const status = ['open', 'in_progress', 'resolved'][Math.floor(Math.random() * 3)] ?? 'open';
    const ticket = { ticketId, subject: 'Account access issue', status, priority: 'normal' };
    return { ...ticket, components: [{ name: 'ticketCard', props: ticket }] };
  },
});

const ticketCardWidget = agenticWidget({
  name: 'ticketCard',
  component: TicketCardComponent,
  propsSchema: z.object({
    ticketId: z.string(),
    subject: z.string(),
    status: z.string(),
    priority: z.string(),
  }),
});

// ── Aggregate ──────────────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  bookFlightTool as ToolDef,
  cancelFlightTool as ToolDef,
  checkPointsTool as ToolDef,
  redeemPointsTool as ToolDef,
  openTicketTool as ToolDef,
  checkTicketTool as ToolDef,
];

export const widgets: ComponentDef[] = [flightCardWidget, pointsCardWidget, ticketCardWidget];
