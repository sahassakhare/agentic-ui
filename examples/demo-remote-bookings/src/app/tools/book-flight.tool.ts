import { agenticTool } from '@infra-tools/agentic-ui';
import { z } from 'zod';

export const bookFlightTool = agenticTool({
  name: 'bookFlight',
  description: 'Book a flight from one airport to another on a given date. Returns booking confirmation and renders a flight card UI.',
  schema: z.object({
    from: z.string().describe('Origin airport code (e.g., LAX)'),
    to: z.string().describe('Destination airport code (e.g., JFK)'),
    date: z.string().describe('Departure date in ISO 8601 (YYYY-MM-DD)'),
  }),
  handler: async ({ from, to, date }) => {
    const bookingId = `BK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const booking = { bookingId, from, to, date, status: 'confirmed' };
    return {
      // Data the LLM consumes for its summary text.
      ...booking,
      // Generative-UI hint: chat shell auto-renders this widget under the
      // tool-call message via the ComponentRegistry. See run-orchestrator.ts
      // → `extractWidgetEventsFromResult`.
      components: [
        { name: 'flightCard', props: booking },
      ],
    };
  },
});
