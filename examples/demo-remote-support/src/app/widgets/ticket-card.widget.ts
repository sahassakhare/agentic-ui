import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { TicketCardComponent } from './ticket-card.component';

export const ticketCardWidget = agenticWidget({
  name: 'ticketCard',
  component: TicketCardComponent,
  propsSchema: z.object({
    ticketId: z.string(),
    subject: z.string(),
    status: z.string(),
    priority: z.string(),
  }),
});
