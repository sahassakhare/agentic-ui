import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { ReviewProgressComponent } from './review-progress.component';

export const reviewProgressWidget = agenticWidget({
  name: 'reviewProgress',
  component: ReviewProgressComponent,
  propsSchema: z.object({
    title: z.string(),
    total: z.number(),
    reviewed: z.number(),
    responsive: z.number(),
    privileged: z.number(),
    hot: z.number(),
    reviewNeeded: z.number(),
  }),
});
