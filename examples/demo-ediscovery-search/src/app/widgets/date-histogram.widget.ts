import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { DateHistogramComponent } from './date-histogram.component';

export const dateHistogramWidget = agenticWidget({
  name: 'dateHistogram',
  component: DateHistogramComponent,
  propsSchema: z.object({
    title: z.string(),
    range: z.string().nullable(),
    buckets: z.array(z.object({
      key: z.string(),
      label: z.string(),
      count: z.number(),
      inRange: z.boolean(),
    })),
  }),
});
