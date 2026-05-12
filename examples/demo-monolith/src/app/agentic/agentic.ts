import { agenticTool, agenticWidget, type ToolDef, type ComponentDef } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { FlightCardComponent } from './flight-card.component';

/**
 * In a real app these would live in an MFE remote and be loaded via
 * `loadRemoteCapabilities`. For the demo, we register them directly with
 * `provideAgenticUi({ tools, widgets })` so the entire agentic flow runs
 * end-to-end without federation moving parts.
 */

export const bookFlightTool = agenticTool({
  name: 'bookFlight',
  description: 'Book a flight from one airport to another on a given date. Returns booking confirmation and renders a flight card.',
  schema: z.object({
    from: z.string().describe('Origin airport code (e.g., LAX)'),
    to: z.string().describe('Destination airport code (e.g., JFK)'),
    date: z.string().describe('Departure date in ISO 8601 (YYYY-MM-DD)'),
  }),
  handler: async ({ from, to, date }) => {
    const bookingId = `BK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const booking = { bookingId, from, to, date, status: 'confirmed' };
    return {
      ...booking,
      // Generative-UI hint: orchestrator auto-renders this widget under the
      // tool-call message via ComponentRegistry → *ngComponentOutlet.
      components: [{ name: 'flightCard', props: booking }],
    };
  },
});

export const flightCardWidget = agenticWidget({
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

export const tools: ToolDef[] = [bookFlightTool as ToolDef];
export const widgets: ComponentDef[] = [flightCardWidget];
