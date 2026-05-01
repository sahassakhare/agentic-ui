import { agenticWidget } from '@maverick/agentic-ui';
import { z } from 'zod';
import { ProductionSummaryComponent } from './production-summary.component';

export const productionSummaryWidget = agenticWidget({
  name: 'productionSummary',
  component: ProductionSummaryComponent,
  propsSchema: z.object({
    productionId: z.string(),
    name: z.string(),
    format: z.string(),
    batesPattern: z.string(),
    documentCount: z.number(),
    status: z.string(),
    createdAt: z.string(),
  }),
});
