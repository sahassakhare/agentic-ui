import { defineCapabilityModule } from '@maverick/agentic-ui';
import type { ToolDef } from '@maverick/agentic-ui';
import { openTicketTool } from './tools/open-ticket.tool';
import { checkTicketTool } from './tools/check-ticket.tool';
import { ticketCardWidget } from './widgets/ticket-card.widget';

export const capability = defineCapabilityModule({
  remoteName: 'demo-remote-support',
  version: '1.0.0',
  tools: [openTicketTool as ToolDef, checkTicketTool as ToolDef],
  components: [ticketCardWidget],
});
