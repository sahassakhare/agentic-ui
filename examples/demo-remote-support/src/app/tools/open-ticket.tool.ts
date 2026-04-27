import { agenticTool } from '@maverick/agentic-ui';
import { z } from 'zod';

export const openTicketTool = agenticTool({
  name: 'openTicket',
  description: 'Open a support ticket for an account problem, refund request, or complaint. Returns ticket id + status and renders a ticket card UI.',
  schema: z.object({
    subject: z.string().describe('One-line summary of the issue'),
    priority: z.enum(['low', 'normal', 'high']).default('normal').describe('Priority level'),
  }),
  handler: async ({ subject, priority }) => {
    const ticketId = `TICK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const ticket = { ticketId, subject, status: 'open', priority };
    return { ...ticket, components: [{ name: 'ticketCard', props: ticket }] };
  },
});
