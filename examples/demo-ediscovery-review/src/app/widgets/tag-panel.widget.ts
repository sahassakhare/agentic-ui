import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { TagPanelComponent } from './tag-panel.component';

export const tagPanelWidget = agenticWidget({
  name: 'tagPanel',
  component: TagPanelComponent,
  propsSchema: z.object({
    title: z.string(),
    totalCount: z.number(),
    counts: z.array(z.object({ tag: z.string(), count: z.number() })),
  }),
});
