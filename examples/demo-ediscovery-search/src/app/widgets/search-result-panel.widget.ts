import { agenticWidget } from '@maverick/agentic-ui';
import { z } from 'zod';
import { SearchResultPanelComponent } from './search-result-panel.component';

export const searchResultPanelWidget = agenticWidget({
  name: 'searchResultPanel',
  component: SearchResultPanelComponent,
  propsSchema: z.object({
    query: z.string(),
    count: z.number(),
    hits: z.array(z.object({
      documentId: z.string(),
      fileName: z.string(),
      custodianName: z.string(),
      score: z.number(),
      matched: z.array(z.string()),
      tags: z.array(z.string()),
    })),
  }),
});
