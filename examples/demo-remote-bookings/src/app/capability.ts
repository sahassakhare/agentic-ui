import { defineCapabilityModule } from '@infra-tools/agentic-ui';
import { bookFlightTool } from './tools/book-flight.tool';
import { flightCardWidget } from './widgets/flight-card.widget';
import type { ToolDef } from '@infra-tools/agentic-ui';

export const capability = defineCapabilityModule({
  remoteName: 'demo-remote-bookings',
  version: '1.0.0',
  tools: [bookFlightTool as ToolDef],
  components: [flightCardWidget],
});
