import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { FlightCardComponent } from './flight-card.component';

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
