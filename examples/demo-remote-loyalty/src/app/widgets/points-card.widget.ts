import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { PointsCardComponent } from './points-card.component';

export const pointsCardWidget = agenticWidget({
  name: 'pointsCard',
  component: PointsCardComponent,
  propsSchema: z.object({
    balance: z.number(),
    tier: z.string(),
    nextTier: z.string().optional(),
    nextTierAt: z.number().nullable().optional(),
  }),
});
