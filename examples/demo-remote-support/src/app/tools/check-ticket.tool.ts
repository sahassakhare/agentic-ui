import { agenticTool } from '@maverick/agentic-ui';
import { z } from 'zod';

export const checkTicketTool = agenticTool({
  name: 'checkTicket',
  description: 'Check the status of an existing support ticket. Returns current status and renders a ticket card UI.',
  schema: z.object({ ticketId: z.string().describe('Ticket id, e.g. TICK-AB12CD') }),
  handler: async ({ ticketId }) => {
    const status = (['open', 'in_progress', 'resolved'][Math.floor(Math.random() * 3)] ?? 'open') as string;
    const ticket = { ticketId, subject: 'Account access issue', status, priority: 'normal' };
    return { ...ticket, components: [{ name: 'ticketCard', props: ticket }] };
  },
});
