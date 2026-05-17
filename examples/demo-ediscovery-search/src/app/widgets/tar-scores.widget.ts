import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { TarScoresComponent } from './tar-scores.component';

export const tarScoresWidget = agenticWidget({
  name: 'tarScores',
  component: TarScoresComponent,
  propsSchema: z.object({
    topic: z.string(),
    threshold: z.number(),
    scored: z.number(),
    rows: z.array(z.object({
      documentId: z.string(),
      responsive: z.number(),
      privileged: z.number(),
      hot: z.number(),
      rationale: z.string(),
    })),
  }),
});
