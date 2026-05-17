import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { ChainOfCustodyReportComponent } from './chain-of-custody-report.component';

export const chainOfCustodyReportWidget = agenticWidget({
  name: 'chainOfCustodyReport',
  component: ChainOfCustodyReportComponent,
  propsSchema: z.object({
    title: z.string(),
    productionId: z.string(),
    generatedAt: z.string(),
    chainVerified: z.boolean(),
    chainHead: z.string(),
    chainEvents: z.number(),
    chainBroken: z.number(),
    documentCount: z.number(),
    totalRedactions: z.number(),
    lines: z.array(z.object({
      timestamp: z.string(),
      actor: z.string(),
      action: z.string(),
      targetType: z.string(),
      targetId: z.string(),
      reason: z.string().nullable(),
      chainHash: z.string().nullable(),
      verified: z.boolean(),
    })),
  }),
});
