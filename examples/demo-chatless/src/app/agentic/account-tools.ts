import { z } from 'zod';
import type { ToolDef } from '@infra-tools/agentic-ui';

/**
 * Account-management tools the mature dashboard uses. Each returns a
 * list-shaped or detail-shaped payload paired with a `components` entry
 * that mounts the matching list widget (`tripListCard` / `loyaltyOverviewCard`
 * / `ticketListCard`). The agent picks the tool; the tool's handler shapes
 * the realistic payload.
 *
 * Mock data is deterministic-ish (small randomness) so the demo always
 * renders a believable account view without depending on an external
 * database.
 */

// ── Helpers ───────────────────────────────────────────────────────────────

function randId(prefix: string, len = 6): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 2 + len).toUpperCase()}`;
}

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

// ── L · listUpcomingTrips ─────────────────────────────────────────────────

export interface TripRow {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly date: string;
  readonly status: 'confirmed' | 'pending' | 'cancelled';
  readonly cabin: 'economy' | 'premium' | 'business';
  readonly price: number;
  readonly seat?: string;
}

export const listUpcomingTripsTool: ToolDef = {
  name: 'listUpcomingTrips',
  description:
    'List the traveler\'s upcoming flight bookings. Returns a paginated list ' +
    'with origin, destination, date, status, cabin, and price for each.',
  schema: z.object({}),
  handler: async () => {
    const trips: readonly TripRow[] = [
      { id: randId('BK'), from: 'LAX', to: 'JFK', date: isoDate(14), status: 'confirmed', cabin: 'economy',  price: 384, seat: '14C' },
      { id: randId('BK'), from: 'JFK', to: 'LAX', date: isoDate(20), status: 'confirmed', cabin: 'economy',  price: 412, seat: '22A' },
      { id: randId('BK'), from: 'LAX', to: 'ATL', date: isoDate(42), status: 'pending',   cabin: 'premium',  price: 731 },
      { id: randId('BK'), from: 'SFO', to: 'BOS', date: isoDate(78), status: 'confirmed', cabin: 'business', price: 1842, seat: '3F' },
    ];
    return { trips, components: [{ name: 'tripListCard', props: { trips } }] };
  },
};

// ── L · getLoyaltyAccount ─────────────────────────────────────────────────

export interface LoyaltyTransaction {
  readonly id: string;
  readonly date: string;
  readonly kind: 'earned' | 'redeemed' | 'expired';
  readonly description: string;
  readonly delta: number;
}

export const getLoyaltyAccountTool: ToolDef = {
  name: 'getLoyaltyAccount',
  description:
    'Get the traveler\'s current loyalty status: points balance, tier, miles to next tier, ' +
    'and recent earning/redemption activity.',
  schema: z.object({}),
  handler: async () => {
    const balance = 47_320;
    const tier = balance >= 75_000 ? 'platinum' : balance >= 40_000 ? 'gold' : 'silver';
    const nextTierAt = tier === 'platinum' ? 100_000 : tier === 'gold' ? 75_000 : 40_000;
    const transactions: readonly LoyaltyTransaction[] = [
      { id: randId('TX'), date: isoDate(-3),  kind: 'earned',   description: 'Flight LAX→JFK',            delta:  +1_840 },
      { id: randId('TX'), date: isoDate(-9),  kind: 'redeemed', description: 'Seat upgrade voucher',      delta: -12_500 },
      { id: randId('TX'), date: isoDate(-22), kind: 'earned',   description: 'Hotel partner stay',        delta:  +3_220 },
      { id: randId('TX'), date: isoDate(-44), kind: 'expired',  description: 'Promo points (Q1)',         delta:    -500 },
    ];
    const account = { balance, tier, nextTierAt, milesToNext: nextTierAt - balance, transactions };
    return { ...account, components: [{ name: 'loyaltyOverviewCard', props: account }] };
  },
};

// ── L · listSupportTickets ────────────────────────────────────────────────

export interface TicketRow {
  readonly id: string;
  readonly subject: string;
  readonly status: 'open' | 'awaiting-customer' | 'in-progress' | 'resolved';
  readonly priority: 'low' | 'normal' | 'high';
  readonly updated: string;
  readonly assignee?: string;
}

export const listSupportTicketsTool: ToolDef = {
  name: 'listSupportTickets',
  description:
    'List the traveler\'s recent support tickets, including subject, status, priority, ' +
    'last updated date, and the assigned agent.',
  schema: z.object({
    status: z.enum(['open', 'awaiting-customer', 'in-progress', 'resolved', 'all']).optional()
      .describe('Filter by status; default "all"'),
  }),
  handler: async (args) => {
    const { status } = args as { status?: TicketRow['status'] | 'all' };
    const all: readonly TicketRow[] = [
      { id: randId('TK'), subject: 'Refund for cancelled flight BK-J22YQT',  status: 'open',              priority: 'high',   updated: isoDate(-1), assignee: 'Priya M.' },
      { id: randId('TK'), subject: 'Lost baggage at JFK',                    status: 'in-progress',       priority: 'high',   updated: isoDate(-2), assignee: 'Marcus T.' },
      { id: randId('TK'), subject: 'Loyalty tier downgrade question',         status: 'awaiting-customer', priority: 'normal', updated: isoDate(-4) },
      { id: randId('TK'), subject: 'Wi-Fi voucher not honoured on LAX→SFO',   status: 'resolved',          priority: 'low',    updated: isoDate(-9) },
      { id: randId('TK'), subject: 'Receipt request for booking BK-M91YQK',   status: 'resolved',          priority: 'low',    updated: isoDate(-12) },
    ];
    const tickets = status && status !== 'all' ? all.filter((t) => t.status === status) : all;
    return { tickets, components: [{ name: 'ticketListCard', props: { tickets } }] };
  },
};

export const accountTools: readonly ToolDef[] = [
  listUpcomingTripsTool,
  getLoyaltyAccountTool,
  listSupportTicketsTool,
];
