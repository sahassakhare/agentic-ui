import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { BatesPreviewComponent } from './bates-preview.component';

export const batesPreviewWidget = agenticWidget({
  name: 'batesPreview',
  component: BatesPreviewComponent,
  propsSchema: z.object({
    productionId: z.string(),
    pattern: z.string(),
    first: z.string(),
    last: z.string(),
    count: z.number(),
    sample: z.array(z.string()),
  }),
});
